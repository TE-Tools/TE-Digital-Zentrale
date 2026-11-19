/**
 * Phase 7 – Sicherheits- und Rechteprüfung (Pflichtenheft 12, 17 Phase 7)
 */
import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { alsAgent } from '../src/lib/agent';
import { base64url, sha256Hex, zufallsBytes } from '../src/lib/krypto';
import { anfrage, devAnmelden } from './hilfe';

/** Legt einen Benutzer mit Rolle 'leser' samt gültiger Sitzung an und liefert den Cookie. */
async function leserCookie(): Promise<string> {
  const id = base64url(zufallsBytes(16));
  const token = base64url(zufallsBytes(32));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO benutzer (id, name, rolle) VALUES (?, 'Lesezugang', 'leser')`).bind(id),
    env.DB.prepare(`INSERT INTO sitzungen (token_hash, benutzer_id, ablauf_am, bestaetigt_am) VALUES (?, ?, ?, ?)`).bind(
      await sha256Hex(token),
      id,
      new Date(Date.now() + 86_400_000).toISOString(),
      new Date().toISOString(),
    ),
  ]);
  return `te_sitzung=${token}`;
}

describe('Rollen & Rechte', () => {
  it('Lesezugang darf lesen, aber nichts ändern oder freigeben', async () => {
    const gf = await devAnmelden();
    const leser = await leserCookie();
    const f = await anfrage('/api/freigaben', { cookie: gf, body: { typ: 'kosten', titel: 'Rechtetest' } });

    for (const pfad of ['/api/dashboard', '/api/aufgaben', '/api/projekte', '/api/wissen', '/api/berichte', '/api/freigaben']) {
      expect((await anfrage(pfad, { cookie: leser })).status, pfad).toBe(200);
    }
    const verboten: [string, string, unknown][] = [
      ['POST', '/api/projekte', { slug: 'x-test', name: 'X Test' }],
      ['POST', '/api/aufgaben', { titel: 'Darf nicht', projekt_slug: 'zentrale' }],
      ['POST', `/api/freigaben/${f.body.id}/entscheiden`, { entscheidung: 'erteilt' }],
      ['POST', '/api/nachrichten', { art: 'notiz', inhalt: 'x' }],
      ['POST', '/api/wissen', { titel: 'Darf nicht', kategorie: 'anleitung' }],
      ['POST', '/api/zugaenge', { mitarbeiter_id: 'technik', bezeichnung: 'x' }],
      ['POST', '/api/github/einrichten', {}],
      ['POST', '/api/berichte/tag', {}],
    ];
    for (const [methode, pfad, body] of verboten) {
      expect((await anfrage(pfad, { methode, cookie: leser, body })).status, `${methode} ${pfad}`).toBe(403);
    }
    // Verwaltung (Zugänge) ist auch lesend nur für die Geschäftsführung
    expect((await anfrage('/api/zugaenge', { cookie: leser })).status).toBe(403);
  });

  it('abgelaufene Sitzungen werden abgewiesen', async () => {
    const cookie = await devAnmelden();
    const token = cookie.split('=')[1]!;
    await env.DB.prepare('UPDATE sitzungen SET ablauf_am = ? WHERE token_hash = ?').bind('2020-01-01T00:00:00.000Z', await sha256Hex(token)).run();
    expect((await anfrage('/api/dashboard', { cookie })).status).toBe(401);
  });

  it('Anmeldung per Wiederherstellungscode reicht nicht für Stufe-3-Freigaben', async () => {
    const gf = await devAnmelden();
    const b = await env.DB.prepare(`SELECT id FROM benutzer WHERE rolle = 'gf' LIMIT 1`).first<{ id: string }>();
    await env.DB.prepare('INSERT INTO wiederherstellungscodes (hash, benutzer_id) VALUES (?, ?)').bind(await sha256Hex('QQQQ-WWWW-ZZZZ'), b!.id).run();
    const r = await SELF.fetch('http://localhost/api/auth/wiederherstellung', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-te-anfrage': '1', 'cf-connecting-ip': '198.51.100.7' },
      body: JSON.stringify({ code: 'QQQQ-WWWW-ZZZZ' }),
    });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]!;
    const f = await anfrage('/api/freigaben', { cookie: gf, body: { typ: 'loeschung', titel: 'Daten löschen' } });
    const e = await anfrage(`/api/freigaben/${f.body.id}/entscheiden`, { cookie, body: { entscheidung: 'erteilt' } });
    expect(e.body.fehler.code).toBe('bestaetigung_noetig');
  });
});

describe('KI-Mitarbeiter: Routen-Whitelist (zweite Sicherungsschicht)', () => {
  const agent = { zugangId: 1, mitarbeiterId: 'technik', name: 'Claude Code', rolle: 'Technische Leitung', projekte: null };
  async function alsKi(methode: string, pfad: string, body?: unknown) {
    const req = new Request(`http://localhost${pfad}`, {
      method: methode,
      headers: { 'content-type': 'application/json', 'x-te-anfrage': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await app.fetch(alsAgent(req, agent), env, createExecutionContext());
    return { status: res.status, body: (await res.json()) as { fehler?: { code: string } } };
  }

  it('blockiert alle nicht freigegebenen Wege', async () => {
    for (const [m, p, b] of [
      ['GET', '/api/zugaenge', undefined],
      ['POST', '/api/zugaenge', { mitarbeiter_id: 'technik', bezeichnung: 'x' }],
      ['POST', '/api/freigaben/FG-0001/entscheiden', { entscheidung: 'erteilt' }],
      ['POST', '/api/projekte', { slug: 'ki-projekt', name: 'KI Projekt' }],
      ['POST', '/api/github/trennen', {}],
      ['POST', '/api/benachrichtigungen/abo', {}],
      ['GET', '/api/dashboard', undefined],
      ['POST', '/api/aufgaben', { titel: 'Selbst angelegt', projekt_slug: 'zentrale' }],
    ] as const) {
      const r = await alsKi(m, p, b);
      expect(r.status, `${m} ${p}`).toBe(403);
      expect(r.body.fehler?.code).toBe('agent_nicht_erlaubt');
    }
  });
});

describe('Sitzungs-Cookie, CSRF, Fehlermeldungen', () => {
  it('setzt unter HTTPS ein __Host-Cookie mit HttpOnly, Secure, SameSite=Strict', async () => {
    const r = await SELF.fetch('https://localhost/api/auth/dev-anmeldung', { method: 'POST', headers: { 'x-te-anfrage': '1' } });
    const c = r.headers.get('set-cookie') ?? '';
    expect(c).toMatch(/^__Host-te_sitzung=/);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\//);
    expect(c).not.toMatch(/Domain=/i);
  });

  it('lehnt Schreibzugriffe ohne CSRF-Header auch mit gültiger Sitzung ab', async () => {
    const cookie = await devAnmelden();
    const r = await anfrage('/api/aufgaben', { cookie, body: { titel: 'CSRF', projekt_slug: 'zentrale' }, ohneCsrf: true });
    expect(r.status).toBe(403);
  });

  it('gibt bei kaputten Eingaben keine internen Details preis', async () => {
    const cookie = await devAnmelden();
    const r = await SELF.fetch('http://localhost/api/aufgaben', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-te-anfrage': '1' },
      body: '{kaputt',
    });
    const text = await r.text();
    expect(r.status).toBe(400);
    expect(text).not.toMatch(/at |\.ts:|stack/i);
  });
});

describe('Drosselung', () => {
  it('begrenzt Anmeldeversuche je Anschluss (gegen Durchprobieren)', async () => {
    const versuch = () =>
      SELF.fetch('http://localhost/api/auth/wiederherstellung', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-te-anfrage': '1', 'cf-connecting-ip': '203.0.113.99' },
        body: JSON.stringify({ code: 'AAAA-BBBB-CCCC' }),
      });
    const status: number[] = [];
    for (let i = 0; i < 12; i++) status.push((await versuch()).status);
    expect(status.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(status.slice(10)).toEqual([429, 429]);
    // Anderer Anschluss ist nicht betroffen
    const anderer = await SELF.fetch('http://localhost/api/auth/anmelden/optionen', {
      method: 'POST',
      headers: { 'x-te-anfrage': '1', 'cf-connecting-ip': '203.0.113.100' },
    });
    expect(anderer.status).toBe(200);
  });

  it('begrenzt den MCP-Endpunkt', async () => {
    const statusse: number[] = [];
    for (let i = 0; i < 122; i++) {
      const r = await SELF.fetch('http://localhost/mcp', { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.50', authorization: 'Bearer tez_ungueltig' }, body: '{}' });
      statusse.push(r.status);
    }
    expect(statusse.slice(0, 120).every((s) => s === 401)).toBe(true);
    expect(statusse.at(-1)).toBe(429);
  });
});
