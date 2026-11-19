import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { cronAusfuehren } from '../src/cron';
import { vonBase64url, base64url } from '../src/lib/krypto';
import { entscheide, STANDARD_EINSTELLUNGEN } from '../src/lib/melden';
import { verschluessele } from '../src/lib/webpush';
import { berlin, inRuhezeit } from '../src/lib/zeit';
import { anfrage, devAnmelden } from './hilfe';

type Puffer = Uint8Array<ArrayBuffer>;
const p = (u: Uint8Array) => u as Puffer;

async function hkdf(salz: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) {
  const k = await crypto.subtle.importKey('raw', p(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: p(salz), info: p(info) }, k, n * 8));
}

/** Entschlüsselt wie ein Browser (RFC 8291) – beweist, dass unsere Verschlüsselung korrekt ist. */
async function browserEntschluesselt(nachricht: Uint8Array, empfaenger: CryptoKeyPair, auth: Uint8Array): Promise<string> {
  const salz = nachricht.slice(0, 16);
  const idLaenge = nachricht[20]!;
  const absenderPunkt = nachricht.slice(21, 21 + idLaenge);
  const chiffre = nachricht.slice(21 + idLaenge);
  const empfaengerPunkt = new Uint8Array((await crypto.subtle.exportKey('raw', empfaenger.publicKey)) as ArrayBuffer);
  const absender = await crypto.subtle.importKey('raw', p(absenderPunkt), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const gemeinsam = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: absender } as SubtleCryptoDeriveKeyAlgorithm, empfaenger.privateKey, 256));
  const enc = new TextEncoder();
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...empfaengerPunkt, ...absenderPunkt]);
  const ikm = await hkdf(auth, gemeinsam, info, 32);
  const cek = await hkdf(salz, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salz, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', p(cek), 'AES-GCM', false, ['decrypt']);
  const klar = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: p(nonce) }, key, p(chiffre)));
  expect(klar[klar.length - 1]).toBe(0x02);
  return new TextDecoder().decode(klar.slice(0, -1));
}

describe('Web Push Verschlüsselung (RFC 8291)', () => {
  it('ist für das Empfangsgerät entschlüsselbar', async () => {
    const empfaenger = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const punkt = new Uint8Array((await crypto.subtle.exportKey('raw', empfaenger.publicKey)) as ArrayBuffer);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const text = JSON.stringify({ titel: 'Freigabe erforderlich', text: 'Ä Ö Ü ß ✓' });
    const verschluesselt = await verschluessele(text, base64url(punkt), base64url(auth));
    expect(await browserEntschluesselt(verschluesselt, empfaenger, auth)).toBe(text);
    expect(vonBase64url(base64url(punkt))).toEqual(punkt);
  });
});

describe('Benachrichtigungsregeln', () => {
  it('Ruhezeiten auch über Mitternacht', () => {
    expect(inRuhezeit('23:10', '22:00', '07:00')).toBe(true);
    expect(inRuhezeit('06:59', '22:00', '07:00')).toBe(true);
    expect(inRuhezeit('07:00', '22:00', '07:00')).toBe(false);
    expect(inRuhezeit('13:00', '12:00', '14:00')).toBe(true);
    expect(inRuhezeit('13:00', null, null)).toBe(false);
  });

  it('Berliner Zeit inkl. Sommerzeit', () => {
    expect(berlin(new Date('2026-11-19T06:30:00Z'))).toMatchObject({ datum: '2026-11-19', hhmm: '07:30' });
    expect(berlin(new Date('2026-07-01T22:30:00Z'))).toMatchObject({ datum: '2026-07-02', hhmm: '00:30' });
  });

  it('entscheidet nach Kategorie, Einstellungen, Ruhezeit und Auslöser', () => {
    const nacht = new Date('2026-11-19T22:30:00Z'); // 23:30 Berlin
    const ruhe = { ...STANDARD_EINSTELLUNGEN, ruhe_von: '22:00', ruhe_bis: '07:00' };
    expect(entscheide({ kategorie: 'kritisch', titel: 'x' }, ruhe, false, nacht)).toBe('sofort');
    expect(entscheide({ kategorie: 'wichtig', titel: 'x' }, ruhe, false, nacht)).toBe('zurueckstellen');
    expect(entscheide({ kategorie: 'wichtig', titel: 'x' }, STANDARD_EINSTELLUNGEN, false, nacht)).toBe('sofort');
    expect(entscheide({ kategorie: 'wichtig', titel: 'x' }, { ...STANDARD_EINSTELLUNGEN, wichtig: 'gebuendelt' }, false, nacht)).toBe('zurueckstellen');
    expect(entscheide({ kategorie: 'wichtig', titel: 'x' }, { ...STANDARD_EINSTELLUNGEN, wichtig: 'aus' }, false, nacht)).toBe('unterdrueckt');
    expect(entscheide({ kategorie: 'kritisch', titel: 'x' }, STANDARD_EINSTELLUNGEN, true, nacht)).toBe('unterdrueckt');
  });
});

describe('Benachrichtigungs-API', () => {
  it('liefert einen stabilen VAPID-Schlüssel und Standard-Einstellungen', async () => {
    const cookie = await devAnmelden();
    const a = await anfrage('/api/benachrichtigungen/einstellungen', { cookie });
    const b = await anfrage('/api/benachrichtigungen/einstellungen', { cookie });
    expect(a.status).toBe(200);
    expect(vonBase64url(a.body.vapidSchluessel)).toHaveLength(65);
    expect(b.body.vapidSchluessel).toBe(a.body.vapidSchluessel);
    expect(a.body.einstellungen).toMatchObject({ kritisch: 'sofort', wichtig: 'sofort', tagesbericht_zeit: '07:30' });
  });

  it('speichert Einstellungen und prüft Ruhezeiten', async () => {
    const cookie = await devAnmelden();
    const gut = { kritisch: 'sofort', wichtig: 'gebuendelt', tagesbericht: true, tagesbericht_zeit: '08:00', ruhe_von: '22:00', ruhe_bis: '06:30' };
    expect((await anfrage('/api/benachrichtigungen/einstellungen', { methode: 'PUT', cookie, body: gut })).status).toBe(200);
    const e = await anfrage('/api/benachrichtigungen/einstellungen', { cookie });
    expect(e.body.einstellungen).toMatchObject({ wichtig: 'gebuendelt', ruhe_von: '22:00' });
    const halb = await anfrage('/api/benachrichtigungen/einstellungen', { methode: 'PUT', cookie, body: { ...gut, ruhe_bis: null } });
    expect(halb.status).toBe(400);
    const falsch = await anfrage('/api/benachrichtigungen/einstellungen', { methode: 'PUT', cookie, body: { ...gut, tagesbericht_zeit: '25:00' } });
    expect(falsch.status).toBe(400);
  });

  it('meldet Geräte an und lehnt interne Adressen ab', async () => {
    const cookie = await devAnmelden();
    const keys = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
    expect((await anfrage('/api/benachrichtigungen/abo', { cookie, body: { endpoint: 'https://127.0.0.1/x', keys } })).status).toBe(400);
    expect((await anfrage('/api/benachrichtigungen/abo', { cookie, body: { endpoint: 'http://push.example/x', keys } })).status).toBe(400);
    const ok = await anfrage('/api/benachrichtigungen/abo', { cookie, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys, geraet: 'Pixel' } });
    expect(ok.status).toBe(201);
    const e = await anfrage('/api/benachrichtigungen/einstellungen', { cookie });
    expect(e.body.geraete).toHaveLength(1);
    expect(e.body.geraete[0]).toMatchObject({ geraet: 'Pixel', dienst: 'fcm.googleapis.com' });
    expect(e.body.geraete[0].endpoint).toBeUndefined();
    await anfrage('/api/benachrichtigungen/abo/abmelden', { cookie, body: { id: e.body.geraete[0].id } });
    expect((await anfrage('/api/benachrichtigungen/einstellungen', { cookie })).body.geraete).toHaveLength(0);
  });

  it('eigene Aktionen erscheinen nur gelesen im Posteingang, ohne Push', async () => {
    const cookie = await devAnmelden();
    await anfrage('/api/freigaben', { cookie, body: { typ: 'kosten', titel: 'Domain registrieren', dringend: true } });
    const n = await anfrage('/api/benachrichtigungen', { cookie });
    const eintrag = n.body.benachrichtigungen.find((b: { titel: string }) => b.titel.includes('Domain registrieren'));
    expect(eintrag).toMatchObject({ kategorie: 'kritisch', push_status: 'unterdrueckt', url: '/freigaben' });
    expect(eintrag.gelesen_am).not.toBeNull();
  });
});

describe('Cron', () => {
  it('meldet abgelaufene Limit-Pausen genau einmal', async () => {
    const cookie = await devAnmelden();
    const r = await anfrage('/api/aufgaben', { cookie, body: { titel: 'Konkurrenzanalyse', projekt_slug: 'minigames', zustaendig_id: 'qualitaet' } });
    const id = r.body.id;
    await anfrage(`/api/aufgaben/${id}/limit`, { cookie, body: { bis: new Date(Date.now() + 3_600_000).toISOString() } });
    await env.DB.prepare(`UPDATE mitarbeiter SET limit_bis = ? WHERE id = 'qualitaet'`).bind(new Date(Date.now() - 60_000).toISOString()).run();

    const s1 = await cronAusfuehren(env);
    const s2 = await cronAusfuehren(env);
    expect(s1.limits).toBeGreaterThanOrEqual(1);
    const n = await anfrage('/api/benachrichtigungen', { cookie });
    const treffer = n.body.benachrichtigungen.filter((b: { url: string }) => b.url === `/aufgaben/${id}`);
    expect(treffer).toHaveLength(1);
    expect(treffer[0]).toMatchObject({ kategorie: 'wichtig', titel: 'Grok wieder verfügbar' });
    expect(['kein_geraet', 'gesendet', 'offen']).toContain(treffer[0].push_status);
    expect(s2.limits).toBe(s1.limits); // dieselbe Abfrage, aber per Schlüssel entdoppelt
  });

  it('erstellt den Tagesbericht einmal pro Tag', async () => {
    const cookie = await devAnmelden();
    await anfrage('/api/benachrichtigungen/einstellungen', {
      methode: 'PUT',
      cookie,
      body: { kritisch: 'sofort', wichtig: 'sofort', tagesbericht: true, tagesbericht_zeit: '00:00', ruhe_von: null, ruhe_bis: null },
    });
    // Speicher wird innerhalb der Datei geteilt – frühere Cron-Läufe zurücksetzen
    await env.DB.batch([
      env.DB.prepare('UPDATE benachrichtigungs_einstellungen SET letzter_tagesbericht = NULL'),
      env.DB.prepare(`DELETE FROM benachrichtigungen WHERE kategorie = 'tagesbericht'`),
    ]);
    const a = await cronAusfuehren(env);
    const b = await cronAusfuehren(env);
    expect(a.berichte).toBe(1);
    expect(b.berichte).toBe(0);
    const n = await anfrage('/api/benachrichtigungen', { cookie });
    const bericht = n.body.benachrichtigungen.find((x: { kategorie: string }) => x.kategorie === 'tagesbericht');
    expect(bericht.titel).toMatch(/^Tagesbericht \d{2}\.\d{2}\.\d{4}$/);
    expect(bericht.text).toContain('erledigt');
    expect(bericht.url).toMatch(/^\/berichte\/\d+$/);
  });
});

describe('Echtzeit', () => {
  it('verlangt Anmeldung und eigene Origin', async () => {
    const cookie = await devAnmelden();
    const ohne = await SELF.fetch('http://localhost/api/live', { headers: { upgrade: 'websocket', origin: 'http://localhost' } });
    expect(ohne.status).toBe(401);
    const fremd = await SELF.fetch('http://localhost/api/live', { headers: { upgrade: 'websocket', origin: 'https://boese.example', cookie } });
    expect(fremd.status).toBe(403);
  });

  it('verteilt Änderungen an verbundene Geräte', async () => {
    const cookie = await devAnmelden();
    const res = await SELF.fetch('http://localhost/api/live', { headers: { upgrade: 'websocket', origin: 'http://localhost', cookie } });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const empfangen = new Promise<string>((ok) => ws.addEventListener('message', (e) => ok(String(e.data))));
    await anfrage('/api/projekte/orchester', { methode: 'PATCH', cookie, body: { kurz: 'Live-Test', version: (await anfrage('/api/projekte/orchester', { cookie })).body.projekt.version } });
    const nachricht = JSON.parse(await empfangen);
    expect(nachricht).toMatchObject({ art: 'geaendert', pfad: '/api/projekte/orchester' });
    ws.close();
  });
});
