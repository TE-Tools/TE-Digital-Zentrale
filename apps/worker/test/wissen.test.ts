import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { berichtErzeugen, tagesberichtSpeichern } from '../src/lib/berichte';
import { auswerten, warnstufe } from '../src/lib/kosten';
import { anfrage, devAnmelden } from './hilfe';

async function mcpWerkzeug(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await SELF.fetch('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  return { text: j.result.content[0]!.text, isError: !!j.result.isError };
}

describe('Unternehmenswissen', () => {
  it('Startbestand aus firma/ ist vorhanden (Organisation, Regeln, 5 Rollen)', async () => {
    const cookie = await devAnmelden();
    const r = await anfrage('/api/wissen?projekt=unternehmen', { cookie });
    const titel = r.body.wissen.map((w: { titel: string }) => w.titel);
    expect(titel).toEqual(expect.arrayContaining(['Organisation der TE-Digital AI Company', 'Entscheidungsstufen und Freigaben', 'Rolle – Technische Leitung']));
    expect(r.body.wissen.filter((w: { kategorie: string }) => w.kategorie === 'rolle')).toHaveLength(5);
    const v = await anfrage(`/api/wissen/${r.body.wissen[0].id}`, { cookie });
    expect(v.body.versionen[0]).toMatchObject({ version: 1, geaendert_von: 'system' });
  });

  it('legt an, versioniert Änderungen und erkennt veraltete Stände', async () => {
    const cookie = await devAnmelden();
    const neu = await anfrage('/api/wissen', {
      cookie,
      body: { titel: 'Deploy Orchester Orga', kategorie: 'anleitung', projekt_slug: 'orchester', zusammenfassung: 'Merge auf main deployt automatisch.', inhalt: '# Deploy\nwrangler-action' },
    });
    expect(neu.status).toBe(201);
    const id = neu.body.id;
    expect((await anfrage(`/api/wissen/${id}`, { methode: 'PATCH', cookie, body: { version: 1, inhalt: '# Deploy\nNeu' } })).body.version).toBe(2);
    expect((await anfrage(`/api/wissen/${id}`, { methode: 'PATCH', cookie, body: { version: 1, inhalt: 'alt' } })).status).toBe(409);
    const d = await anfrage(`/api/wissen/${id}`, { cookie });
    expect(d.body.versionen.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect((await anfrage(`/api/wissen/${id}/versionen/1`, { cookie })).body.version.inhalt).toBe('# Deploy\nwrangler-action');

    const s = await anfrage('/api/wissen?suche=wrangler', { cookie });
    expect(s.body.wissen.some((w: { id: number }) => w.id === id)).toBe(false); // alter Inhalt nicht mehr aktuell
    expect((await anfrage('/api/wissen?suche=automatisch', { cookie })).body.wissen.some((w: { id: number }) => w.id === id)).toBe(true);

    await anfrage(`/api/wissen/${id}/archivieren`, { cookie, body: {} });
    expect((await anfrage('/api/wissen?projekt=orchester', { cookie })).body.wissen.some((w: { id: number }) => w.id === id)).toBe(false);
    expect((await anfrage('/api/wissen?projekt=orchester&archiviert=1', { cookie })).body.wissen.some((w: { id: number }) => w.id === id)).toBe(true);
  });

  it('übernimmt ein Aufgabenergebnis als Wissensartikel', async () => {
    const cookie = await devAnmelden();
    const a = await anfrage('/api/aufgaben', { cookie, body: { titel: 'Wettbewerbsanalyse Familien-Apps', projekt_slug: 'familienplaner', zustaendig_id: 'marketing' } });
    expect((await anfrage(`/api/wissen/aus-aufgabe/${a.body.id}`, { cookie, body: {} })).status).toBe(409);
    await anfrage(`/api/aufgaben/${a.body.id}/ergebnis`, { cookie, body: { text: 'ERGEBNIS: Drei Wettbewerber, keiner mit Schul-Integration.\nZWISCHENSTAND: Analyse fertig.' } });
    const w = await anfrage(`/api/wissen/aus-aufgabe/${a.body.id}`, { cookie, body: {} });
    expect(w.status).toBe(201);
    const d = await anfrage(`/api/wissen/${w.body.id}`, { cookie });
    expect(d.body.wissen).toMatchObject({ kategorie: 'zusammenfassung', projekt_slug: 'familienplaner', quelle: `aufgabe:${a.body.id}`, zusammenfassung: 'Analyse fertig.' });
  });

  it('Übergabepaket enthält Rollen- und Projektwissen als Kurzfassung', async () => {
    const cookie = await devAnmelden();
    await anfrage('/api/wissen', {
      cookie,
      body: { titel: 'Architektur Mini-Games', kategorie: 'architektur', projekt_slug: 'minigames', zusammenfassung: 'Offline-first mit Dexie, Supabase nur für Multiplayer.', inhalt: 'lang' },
    });
    const a = await anfrage('/api/aufgaben', { cookie, body: { titel: 'Neues Spiel', projekt_slug: 'minigames', zustaendig_id: 'technik' } });
    const p = await anfrage(`/api/aufgaben/${a.body.id}/paket`, { cookie });
    expect(p.body.text).toContain('## Relevantes Wissen (Kurzfassung)');
    expect(p.body.text).toContain('Rolle – Technische Leitung');
    expect(p.body.text).toContain('Offline-first mit Dexie');
    expect(p.body.text).not.toContain('Rolle – Marketing');
    const fort = await anfrage(`/api/aufgaben/${a.body.id}/paket?modus=fortsetzung`, { cookie });
    expect(fort.body.text).not.toContain('Relevantes Wissen');
  });

  it('KI-Mitarbeiter: Wissen per MCP suchen, lesen, speichern – Firmenregeln gesperrt', async () => {
    const cookie = await devAnmelden();
    const token = (await anfrage('/api/zugaenge', { cookie, body: { mitarbeiter_id: 'technik', bezeichnung: 'Wissen', projekte: ['zentrale'] } })).body.token;
    const such = await mcpWerkzeug(token, 'wissen_suchen', { suche: 'Entscheidungsstufen' });
    expect(such.text).toMatch(/W\d+ Entscheidungsstufen/);
    const id = Number(such.text.match(/W(\d+) Entscheidungsstufen/)![1]);
    expect((await mcpWerkzeug(token, 'wissen_lesen', { id })).text).toContain('## Stufe 3 – nur mit Freigabe');

    const neu = await mcpWerkzeug(token, 'wissen_speichern', { titel: 'MCP-Server Aufbau', projekt: 'zentrale', zusammenfassung: 'Zustandslos, Bearer-Token je Mitarbeiter.', inhalt: '# MCP' });
    expect(neu.text).toMatch(/W\d+ angelegt/);
    const nid = Number(neu.text.match(/W(\d+)/)![1]);
    expect((await mcpWerkzeug(token, 'wissen_speichern', { id: nid, titel: 'MCP-Server Aufbau', zusammenfassung: 'v2', inhalt: '# MCP v2' })).text).toContain('Version 2');
    const audit = await env.DB.prepare(`SELECT akteur_typ FROM aktivitaeten WHERE aktion = 'wissen.geaendert' AND objekt_id = ?`).bind(String(nid)).first();
    expect(audit).toEqual({ akteur_typ: 'mitarbeiter' });

    expect((await mcpWerkzeug(token, 'wissen_speichern', { id, titel: 'Stufen geändert', zusammenfassung: 'x', inhalt: 'x' })).isError).toBe(true);
    expect((await mcpWerkzeug(token, 'wissen_speichern', { titel: 'Orchester-Interna', projekt: 'orchester', zusammenfassung: 'x', inhalt: 'x' })).isError).toBe(true);
  });
});

describe('Berichte', () => {
  it('Tagesbericht wird aus den Daten erzeugt, einmal je Tag gespeichert und kann neu erstellt werden', async () => {
    const cookie = await devAnmelden();
    const a = await anfrage('/api/aufgaben', { cookie, body: { titel: 'Berichtstest', projekt_slug: 'zentrale', zustaendig_id: 'technik' } });
    await anfrage('/api/freigaben', { cookie, body: { typ: 'kosten', titel: 'Domain für Berichtstest', aufgabe_id: a.body.id } });
    const id1 = await tagesberichtSpeichern(env);
    const id2 = await tagesberichtSpeichern(env);
    expect(id2).toBe(id1);
    const b = await anfrage(`/api/berichte/${id1}`, { cookie });
    expect(b.body.bericht.inhalt).toContain('## Wartet auf die Geschäftsführung');
    expect(b.body.bericht.inhalt).toContain('Domain für Berichtstest');
    expect(b.body.bericht.kennzahlen.neu).toBeGreaterThanOrEqual(1);
    const neu = await anfrage('/api/berichte/tag', { cookie, body: {} });
    expect(neu.status).toBe(201);
    const liste = await anfrage('/api/berichte?typ=tag', { cookie });
    expect(liste.body.berichte).toHaveLength(1);
  });

  it('Projektbericht nur mit Daten des Projekts', async () => {
    const cookie = await devAnmelden();
    await anfrage('/api/aufgaben', { cookie, body: { titel: 'Nur Vereinsleben', projekt_slug: 'vereinsleben' } });
    await anfrage('/api/aufgaben', { cookie, body: { titel: 'Nur DragonSkill', projekt_slug: 'dragonskill' } });
    const r = await anfrage('/api/berichte/projekt', { cookie, body: { projekt_slug: 'vereinsleben', tage: 30 } });
    const b = await anfrage(`/api/berichte/${r.body.id}`, { cookie });
    expect(b.body.bericht.titel).toContain('Projektbericht TE-Vereinsleben');
    expect(b.body.bericht.inhalt).toContain('Nur Vereinsleben');
    expect(b.body.bericht.inhalt).not.toContain('Nur DragonSkill');
    const direkt = await berichtErzeugen(env, new Date(Date.now() - 86_400_000), new Date(), 'dragonskill');
    expect(direkt.kennzahlen.neu).toBeGreaterThanOrEqual(1);
  });

  it('Aktivitätsprotokoll mit Filtern und Blättern', async () => {
    const cookie = await devAnmelden();
    const alle = await anfrage('/api/berichte/protokoll', { cookie });
    expect(alle.body.eintraege.length).toBeGreaterThan(0);
    const nurWissen = await anfrage('/api/berichte/protokoll?bereich=wissen', { cookie });
    expect(nurWissen.body.eintraege.every((e: { aktion: string }) => e.aktion.startsWith('wissen.'))).toBe(true);
    const ki = await anfrage('/api/berichte/protokoll?akteur_typ=mitarbeiter', { cookie });
    expect(ki.body.eintraege.every((e: { akteur_typ: string }) => e.akteur_typ === 'mitarbeiter')).toBe(true);
  });
});

describe('Kostenwächter', () => {
  it('wertet die Cloudflare-Antwort aus und stuft Warnungen ein', () => {
    const m = auswerten({
      data: {
        viewer: {
          accounts: [
            {
              workers: [{ sum: { requests: 85_000 } }],
              d1: [{ sum: { rowsRead: 1_000_000, rowsWritten: 60_000 } }, { sum: { rowsRead: 500, rowsWritten: 36_000 } }],
              dos: [],
            },
          ],
        },
      },
    });
    const w = (d: string, x: string) => m.find((v) => v.dienst === d && v.metrik === x)!;
    expect(w('workers', 'anfragen')).toMatchObject({ wert: 85_000, grenze: 100_000 });
    expect(w('d1', 'zeilen_geschrieben').wert).toBe(96_000);
    expect(warnstufe(w('workers', 'anfragen'))).toBe('wichtig');
    expect(warnstufe(w('d1', 'zeilen_geschrieben'))).toBe('kritisch');
    expect(warnstufe(w('durable_objects', 'anfragen'))).toBe('ok');
    expect(() => auswerten({ data: { viewer: { accounts: [] } } })).toThrow(/Kontodaten/);
  });

  it('API meldet „nicht eingerichtet“ ohne Token', async () => {
    const cookie = await devAnmelden();
    const k = await anfrage('/api/kosten', { cookie });
    expect(k.body).toMatchObject({ eingerichtet: false, tarif: 'Workers Free', sparmodus: false });
    expect(k.body.grenzen).toHaveLength(4);
    expect((await anfrage('/api/kosten/messen', { cookie, body: {} })).status).toBe(502);
  });
});
