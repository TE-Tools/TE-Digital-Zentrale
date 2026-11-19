import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { appJwt, entschluesseln, pemZuPkcs8, verschluesseln, webhookPruefen } from '../src/lib/github';
import { base64url, vonBase64url } from '../src/lib/krypto';
import { aufgabeAusBranch, branchVorschlag, listenUeberschneidung, ueberschneiden } from '../src/lib/pfade';
import { anfrage, devAnmelden } from './hilfe';

const testEnv = { ...env, ZENTRALE_SCHLUESSEL: base64url(crypto.getRandomValues(new Uint8Array(32))) };

// ------------------------------------------------------------------ Hilfen

async function zugangErstellen(cookie: string, mitarbeiter = 'technik', projekte: string[] | null = null): Promise<string> {
  const r = await anfrage('/api/zugaenge', { cookie, body: { mitarbeiter_id: mitarbeiter, bezeichnung: 'Test', projekte } });
  expect(r.status).toBe(201);
  return r.body.token;
}

async function mcp(token: string | null, methode: string, params: Record<string, unknown> = {}, extraHeader: Record<string, string> = {}) {
  const res = await SELF.fetch('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeader },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: methode, params }),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { roh: text };
  }
  return { status: res.status, body };
}

async function werkzeug(token: string, name: string, args: Record<string, unknown> = {}) {
  const r = await mcp(token, 'tools/call', { name, arguments: args });
  return { ...r.body.result, text: r.body.result?.content?.[0]?.text as string };
}

async function aufgabe(cookie: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await anfrage('/api/aufgaben', { cookie, body: { titel: 'Login absichern', projekt_slug: 'orchester', zustaendig_id: 'technik', ...extra } });
  return r.body.id;
}

// ------------------------------------------------------------------ Logik

describe('Pfade, Branches', () => {
  it('erkennt Überschneidungen von Dateien und Mustern', () => {
    expect(ueberschneiden('web/index.html', 'web/index.html')).toBe(true);
    expect(ueberschneiden('web/index.html', 'web/app.js')).toBe(false);
    expect(ueberschneiden('web/**', 'web/index.html')).toBe(true);
    expect(ueberschneiden('worker/src/', 'worker/src/auth.js')).toBe(true);
    expect(ueberschneiden('worker/src/**', 'worker/tests/x.js')).toBe(false);
    expect(ueberschneiden('worker/**', 'worker/src/**')).toBe(true);
    expect(listenUeberschneidung(['a/x.ts', 'b/y.ts'], ['b/**'])).toEqual(['b/y.ts']);
  });

  it('Branch-Konvention', () => {
    expect(branchVorschlag('TD-0007', 'Login absichern (Passkeys) & Größe')).toBe('aufgabe/td-0007-login-absichern-passkeys-groesse');
    expect(aufgabeAusBranch('aufgabe/td-0007-login')).toBe('TD-0007');
    expect(aufgabeAusBranch('feature/TD0012')).toBe('TD-0012');
    expect(aufgabeAusBranch('main')).toBeNull();
  });
});

describe('GitHub-Krypto', () => {
  it('verschlüsselt gespeicherte Geheimnisse (AES-GCM) und erkennt Manipulation', async () => {
    const v = await verschluesseln(testEnv, '-----BEGIN RSA PRIVATE KEY-----geheim');
    expect(v.startsWith('v1.')).toBe(true);
    expect(v).not.toContain('geheim');
    expect(await entschluesseln(testEnv, v)).toBe('-----BEGIN RSA PRIVATE KEY-----geheim');
    const kaputt = v.slice(0, -3) + (v.endsWith('A') ? 'BBB' : 'AAA');
    await expect(entschluesseln(testEnv, kaputt)).rejects.toThrow();
  });

  it('wandelt GitHubs PKCS#1-Schlüssel um und signiert ein gültiges App-JWT', async () => {
    const paar = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const pkcs8 = new Uint8Array((await crypto.subtle.exportKey('pkcs8', paar.privateKey)) as ArrayBuffer);
    // PKCS#1 steckt im PKCS#8 als OCTET STRING nach Version (3 Byte) und Algorithmus (15 Byte)
    const kopf = pkcs8[1]! & 0x80 ? 2 + (pkcs8[1]! & 0x7f) : 2;
    let pos = kopf + 3 + 15;
    const lenByte = pkcs8[pos + 1]!;
    pos += lenByte & 0x80 ? 2 + (lenByte & 0x7f) : 2;
    const pkcs1 = pkcs8.slice(pos);
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs1))}\n-----END RSA PRIVATE KEY-----`;
    expect(pemZuPkcs8(pem)).toEqual(pkcs8);

    const jwt = await appJwt(12345, pem, 1_800_000_000);
    const [k, i, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(vonBase64url(i!)))).toEqual({ iat: 1_799_999_940, exp: 1_800_000_540, iss: 12345 });
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', paar.publicKey, vonBase64url(s!) as Uint8Array<ArrayBuffer>, new TextEncoder().encode(`${k}.${i}`));
    expect(ok).toBe(true);
  });

  it('prüft Webhook-Signaturen', async () => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('geheim'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('{"a":1}')));
    const sig = 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await webhookPruefen('geheim', '{"a":1}', sig)).toBe(true);
    expect(await webhookPruefen('geheim', '{"a":2}', sig)).toBe(false);
    expect(await webhookPruefen('anders', '{"a":1}', sig)).toBe(false);
    expect(await webhookPruefen('geheim', '{"a":1}', undefined)).toBe(false);
  });
});

describe('GitHub-Verbindung (ohne Netz)', () => {
  it('Status ist zunächst getrennt; Einrichtung braucht Passkey und Schlüssel', async () => {
    const cookie = await devAnmelden();
    const s = await anfrage('/api/github/status', { cookie });
    expect(s.body.verbindung).toMatchObject({ status: 'getrennt', organisation: 'TE-Tools' });
    expect(s.body.rechte).toEqual({ metadata: 'read', pull_requests: 'read', checks: 'read', issues: 'write' });
    // Ohne ZENTRALE_SCHLUESSEL in der Testumgebung → 503
    const e = await anfrage('/api/github/einrichten', { cookie, body: {} });
    expect(e.status).toBe(503);
    expect(e.body.fehler.code).toBe('schluessel_fehlt');
  });

  it('Rückkehr ohne gültiges state wird abgewiesen (kein Aufruf bei GitHub)', async () => {
    const r = await SELF.fetch('http://localhost/api/github/rueckkehr?code=abcdefghijkl&state=gefaelscht', { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/einstellungen?github=ungueltig');
  });

  it('Webhook ohne Verbindung bzw. ohne Signatur wird abgewiesen, auch ohne CSRF-Header erreichbar', async () => {
    const r = await SELF.fetch('http://localhost/api/github/webhook', { method: 'POST', body: '{}', headers: { 'x-github-event': 'ping' } });
    expect(r.status).toBe(404);
  });
});

// ------------------------------------------------------------------ KI-Zugänge & MCP

describe('KI-Zugänge', () => {
  it('Anlegen verlangt Passkey-Bestätigung, Token nur einmal sichtbar, Widerruf sperrt sofort', async () => {
    const cookie = await devAnmelden();
    const token = await zugangErstellen(cookie);
    expect(token).toMatch(/^tez_[A-Za-z0-9_-]{40,}$/);
    const liste = await anfrage('/api/zugaenge', { cookie });
    const z = liste.body.zugaenge[0];
    expect(z.token_anfang).toBe(token.slice(0, 10));
    expect(JSON.stringify(liste.body)).not.toContain(token);

    expect((await mcp(token, 'ping')).status).toBe(200);
    await anfrage(`/api/zugaenge/${z.id}/widerrufen`, { cookie, body: {} });
    expect((await mcp(token, 'ping')).status).toBe(401);

    await env.DB.prepare('UPDATE sitzungen SET bestaetigt_am = ?').bind(new Date(Date.now() - 600_000).toISOString()).run();
    const ohne = await anfrage('/api/zugaenge', { cookie, body: { mitarbeiter_id: 'technik', bezeichnung: 'x' } });
    expect(ohne.body.fehler.code).toBe('bestaetigung_noetig');
  });
});

describe('MCP-Server', () => {
  it('verlangt ein Token und prüft die Origin', async () => {
    expect((await mcp(null, 'initialize')).status).toBe(401);
    const cookie = await devAnmelden();
    const token = await zugangErstellen(cookie);
    expect((await mcp(token, 'initialize', {}, { origin: 'https://boese.example' })).status).toBe(403);
    const get = await SELF.fetch('http://localhost/mcp', { headers: { authorization: `Bearer ${token}` } });
    expect(get.status).toBe(405);
  });

  it('initialize, tools/list und Benachrichtigungen', async () => {
    const cookie = await devAnmelden();
    const token = await zugangErstellen(cookie);
    const init = await mcp(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'te-digital-zentrale' }, capabilities: { tools: {} } });
    expect(init.body.result.instructions).toContain('Technische Leitung');
    const liste = await mcp(token, 'tools/list');
    const namen = liste.body.result.tools.map((t: { name: string }) => t.name);
    expect(namen).toEqual(expect.arrayContaining(['meine_aufgaben', 'aufgabe_lesen', 'ergebnis_melden', 'freigabe_beantragen', 'sperre_setzen']));
    expect(namen).not.toContain('freigabe_entscheiden');
    const notif = await SELF.fetch('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(notif.status).toBe(202);
    expect((await mcp(token, 'resources/list')).body.error.code).toBe(-32601);
  });

  it('kompletter Arbeitsablauf als Claude Code über MCP', async () => {
    const cookie = await devAnmelden();
    const token = await zugangErstellen(cookie);
    const id = await aufgabe(cookie, { uebergabe: { ziel: 'Passkeys statt Passwörter' } });

    const liste = await werkzeug(token, 'meine_aufgaben');
    expect(liste.text).toContain(id);

    const paket = await werkzeug(token, 'aufgabe_lesen', { id });
    expect(paket.text).toContain(`# Auftrag ${id}`);
    expect(paket.text).toContain('Passkeys statt Passwörter');

    const start = await werkzeug(token, 'aufgabe_starten', { id });
    expect(start.isError).toBeFalsy();
    expect(start.text).toContain(`aufgabe/${id.toLowerCase()}-login-absichern`);

    expect((await werkzeug(token, 'branch_melden', { id, branch: `aufgabe/${id.toLowerCase()}-login` })).isError).toBeFalsy();
    expect((await werkzeug(token, 'zwischenstand_speichern', { id, zusammenfassung: 'WebAuthn-Grundgerüst steht' })).isError).toBeFalsy();
    const sperre = await werkzeug(token, 'sperre_setzen', { aufgabe_id: id, repo: 'TE-Tools/orchester-orga', pfade: ['worker/src/auth.js'] });
    expect(sperre.isError).toBeFalsy();

    const erg = await werkzeug(token, 'ergebnis_melden', {
      id,
      text: 'ERGEBNIS: PR #12 bereit\nOFFENE FRAGEN: keine\nFREIGABEANTRÄGE: Merge in main und Deploy\nZWISCHENSTAND: Tests grün, wartet auf Freigabe',
    });
    expect(erg.structuredContent.status).toBe('freigabe_erforderlich');

    const d = await anfrage(`/api/aufgaben/${id}`, { cookie });
    expect(d.body.aufgabe).toMatchObject({ status: 'freigabe_erforderlich', branch: `aufgabe/${id.toLowerCase()}-login` });
    expect(d.body.freigaben[0].angefragt_von).toBe('technik');

    // Audit: als Mitarbeiter protokolliert
    const akt = await env.DB.prepare(`SELECT akteur_typ, akteur_id FROM aktivitaeten WHERE objekt_id = ? AND aktion = 'aufgabe.ergebnis'`).bind(id).first();
    expect(akt).toEqual({ akteur_typ: 'mitarbeiter', akteur_id: 'technik' });

    // Ergebnis eines KI-Mitarbeiters ist keine eigene Aktion der GF → Push-Meldung wird angelegt (nicht unterdrückt)
    const b = await anfrage('/api/benachrichtigungen', { cookie });
    const m = b.body.benachrichtigungen.find((x: { titel: string }) => x.titel === `Neues Ergebnis zu ${id}`);
    expect(m.push_status).not.toBe('unterdrueckt');
  });

  it('erlaubt keine fremden Aufgaben, keine GF-Rechte, keine fremden Projekte', async () => {
    const cookie = await devAnmelden();
    const token = await zugangErstellen(cookie, 'technik', ['zentrale']);
    const fremd = await aufgabe(cookie, { zustaendig_id: 'marketing', projekt_slug: 'zentrale' });
    const anderesProjekt = await aufgabe(cookie); // orchester

    expect((await werkzeug(token, 'aufgabe_lesen', { id: fremd })).text).toContain('anderen Mitarbeiter');
    expect((await werkzeug(token, 'aufgabe_lesen', { id: anderesProjekt })).text).toContain('Kein Zugriff');
    expect((await werkzeug(token, 'meine_aufgaben')).text).not.toContain(anderesProjekt);
    expect((await werkzeug(token, 'projekt_kontext', { projekt: 'orchester' })).isError).toBe(true);

    // Abschließen setzt nur die Geschäftsführung
    const eigene = await aufgabe(cookie, { projekt_slug: 'zentrale' });
    const r = await mcp(token, 'tools/call', { name: 'status_melden', arguments: { id: eigene, status: 'abgeschlossen' } });
    expect(r.body.error?.code === -32602 || r.body.result?.isError).toBe(true);

    // Stufe 3 nicht über Entscheidungen
    expect((await werkzeug(token, 'entscheidung_dokumentieren', { stufe: 3, titel: 'Produktiv' })).isError).toBe(true);
  });
});

describe('Sperren & Konflikte', () => {
  it('verhindert überlappende Sperren und löst sie beim Abschluss', async () => {
    const cookie = await devAnmelden();
    const a = await aufgabe(cookie);
    const b = await aufgabe(cookie);
    const s1 = await anfrage('/api/sperren', { cookie, body: { aufgabe_id: a, repo: 'TE-Tools/sperren-test', pfade: ['web/**'] } });
    expect(s1.status).toBe(201);
    const s2 = await anfrage('/api/sperren', { cookie, body: { aufgabe_id: b, repo: 'TE-Tools/sperren-test', pfade: ['web/index.html'] } });
    expect(s2.status).toBe(409);
    expect(s2.body.fehler.message ?? s2.body.fehler.meldung).toContain(a);
    expect((await anfrage('/api/sperren', { cookie, body: { aufgabe_id: b, repo: 'TE-Tools/sperren-test', pfade: ['worker/**'] } })).status).toBe(201);

    // a abbrechen → Sperre frei → b kann web/ sperren
    const v = (await anfrage(`/api/aufgaben/${a}`, { cookie })).body.aufgabe.version;
    await anfrage(`/api/aufgaben/${a}`, { methode: 'PATCH', cookie, body: { version: v, status: 'abgebrochen' } });
    expect((await anfrage('/api/sperren', { cookie, body: { aufgabe_id: b, repo: 'TE-Tools/sperren-test', pfade: ['web/index.html'] } })).status).toBe(201);
  });

  it('erkennt PRs, die dieselben Dateien ändern oder fremde Sperren berühren', async () => {
    const cookie = await devAnmelden();
    const a = await aufgabe(cookie);
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO github_repos (full_name, url, projekt_slug) VALUES ('TE-Tools/orchester-orga', 'https://github.com/TE-Tools/orchester-orga', 'orchester')`),
      env.DB.prepare(
        `INSERT INTO github_prs (repo, nummer, titel, zustand, branch, ziel_branch, url, dateien, aktualisiert_am) VALUES
         ('TE-Tools/orchester-orga', 101, 'Proben', 'offen', 'feature/proben', 'main', 'https://github.com/x/1', '["web/dashboard.html","web/app.js"]', '2026-11-19T10:00:00Z'),
         ('TE-Tools/orchester-orga', 102, 'Design', 'offen', 'feature/design', 'main', 'https://github.com/x/2', '["web/dashboard.html"]', '2026-11-19T10:00:00Z')`,
      ),
    ]);
    await anfrage('/api/sperren', { cookie, body: { aufgabe_id: a, repo: 'TE-Tools/orchester-orga', pfade: ['web/app.js'] } }).catch(() => undefined);
    const e = await anfrage('/api/entwicklung', { cookie });
    expect(e.status).toBe(200);
    const arten = e.body.konflikte.map((k: { art: string; dateien: string[] }) => `${k.art}:${k.dateien.join(',')}`);
    expect(arten).toContain('pr_pr:web/dashboard.html');
    expect(arten.some((x: string) => x.startsWith('pr_sperre:') && x.includes('web/app.js'))).toBe(true);
  });
});
