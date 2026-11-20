import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { istKontingentErschoepft, laeufeAbarbeiten, laufAnlegen, naechsterReset } from '../src/lib/automatik';
import { anfrage, devAnmelden } from './hilfe';

const ANTWORT = ['ERGEBNIS:', 'Drei Textvarianten für die Startseite.', 'OFFENE FRAGEN: keine', 'FREIGABEANTRÄGE: keine', 'ZWISCHENSTAND: Entwurf fertig.'].join('\n');

function mitKi(run: (modell: string, eingabe: { messages: { role: string; content: string }[] }) => Promise<unknown>): Env {
  return { ...(env as unknown as Env), AI: { run } as unknown as Ai };
}

async function aufgabe(cookie: string, zustaendig: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await anfrage('/api/aufgaben', {
    cookie,
    body: { titel: 'Startseite texten', projekt_slug: 'familienplaner', zustaendig_id: zustaendig, uebergabe: { ziel: 'Mehr Anmeldungen' }, ...extra },
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

async function lauf(id: number) {
  return env.DB.prepare('SELECT * FROM ki_laeufe WHERE id = ?').bind(id).first<{ status: string; meldung: string; modus: string; extern_url: string | null }>();
}

async function aufgabeLesen(id: string) {
  return env.DB.prepare('SELECT status, ergebnis FROM aufgaben WHERE id = ?').bind(id).first<{ status: string; ergebnis: string }>();
}

describe('Automatik', () => {
  it('Assistent (Workers AI) bearbeitet den Auftrag selbst und trägt das Ergebnis ein', async () => {
    const cookie = await devAnmelden();
    const id = await aufgabe(cookie, 'assistent');
    const laufId = await laufAnlegen(env.DB, id);
    let eingabe = '';
    const weitere = await laeufeAbarbeiten(
      mitKi(async (_m, e) => {
        eingabe = e.messages.map((m) => m.content).join('\n');
        return { response: ANTWORT };
      }),
    );
    expect(weitere).toBe(false);
    expect(eingabe).toContain('Startseite texten');
    expect(eingabe).toContain('Antwortformat');
    expect(await lauf(laufId)).toMatchObject({ status: 'fertig' });
    expect(await aufgabeLesen(id)).toMatchObject({ status: 'pruefung', ergebnis: 'Drei Textvarianten für die Startseite.' });
    const audit = await env.DB.prepare(`SELECT akteur_typ FROM aktivitaeten WHERE objekt_id = ? AND aktion = 'aufgabe.ergebnis'`).bind(id).first<{ akteur_typ: string }>();
    expect(audit?.akteur_typ).toBe('mitarbeiter');

    // Live-Anzeige
    const r = await anfrage(`/api/automatik/aufgaben/${id}`, { cookie });
    expect(r.body).toMatchObject({ automatik: 'workers_ai', mitarbeiter: 'Assistent' });
    expect(r.body.laeufe[0]).toMatchObject({ id: laufId, status: 'fertig' });
  });

  it('pausiert bei aufgebrauchtem Tageskontingent und macht danach selbst weiter', async () => {
    const cookie = await devAnmelden();
    const id = await aufgabe(cookie, 'assistent');
    const laufId = await laufAnlegen(env.DB, id);
    await laeufeAbarbeiten(
      mitKi(async () => {
        throw new Error('4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare\'s Workers Paid plan');
      }),
    );
    expect(await lauf(laufId)).toMatchObject({ status: 'limit' });
    expect((await aufgabeLesen(id))!.status).toBe('wartend');
    const m = await env.DB.prepare(`SELECT status, limit_bis FROM mitarbeiter WHERE id = 'assistent'`).first<{ status: string; limit_bis: string }>();
    expect(m!.status).toBe('wartend_limit');
    expect(m!.limit_bis.endsWith('T00:02:00.000Z')).toBe(true);

    // vor dem Reset: nichts passiert
    await laeufeAbarbeiten(mitKi(async () => ({ response: ANTWORT })));
    expect((await aufgabeLesen(id))!.status).toBe('wartend');

    // nach dem Reset: automatische Fortsetzung (Kurzpaket ab Zwischenstand)
    let eingabe = '';
    await laeufeAbarbeiten(
      mitKi(async (_m, e) => {
        eingabe = e.messages[1]!.content;
        return { response: ANTWORT };
      }),
      new Date(Date.parse(m!.limit_bis) + 60_000),
    );
    expect(eingabe).toContain('Fortsetzung');
    expect((await aufgabeLesen(id))!.status).toBe('pruefung');
    const neu = await env.DB.prepare(`SELECT status, modus FROM ki_laeufe WHERE aufgabe_id = ? ORDER BY id DESC LIMIT 1`).bind(id).first();
    expect(neu).toMatchObject({ status: 'fertig', modus: 'fortsetzung' });
  });

  it('erkennt das Kontingent-Ende und berechnet den Reset', () => {
    expect(istKontingentErschoepft(new Error('AiError: 4006: daily free allocation'))).toBe(true);
    expect(istKontingentErschoepft(new Error('Netzwerkfehler'))).toBe(false);
    expect(naechsterReset(new Date('2026-11-20T22:30:00Z'))).toBe('2026-11-21T00:02:00.000Z');
  });

  it('nur für automatische Mitarbeiter, nie doppelt, nicht bei offener Freigabe', async () => {
    const cookie = await devAnmelden();
    const chatgpt = await aufgabe(cookie, 'projektleitung');
    const r1 = await anfrage(`/api/automatik/aufgaben/${chatgpt}/starten`, { cookie, body: {} });
    expect(r1.status).toBe(409);
    expect(r1.body.fehler.code).toBe('keine_automatik');

    const info = await anfrage(`/api/automatik/aufgaben/${chatgpt}`, { cookie });
    expect(info.body.automatik).toBeNull();

    const id = await aufgabe(cookie, 'assistent');
    await laufAnlegen(env.DB, id);
    await expect(laufAnlegen(env.DB, id)).rejects.toThrow(/läuft bereits/);
  });

  it('Auftrag mit „sofort starten“ legt einen Lauf an; Abbrechen beendet ihn', async () => {
    const cookie = await devAnmelden();
    const r = await anfrage('/api/aufgaben', {
      cookie,
      body: { titel: 'Newsletter entwerfen', projekt_slug: 'familienplaner', zustaendig_id: 'assistent', automatisch_starten: true },
    });
    expect(r.status).toBe(201);
    expect(r.body.automatik.lauf).toBeGreaterThan(0);
    const l = await lauf(r.body.automatik.lauf);
    expect(l).not.toBeNull();
    // Lokal gibt es kein Workers AI → der Takt meldet einen verständlichen Fehler oder der Lauf wartet noch
    if (l!.status === 'wartet' || l!.status === 'laeuft') {
      const ab = await anfrage(`/api/automatik/laeufe/${r.body.automatik.lauf}/abbrechen`, { cookie, body: {} });
      expect([200, 409]).toContain(ab.status);
    }
    const ohne = await anfrage('/api/aufgaben', {
      cookie,
      body: { titel: 'Strategie skizzieren', projekt_slug: 'familienplaner', zustaendig_id: 'projektleitung', automatisch_starten: true },
    });
    expect(ohne.status).toBe(201);
    expect(ohne.body.automatik).toMatchObject({ lauf: null });
  });

  it('Claude Code ohne GitHub-Verbindung: klarer Fehler statt stiller Hänger', async () => {
    const cookie = await devAnmelden();
    const id = await aufgabe(cookie, 'technik', { projekt_slug: 'orchester' });
    const laufId = await laufAnlegen(env.DB, id);
    await laeufeAbarbeiten(env as unknown as Env);
    const l = await lauf(laufId);
    expect(l!.status).toBe('fehler');
    expect(l!.meldung).toMatch(/GitHub ist nicht verbunden/);
  });

  it('beendet hängengebliebene Läufe', async () => {
    const cookie = await devAnmelden();
    const id = await aufgabe(cookie, 'assistent');
    const laufId = await laufAnlegen(env.DB, id);
    await env.DB.prepare(`UPDATE ki_laeufe SET status = 'laeuft', aktualisiert_am = '2026-01-01T00:00:00.000Z' WHERE id = ?`).bind(laufId).run();
    await laeufeAbarbeiten(env as unknown as Env);
    expect(await lauf(laufId)).toMatchObject({ status: 'fehler' });
  });

  it('GitHub-Lauf meldet sich per MCP (lauf_melden): Start, Limit, nur eigene Läufe', async () => {
    const cookie = await devAnmelden();
    const z = await anfrage('/api/zugaenge', { cookie, body: { mitarbeiter_id: 'technik', bezeichnung: 'GitHub-Automatik', projekte: null } });
    const token = z.body.token as string;
    const rpc = async (args: Record<string, unknown>) => {
      const res = await SELF.fetch('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lauf_melden', arguments: args } }),
      });
      return ((await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
    };

    const id = await aufgabe(cookie, 'technik', { projekt_slug: 'orchester' });
    const laufId = await laufAnlegen(env.DB, id);
    await env.DB.prepare(`UPDATE ki_laeufe SET status = 'laeuft' WHERE id = ?`).bind(laufId).run();
    await anfrage(`/api/aufgaben/${id}`, { methode: 'PATCH', cookie, body: { version: 1, status: 'in_bearbeitung' } });

    const url = 'https://github.com/TE-Tools/TE-Digital-Zentrale/actions/runs/123456';
    expect((await rpc({ lauf: laufId, status: 'laeuft', url })).isError).toBeFalsy();
    expect(await lauf(laufId)).toMatchObject({ status: 'laeuft', extern_url: url });

    expect((await rpc({ lauf: laufId, status: 'laeuft', url: 'https://boese.example/x' })).isError).toBe(true);

    expect((await rpc({ lauf: laufId, status: 'limit' })).isError).toBeFalsy();
    expect(await lauf(laufId)).toMatchObject({ status: 'limit' });
    expect((await aufgabeLesen(id))!.status).toBe('wartend');

    // fremder Lauf (Assistent) ist für den Claude-Zugang tabu
    const fremd = await laufAnlegen(env.DB, await aufgabe(cookie, 'assistent'));
    const r = await rpc({ lauf: fremd, status: 'fertig' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/nicht gefunden/);
  });
});
