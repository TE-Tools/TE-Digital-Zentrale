/**
 * GitHub-App-Anbindung (Kap. 8.4) – von der Geschäftsführung selbst in der PWA eingerichtet.
 * - Manifest-Ablauf: App wird mit minimalen Rechten auf github.com angelegt, Schlüssel kommen zurück
 * - Schlüssel (privater App-Schlüssel, Webhook-Geheimnis) liegen AES-GCM-verschlüsselt in D1;
 *   der Schlüssel dafür existiert nur als Worker-Secret ZENTRALE_SCHLUESSEL
 * - Zugriff: App-JWT (RS256) → Installations-Token (1 Std.), nur Lesen + Issues/Kommentare + Workflows starten
 * Free-Tarif: max. 50 Unteranfragen je Aufruf → Abgleich ist hart begrenzt.
 */
import type { Env } from '../env';
import { base64url, vonBase64url } from './krypto';
import { aufgabeAusBranch } from './pfade';
import { jetzt } from './zeit';

type Puffer = Uint8Array<ArrayBuffer>;
const p = (u: Uint8Array) => u as Puffer;
const UA = 'TE-Digital-Zentrale';
const API = 'https://api.github.com';

export const APP_RECHTE = {
  metadata: 'read',
  pull_requests: 'read',
  checks: 'read',
  issues: 'write',
  // Automatik: Workflow „ki-auftrag.yml“ starten (Claude Code mit dem Claude-Abo)
  actions: 'write',
} as const;
export const APP_EREIGNISSE = ['pull_request', 'check_suite', 'push'] as const;

// ------------------------------------------------------------------ Verschlüsselung gespeicherter Geheimnisse

async function aesSchluessel(env: Env): Promise<CryptoKey> {
  if (!env.ZENTRALE_SCHLUESSEL) throw new Error('ZENTRALE_SCHLUESSEL fehlt (Worker-Secret).');
  const roh = vonBase64url(env.ZENTRALE_SCHLUESSEL);
  if (roh.length !== 32) throw new Error('ZENTRALE_SCHLUESSEL muss 32 Byte (base64url) lang sein.');
  return crypto.subtle.importKey('raw', p(roh), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function verschluesseln(env: Env, klartext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesSchluessel(env), new TextEncoder().encode(klartext)));
  return `v1.${base64url(iv)}.${base64url(ct)}`;
}

export async function entschluesseln(env: Env, wert: string): Promise<string> {
  const [v, iv, ct] = wert.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Unbekanntes Format');
  const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: p(vonBase64url(iv)) }, await aesSchluessel(env), p(vonBase64url(ct)));
  return new TextDecoder().decode(klar);
}

// ------------------------------------------------------------------ PEM (PKCS#1 → PKCS#8) und App-JWT

function derLaenge(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, inhalt: Uint8Array): Uint8Array {
  const l = derLaenge(inhalt.length);
  const out = new Uint8Array(1 + l.length + inhalt.length);
  out[0] = tag;
  out.set(l, 1);
  out.set(inhalt, 1 + l.length);
  return out;
}

/** GitHub liefert „BEGIN RSA PRIVATE KEY“ (PKCS#1); WebCrypto braucht PKCS#8. */
export function pemZuPkcs8(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  if (pem.includes('BEGIN PRIVATE KEY')) return bin; // bereits PKCS#8
  const algorithmus = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const okt = der(0x04, bin);
  const inhalt = new Uint8Array(version.length + algorithmus.length + okt.length);
  inhalt.set(version, 0);
  inhalt.set(algorithmus, version.length);
  inhalt.set(okt, version.length + algorithmus.length);
  return der(0x30, inhalt);
}

export async function appJwt(appId: number, pem: string, jetztSek = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', p(pemZuPkcs8(pem)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const enc = new TextEncoder();
  const kopf = base64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const inhalt = base64url(enc.encode(JSON.stringify({ iat: jetztSek - 60, exp: jetztSek + 540, iss: appId })));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${kopf}.${inhalt}`)));
  return `${kopf}.${inhalt}.${base64url(sig)}`;
}

// ------------------------------------------------------------------ Webhook-Signatur

export async function webhookPruefen(geheimnis: string, rohKoerper: string, signatur: string | undefined): Promise<boolean> {
  if (!signatur?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(geheimnis), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rohKoerper)));
  const erwartet = 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (erwartet.length !== signatur.length) return false;
  let diff = 0;
  for (let i = 0; i < erwartet.length; i++) diff |= erwartet.charCodeAt(i) ^ signatur.charCodeAt(i);
  return diff === 0;
}

// ------------------------------------------------------------------ Verbindung & Zugriff

export interface Verbindung {
  status: 'getrennt' | 'eingerichtet' | 'installiert';
  organisation: string | null;
  app_id: number | null;
  app_slug: string | null;
  app_url: string | null;
  pem_verschluesselt: string | null;
  webhook_verschluesselt: string | null;
  installation_id: number | null;
  eingerichtet_am: string | null;
  installiert_am: string | null;
  letzter_abgleich: string | null;
  letzter_fehler: string | null;
  state: string | null;
  state_ablauf: string | null;
}

export async function verbindungLaden(env: Env): Promise<Verbindung> {
  return (await env.DB.prepare('SELECT * FROM github_verbindung WHERE id = 1').first<Verbindung>())!;
}

let tokenCache: { installation: number; token: string; ablauf: number } | null = null;

export function tokenCacheLeeren(): void {
  tokenCache = null;
}

export async function githubFetch(url: string, init: RequestInit & { token: string }): Promise<Response> {
  const { token, ...rest } = init;
  return fetch(url.startsWith('http') ? url : API + url, {
    ...rest,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': UA,
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...(rest.headers ?? {}),
    },
  });
}

export async function appToken(env: Env, v: Verbindung): Promise<string> {
  if (!v.app_id || !v.pem_verschluesselt) throw new Error('GitHub-App ist nicht eingerichtet.');
  return appJwt(v.app_id, await entschluesseln(env, v.pem_verschluesselt));
}

export async function installationsToken(env: Env, v: Verbindung): Promise<string> {
  if (!v.installation_id) throw new Error('GitHub-App ist noch nicht installiert.');
  if (tokenCache && tokenCache.installation === v.installation_id && tokenCache.ablauf > Date.now() + 120_000) return tokenCache.token;
  const r = await githubFetch(`/app/installations/${v.installation_id}/access_tokens`, { method: 'POST', token: await appToken(env, v) });
  if (!r.ok) throw new Error(`Installations-Token abgelehnt (${r.status})`);
  const d = (await r.json()) as { token: string; expires_at: string };
  tokenCache = { installation: v.installation_id, token: d.token, ablauf: Date.parse(d.expires_at) };
  return d.token;
}

// ------------------------------------------------------------------ Daten übernehmen

interface GhPr {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft?: boolean;
  merged_at?: string | null;
  merged?: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
  user?: { login: string };
  html_url: string;
  updated_at: string;
}

export function prZustand(pr: GhPr): 'offen' | 'entwurf' | 'gemerged' | 'geschlossen' {
  if (pr.state === 'open') return pr.draft ? 'entwurf' : 'offen';
  return pr.merged || pr.merged_at ? 'gemerged' : 'geschlossen';
}

/** PR speichern; Aufgabe über die Branch-Konvention verknüpfen (nur wenn die Aufgabe existiert). */
export function prStatement(db: D1Database, repo: string, pr: GhPr): D1PreparedStatement {
  const aufgabe = aufgabeAusBranch(pr.head.ref);
  return db
    .prepare(
      `INSERT INTO github_prs (repo, nummer, titel, zustand, branch, ziel_branch, autor, url, head_sha, aufgabe_id, aktualisiert_am)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM aufgaben WHERE id = ?), ?)
       ON CONFLICT(repo, nummer) DO UPDATE SET titel = excluded.titel, zustand = excluded.zustand, branch = excluded.branch,
         ziel_branch = excluded.ziel_branch, url = excluded.url, aufgabe_id = COALESCE(excluded.aufgabe_id, github_prs.aufgabe_id),
         checks = CASE WHEN github_prs.head_sha = excluded.head_sha THEN github_prs.checks ELSE 'unbekannt' END,
         head_sha = excluded.head_sha, aktualisiert_am = excluded.aktualisiert_am`,
    )
    .bind(repo, pr.number, pr.title.slice(0, 300), prZustand(pr), pr.head.ref, pr.base.ref, pr.user?.login ?? null, pr.html_url, pr.head.sha, aufgabe, pr.updated_at);
}

/** Geänderte Dateien eines PR (für die Konflikterkennung). 1 Unteranfrage. */
export async function prDateienLaden(env: Env, token: string, repo: string, nummer: number): Promise<void> {
  const r = await githubFetch(`/repos/${repo}/pulls/${nummer}/files?per_page=100`, { token });
  if (!r.ok) return;
  const dateien = ((await r.json()) as { filename: string }[]).map((f) => f.filename);
  await env.DB.prepare('UPDATE github_prs SET dateien = ? WHERE repo = ? AND nummer = ?').bind(JSON.stringify(dateien), repo, nummer).run();
}

/**
 * Abgleich: Repos der Installation + offene PRs (+ fehlende Dateilisten, solange Budget reicht).
 * Budget: höchstens 45 Unteranfragen (Free-Tarif-Grenze 50).
 */
export async function abgleichen(env: Env): Promise<{ repos: number; prs: number; anfragen: number }> {
  const v = await verbindungLaden(env);
  if (v.status !== 'installiert') throw new Error('GitHub-App ist noch nicht installiert.');
  let anfragen = 1; // Installations-Token
  const token = await installationsToken(env, v);
  const db = env.DB;
  try {
    const r = await githubFetch('/installation/repositories?per_page=100', { token });
    anfragen++;
    if (!r.ok) throw new Error(`Repositories nicht lesbar (${r.status})`);
    const repos = ((await r.json()) as { repositories: { full_name: string; private: boolean; default_branch: string; html_url: string }[] }).repositories;
    const namen = repos.map((x) => x.full_name);
    await db.batch([
      ...repos.map((x) =>
        db
          .prepare(
            `INSERT INTO github_repos (full_name, privat, standard_branch, url, projekt_slug, aktualisiert_am)
             VALUES (?, ?, ?, ?, (SELECT slug FROM projekte WHERE lower(rtrim(repo_url, '/')) = lower(?) LIMIT 1), ?)
             ON CONFLICT(full_name) DO UPDATE SET privat = excluded.privat, standard_branch = excluded.standard_branch, url = excluded.url,
               projekt_slug = COALESCE(github_repos.projekt_slug, excluded.projekt_slug), aktualisiert_am = excluded.aktualisiert_am`,
          )
          .bind(x.full_name, x.private ? 1 : 0, x.default_branch, x.html_url, x.html_url, jetzt()),
      ),
      // Nicht mehr freigegebene Repos entfernen (Freigabe liegt allein bei GitHub)
      namen.length
        ? db.prepare(`DELETE FROM github_repos WHERE full_name NOT IN (${namen.map(() => '?').join(',')})`).bind(...namen)
        : db.prepare('DELETE FROM github_repos'),
    ]);

    let prs = 0;
    for (const repo of namen.slice(0, 30)) {
      if (anfragen >= 40) break;
      const pr = await githubFetch(`/repos/${repo}/pulls?state=open&per_page=50`, { token });
      anfragen++;
      if (!pr.ok) continue;
      const liste = (await pr.json()) as GhPr[];
      prs += liste.length;
      const offen = liste.map((x) => x.number);
      await db.batch([
        ...liste.map((x) => prStatement(db, repo, x)),
        // Lokal noch offene, auf GitHub nicht mehr offene PRs schließen (Merge-Info kommt per Webhook)
        db
          .prepare(
            `UPDATE github_prs SET zustand = 'geschlossen', aktualisiert_am = ? WHERE repo = ? AND zustand IN ('offen','entwurf')
               ${offen.length ? `AND nummer NOT IN (${offen.map(() => '?').join(',')})` : ''}`,
          )
          .bind(jetzt(), repo, ...offen),
      ]);
    }
    const ohneDateien = await db
      .prepare(`SELECT repo, nummer FROM github_prs WHERE zustand IN ('offen','entwurf') AND dateien IS NULL LIMIT 20`)
      .all<{ repo: string; nummer: number }>();
    for (const x of ohneDateien.results) {
      if (anfragen >= 45) break;
      await prDateienLaden(env, token, x.repo, x.nummer);
      anfragen++;
    }
    await db.prepare('UPDATE github_verbindung SET letzter_abgleich = ?, letzter_fehler = NULL WHERE id = 1').bind(jetzt()).run();
    return { repos: namen.length, prs, anfragen };
  } catch (e) {
    await db.prepare('UPDATE github_verbindung SET letzter_fehler = ? WHERE id = 1').bind(String((e as Error).message).slice(0, 300)).run();
    throw e;
  }
}
