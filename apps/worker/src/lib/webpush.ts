/**
 * Web Push ohne fremden Dienst und ohne Bibliothek (Portierung aus orchester-orga/worker/src/webpush.js).
 *   RFC 8291 – Ende-zu-Ende-Verschlüsselung des Inhalts (aes128gcm): Der Push-Dienst von Google,
 *              Mozilla oder Apple leitet nur weiter, lesen kann nur das Gerät.
 *   RFC 8292 – VAPID: signiertes Token, damit niemand in unserem Namen sendet.
 *
 * Schlüssel: Secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY haben Vorrang. Fehlen sie, erzeugt der
 * Worker einmalig ein Paar und speichert es in D1 (nie ersetzen – sonst werden alle Geräte-Abos ungültig).
 */
import type { Env } from '../env';
import { base64url, vonBase64url } from './krypto';

export interface PushAbo {
  id?: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushNachricht {
  titel: string;
  text: string;
  url: string;
  kategorie: 'kritisch' | 'wichtig' | 'tagesbericht';
  tag?: string;
}

interface VapidSchluessel {
  oeffentlich: string; // 65-Byte-Punkt, base64url
  privat: string; // d (32 Byte), base64url
  betreff: string;
}

function verbinde(...teile: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(teile.reduce((n, t) => n + t.length, 0));
  let pos = 0;
  for (const t of teile) {
    out.set(t, pos);
    pos += t.length;
  }
  return out;
}

type Puffer = Uint8Array<ArrayBuffer>;
const p = (u: Uint8Array) => u as Puffer;

async function hkdf(salz: Uint8Array, ikm: Uint8Array, info: Uint8Array, laenge: number): Promise<Uint8Array> {
  const basis = await crypto.subtle.importKey('raw', p(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: p(salz), info: p(info) }, basis, laenge * 8);
  return new Uint8Array(bits);
}

// ------------------------------------------------------------------ Schlüssel

let cache: VapidSchluessel | null = null;

export async function erzeugeVapidPaar(): Promise<{ oeffentlich: string; privat: string }> {
  const paar = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', paar.privateKey)) as JsonWebKey;
  const roh = new Uint8Array((await crypto.subtle.exportKey('raw', paar.publicKey)) as ArrayBuffer);
  return { oeffentlich: base64url(roh), privat: jwk.d! };
}

export async function vapidSchluessel(env: Env): Promise<VapidSchluessel> {
  const betreff = env.VAPID_SUBJECT || 'mailto:zentrale@te-alltagshelfer.org';
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { oeffentlich: env.VAPID_PUBLIC_KEY, privat: env.VAPID_PRIVATE_KEY, betreff };
  }
  if (cache) return cache;
  const lesen = () =>
    env.DB.prepare(`SELECT name, wert FROM system_schluessel WHERE name IN ('vapid_oeffentlich','vapid_privat')`).all<{ name: string; wert: string }>();
  let r = await lesen();
  if (r.results.length < 2) {
    const neu = await erzeugeVapidPaar();
    // INSERT OR IGNORE: bei gleichzeitigen Anfragen gewinnt die erste, danach neu lesen
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO system_schluessel (name, wert) VALUES ('vapid_oeffentlich', ?)`).bind(neu.oeffentlich),
      env.DB.prepare(`INSERT OR IGNORE INTO system_schluessel (name, wert) VALUES ('vapid_privat', ?)`).bind(neu.privat),
    ]);
    r = await lesen();
  }
  const m = Object.fromEntries(r.results.map((x) => [x.name, x.wert]));
  cache = { oeffentlich: m.vapid_oeffentlich!, privat: m.vapid_privat!, betreff };
  return cache;
}

/** Nur für Tests: Zwischenspeicher leeren. */
export function vapidCacheLeeren(): void {
  cache = null;
}

// ------------------------------------------------------------------ VAPID-Token (RFC 8292)

async function vapidKopf(endpoint: string, s: VapidSchluessel): Promise<string> {
  const ziel = new URL(endpoint);
  const enc = new TextEncoder();
  const kopf = base64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const inhalt = base64url(
    enc.encode(JSON.stringify({ aud: `${ziel.protocol}//${ziel.host}`, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: s.betreff })),
  );
  const punkt = vonBase64url(s.oeffentlich);
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: s.privat, x: base64url(punkt.slice(1, 33)), y: base64url(punkt.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${kopf}.${inhalt}`)));
  return `vapid t=${kopf}.${inhalt}.${base64url(sig)}, k=${s.oeffentlich}`;
}

// ------------------------------------------------------------------ Verschlüsselung (RFC 8291)

export async function verschluessele(text: string, p256dh: string, authB64: string): Promise<Uint8Array> {
  const empfaenger = vonBase64url(p256dh);
  const authGeheimnis = vonBase64url(authB64);
  const paar = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const eigener = new Uint8Array((await crypto.subtle.exportKey('raw', paar.publicKey)) as ArrayBuffer);
  const empfaengerKey = await crypto.subtle.importKey('raw', p(empfaenger), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const gemeinsam = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: empfaengerKey } as SubtleCryptoDeriveKeyAlgorithm, paar.privateKey, 256),
  );
  const enc = new TextEncoder();
  const ikm = await hkdf(authGeheimnis, gemeinsam, verbinde(enc.encode('WebPush: info\0'), empfaenger, eigener), 32);
  const salz = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salz, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salz, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', p(cek), 'AES-GCM', false, ['encrypt']);
  const chiffre = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: p(nonce) }, aes, p(verbinde(enc.encode(text), new Uint8Array([0x02])))),
  );
  const block = new Uint8Array(4);
  new DataView(block.buffer).setUint32(0, 4096);
  return verbinde(salz, block, new Uint8Array([eigener.length]), eigener, chiffre);
}

// ------------------------------------------------------------------ Versand

export type PushErgebnis = { ok: true } | { ok: false; veraltet?: boolean; grund: string };

export async function sendePush(env: Env, abo: PushAbo, nachricht: PushNachricht, basisUrl: string): Promise<PushErgebnis> {
  try {
    // Volle Adresse: der Klick landet sicher in der Zentrale (Lehre aus orchester-orga, 10.11.2026)
    const url = nachricht.url.startsWith('/') ? basisUrl.replace(/\/+$/, '') + nachricht.url : nachricht.url;
    const koerper = await verschluessele(JSON.stringify({ ...nachricht, url }), abo.p256dh, abo.auth);
    const antwort = await fetch(abo.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidKopf(abo.endpoint, await vapidSchluessel(env)),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: nachricht.kategorie === 'tagesbericht' ? '43200' : '86400',
        Urgency: nachricht.kategorie === 'kritisch' ? 'high' : 'normal',
      },
      body: p(koerper),
    });
    if (antwort.status === 404 || antwort.status === 410) return { ok: false, veraltet: true, grund: 'abgemeldet' };
    if (!antwort.ok) return { ok: false, grund: `status_${antwort.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, grund: String((e as Error).message ?? e).slice(0, 120) };
  }
}
