import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { anfrage, devAnmelden } from './hilfe';

async function neueAufgabe(cookie: string, extra: Record<string, unknown> = {}) {
  const r = await anfrage('/api/aufgaben', {
    cookie,
    body: {
      titel: 'Landingpage texten',
      projekt_slug: 'familienplaner',
      zustaendig_id: 'marketing',
      prioritaet: 'hoch',
      uebergabe: { ziel: 'Mehr Anmeldungen', akzeptanzkriterien: 'Max. 120 Wörter' },
      ...extra,
    },
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

async function version(cookie: string, id: string): Promise<number> {
  return (await anfrage(`/api/aufgaben/${id}`, { cookie })).body.aufgabe.version;
}

async function statusSetzen(cookie: string, id: string, status: string, extra: Record<string, unknown> = {}) {
  return anfrage(`/api/aufgaben/${id}`, { methode: 'PATCH', cookie, body: { version: await version(cookie, id), status, ...extra } });
}

describe('Aufgaben', () => {
  it('vergibt laufende IDs, legt Übergabe an und informiert den Zuständigen', async () => {
    const cookie = await devAnmelden();
    const id1 = await neueAufgabe(cookie);
    const id2 = await neueAufgabe(cookie, { zustaendig_id: null });
    expect(id1).toBe('TD-0001');
    expect(id2).toBe('TD-0002');

    const d = await anfrage(`/api/aufgaben/${id1}`, { cookie });
    expect(d.body.aufgabe.status).toBe('zugewiesen');
    expect(d.body.uebergabe.ziel).toBe('Mehr Anmeldungen');
    expect(d.body.nachrichten[0].art).toBe('aufgabenuebergabe');
    expect((await anfrage(`/api/aufgaben/${id2}`, { cookie })).body.aufgabe.status).toBe('neu');

    const liste = await anfrage('/api/aufgaben?gruppe=offen&projekt=familienplaner', { cookie });
    expect(liste.body.aufgaben).toHaveLength(2);
  });

  it('lehnt unbekannte Projekte und Mitarbeiter ab', async () => {
    const cookie = await devAnmelden();
    expect((await anfrage('/api/aufgaben', { cookie, body: { titel: 'Test', projekt_slug: 'gibtsnicht' } })).status).toBe(400);
    expect((await anfrage('/api/aufgaben', { cookie, body: { titel: 'Test', projekt_slug: 'zentrale', zustaendig_id: 'niemand' } })).status).toBe(400);
  });

  it('erzwingt Statusregeln, Abhängigkeiten und Prüfung vor Abschluss', async () => {
    const cookie = await devAnmelden();
    const basis = await neueAufgabe(cookie);
    const folge = await neueAufgabe(cookie, { abhaengig_von: [basis] });

    // Folgeaufgabe darf nicht starten, solange die Basis offen ist
    const block = await statusSetzen(cookie, folge, 'in_bearbeitung');
    expect(block.status).toBe(409);
    expect(block.body.fehler.code).toBe('abhaengigkeit_offen');

    // Unzulässiger Sprung
    expect((await statusSetzen(cookie, basis, 'abgeschlossen')).body.fehler.code).toBe('statuswechsel_unzulaessig');
    // Freigabe-Status nur per Antrag
    expect((await statusSetzen(cookie, basis, 'freigabe_erforderlich')).body.fehler.code).toBe('freigabe_beantragen');

    expect((await statusSetzen(cookie, basis, 'in_bearbeitung')).status).toBe(200);
    const ma = await env.DB.prepare(`SELECT status FROM mitarbeiter WHERE id = 'marketing'`).first<{ status: string }>();
    expect(ma?.status).toBe('arbeitet');

    expect((await statusSetzen(cookie, basis, 'abgeschlossen')).body.fehler.code).toBe('pruefung_offen');
    const fertig = await statusSetzen(cookie, basis, 'abgeschlossen', { pruefstatus: 'bestanden' });
    expect(fertig.status).toBe(200);

    expect((await statusSetzen(cookie, folge, 'in_bearbeitung')).status).toBe(200);
  });

  it('verhindert zyklische Abhängigkeiten', async () => {
    const cookie = await devAnmelden();
    const a = await neueAufgabe(cookie);
    const b = await neueAufgabe(cookie, { abhaengig_von: [a] });
    const r = await anfrage(`/api/aufgaben/${a}/abhaengigkeiten`, { cookie, body: { haengt_ab_von: b } });
    expect(r.status).toBe(409);
    expect(r.body.fehler.code).toBe('zyklus');
  });

  it('Teil-Änderung der Übergabe überschreibt andere Felder nicht', async () => {
    const cookie = await devAnmelden();
    const id = await neueAufgabe(cookie);
    await anfrage(`/api/aufgaben/${id}`, { methode: 'PATCH', cookie, body: { version: await version(cookie, id), uebergabe: { dateien: 'web/index.html' } } });
    const d = await anfrage(`/api/aufgaben/${id}`, { cookie });
    expect(d.body.uebergabe).toMatchObject({ dateien: 'web/index.html', ziel: 'Mehr Anmeldungen', akzeptanzkriterien: 'Max. 120 Wörter' });
  });

  it('erkennt gleichzeitige Änderungen über die Version', async () => {
    const cookie = await devAnmelden();
    const id = await neueAufgabe(cookie);
    const v = await version(cookie, id);
    expect((await anfrage(`/api/aufgaben/${id}`, { methode: 'PATCH', cookie, body: { version: v, titel: 'Neu A' } })).status).toBe(200);
    const alt = await anfrage(`/api/aufgaben/${id}`, { methode: 'PATCH', cookie, body: { version: v, titel: 'Neu B' } });
    expect(alt.status).toBe(409);
  });
});

describe('Übergabepaket & Ergebnis', () => {
  it('liefert ein Paket mit Zeichenzahl und Warnungen', async () => {
    const cookie = await devAnmelden();
    const id = await neueAufgabe(cookie, { beschreibung: 'Rückfragen an info@te-digital.example' });
    const p = await anfrage(`/api/aufgaben/${id}/paket`, { cookie });
    expect(p.status).toBe(200);
    expect(p.body.text).toContain(`# Auftrag ${id}`);
    expect(p.body.text).toContain('Marketing & Vertrieb');
    expect(p.body.zeichen).toBe(p.body.text.length);
    expect(p.body.warnungen.join()).toContain('E-Mail');
  });

  it('führt eine strukturierte Antwort zurück: Ergebnis, Checkpoint, Rückfrage', async () => {
    const cookie = await devAnmelden();
    const id = await neueAufgabe(cookie);
    await statusSetzen(cookie, id, 'in_bearbeitung');
    const r = await anfrage(`/api/aufgaben/${id}/ergebnis`, {
      cookie,
      body: { text: 'ERGEBNIS:\nDrei Varianten.\nOFFENE FRAGEN:\nDu oder Sie?\nFREIGABEANTRÄGE: keine\nZWISCHENSTAND:\nVarianten fertig, Bilder fehlen.' },
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('pruefung');
    expect(r.body.erkannt).toMatchObject({ strukturiert: true, zwischenstand: true, rueckfragen: true, freigabe: null });

    const d = await anfrage(`/api/aufgaben/${id}`, { cookie });
    expect(d.body.aufgabe.ergebnis).toBe('Drei Varianten.');
    expect(d.body.checkpoints[0].zusammenfassung).toBe('Varianten fertig, Bilder fehlen.');
    expect(d.body.nachrichten.map((n: { art: string }) => n.art)).toEqual(['aufgabenuebergabe', 'ergebnisbericht', 'rueckfrage']);

    const dash = await anfrage('/api/dashboard', { cookie });
    expect(dash.body.rueckfragen).toHaveLength(1);
    expect(dash.body.zahlen.ungelesen).toBeGreaterThanOrEqual(2);
  });

  it('legt bei Freigabeantrag automatisch eine Freigabe an und hält die Aufgabe an', async () => {
    const cookie = await devAnmelden();
    const id = await neueAufgabe(cookie);
    const r = await anfrage(`/api/aufgaben/${id}/ergebnis`, {
      cookie,
      body: { text: 'ERGEBNIS: Kampagne fertig\nFREIGABEANTRÄGE: 50 € Instagram-Budget\nZWISCHENSTAND: bereit zum Start' },
    });
    expect(r.body.status).toBe('freigabe_erforderlich');
    expect(r.body.erkannt.freigabe).toMatch(/^FG-\d{4}$/);
    const f = await anfrage('/api/freigaben?status=offen', { cookie });
    expect(f.body.freigaben[0].aufgabe_id).toBe(id);
  });
});

describe('Limit-Pause', () => {
  it('pausiert, speichert Checkpoint und meldet Fortsetzbarkeit nach Ablauf', async () => {
    const cookie = await devAnmelden();
    const id = await neueAufgabe(cookie);
    await statusSetzen(cookie, id, 'in_bearbeitung');

    const bis = new Date(Date.now() + 60 * 60_000).toISOString();
    const r = await anfrage(`/api/aufgaben/${id}/limit`, { cookie, body: { bis, notiz: 'Abschnitt 2 von 3 fertig' } });
    expect(r.status).toBe(200);

    let d = await anfrage(`/api/aufgaben/${id}`, { cookie });
    expect(d.body.aufgabe.status).toBe('wartend');
    expect(d.body.checkpoints[0]).toMatchObject({ grund: 'limit', zusammenfassung: 'Abschnitt 2 von 3 fertig' });
    let dash = await anfrage('/api/dashboard', { cookie });
    expect(dash.body.mitarbeiter.find((m: { id: string }) => m.id === 'marketing').status).toBe('wartend_limit');
    expect(dash.body.fortsetzbar).toHaveLength(0);

    // Limit läuft ab
    await env.DB.prepare(`UPDATE mitarbeiter SET limit_bis = ? WHERE id = 'marketing'`).bind(new Date(Date.now() - 1000).toISOString()).run();
    dash = await anfrage('/api/dashboard', { cookie });
    expect(dash.body.mitarbeiter.find((m: { id: string }) => m.id === 'marketing').status).toBe('verfuegbar');
    expect(dash.body.fortsetzbar.map((f: { id: string }) => f.id)).toEqual([id]);

    const p = await anfrage(`/api/aufgaben/${id}/paket?modus=fortsetzung`, { cookie });
    expect(p.body.text).toContain('Abschnitt 2 von 3 fertig');

    expect((await anfrage(`/api/aufgaben/${id}/fortsetzen`, { cookie, body: {} })).status).toBe(200);
    d = await anfrage(`/api/aufgaben/${id}`, { cookie });
    expect(d.body.aufgabe.status).toBe('in_bearbeitung');
  });

  it('verlangt einen Zuständigen und einen Zeitpunkt in der Zukunft', async () => {
    const cookie = await devAnmelden();
    const ohne = await neueAufgabe(cookie, { zustaendig_id: null });
    expect((await anfrage(`/api/aufgaben/${ohne}/limit`, { cookie, body: {} })).status).toBe(409);
    const mit = await neueAufgabe(cookie);
    expect((await anfrage(`/api/aufgaben/${mit}/limit`, { cookie, body: { bis: '2020-01-01T00:00:00Z' } })).status).toBe(400);
  });
});

describe('Freigaben (Stufe 3)', () => {
  it('erteilen setzt Aufgabe fort und protokolliert unveränderlich', async () => {
    const cookie = await devAnmelden();
    const id = await neueAufgabe(cookie);
    await statusSetzen(cookie, id, 'in_bearbeitung');
    const f = await anfrage('/api/freigaben', { cookie, body: { typ: 'veroeffentlichung', titel: 'Landingpage live schalten', aufgabe_id: id } });
    expect(f.status).toBe(201);
    expect((await anfrage(`/api/aufgaben/${id}`, { cookie })).body.aufgabe.status).toBe('freigabe_erforderlich');

    const e = await anfrage(`/api/freigaben/${f.body.id}/entscheiden`, { cookie, body: { entscheidung: 'erteilt', kommentar: 'Passt.' } });
    expect(e.status).toBe(200);
    expect((await anfrage(`/api/aufgaben/${id}`, { cookie })).body.aufgabe.status).toBe('in_bearbeitung');

    const en = await anfrage('/api/entscheidungen?stufe=3', { cookie });
    expect(en.body.entscheidungen[0]).toMatchObject({ stufe: 3, freigabe_id: f.body.id });
    await expect(env.DB.prepare('DELETE FROM entscheidungen').run()).rejects.toThrow(/unveränderlich/);

    // Doppelte Entscheidung
    expect((await anfrage(`/api/freigaben/${f.body.id}/entscheiden`, { cookie, body: { entscheidung: 'abgelehnt' } })).status).toBe(409);
  });

  it('ablehnen blockiert die Aufgabe', async () => {
    const cookie = await devAnmelden();
    const id = await neueAufgabe(cookie);
    const f = await anfrage('/api/freigaben', { cookie, body: { typ: 'kosten', titel: 'Werbebudget', aufgabe_id: id } });
    await anfrage(`/api/freigaben/${f.body.id}/entscheiden`, { cookie, body: { entscheidung: 'abgelehnt' } });
    expect((await anfrage(`/api/aufgaben/${id}`, { cookie })).body.aufgabe.status).toBe('blockiert');
  });

  it('verlangt eine frische Passkey-Bestätigung', async () => {
    const cookie = await devAnmelden();
    const f = await anfrage('/api/freigaben', { cookie, body: { typ: 'kosten', titel: 'Domain kaufen' } });
    await env.DB.prepare('UPDATE sitzungen SET bestaetigt_am = ?').bind(new Date(Date.now() - 10 * 60_000).toISOString()).run();
    const r = await anfrage(`/api/freigaben/${f.body.id}/entscheiden`, { cookie, body: { entscheidung: 'erteilt' } });
    expect(r.status).toBe(403);
    expect(r.body.fehler.code).toBe('bestaetigung_noetig');
  });
});

describe('Entscheidungen & Kommunikation', () => {
  it('Stufe 2 informiert Projektleitung und GF, Stufe 3 nur über Freigabe', async () => {
    const cookie = await devAnmelden();
    const r = await anfrage('/api/entscheidungen', {
      cookie,
      body: { stufe: 2, titel: 'Architektur: Hono statt Express', von: 'technik', projekt_slug: 'zentrale' },
    });
    expect(r.status).toBe(201);
    const n = await anfrage('/api/nachrichten?art=information&projekt=zentrale', { cookie });
    expect(n.body.nachrichten.map((x: { an: string }) => x.an).sort()).toEqual(['gf', 'projektleitung']);
    expect((await anfrage('/api/entscheidungen', { cookie, body: { stufe: 3, titel: 'Produktiv gehen' } })).status).toBe(400);
  });

  it('speichert Nachrichten zentral und markiert gelesen', async () => {
    const cookie = await devAnmelden();
    const id = await neueAufgabe(cookie);
    const r = await anfrage('/api/nachrichten', { cookie, body: { art: 'warnung', von: 'qualitaet', an: 'gf', aufgabe_id: id, inhalt: 'XSS-Risiko im Formular' } });
    expect(r.status).toBe(201);
    const ungelesen = await anfrage('/api/nachrichten?ungelesen=1', { cookie });
    expect(ungelesen.body.nachrichten[0]).toMatchObject({ projekt_slug: 'familienplaner', von: 'qualitaet' });
    await anfrage('/api/nachrichten/gelesen', { cookie, body: {} });
    expect((await anfrage('/api/nachrichten?ungelesen=1', { cookie })).body.nachrichten).toHaveLength(0);
    expect((await anfrage('/api/nachrichten', { cookie, body: { art: 'warnung', von: 'unbekannt', inhalt: 'x' } })).status).toBe(400);
  });
});
