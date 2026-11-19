import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Benutzer, SitzungsInfo } from '../env';
import { ApiFehler } from './fehler';
import { base64url, sha256Hex, zufallsBytes } from './krypto';
import { inTagen, jetzt } from './zeit';

export const SITZUNG_TAGE = 30;
/** Stufe-3-Aktionen verlangen eine Passkey-Bestätigung, die höchstens so alt ist. */
export const STEP_UP_MINUTEN = 5;

function istHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

/** Unter HTTPS mit __Host-Präfix (Secure, Path=/, keine Domain). Lokal über http://localhost ohne. */
export function cookieName(c: Context): string {
  return istHttps(c) ? '__Host-te_sitzung' : 'te_sitzung';
}

export async function sitzungErstellen(
  c: Context<AppEnv>,
  benutzerId: string,
  mitPasskey: boolean,
): Promise<D1PreparedStatement> {
  const token = base64url(zufallsBytes(32));
  const tokenHash = await sha256Hex(token);
  setCookie(c, cookieName(c), token, {
    httpOnly: true,
    secure: istHttps(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: SITZUNG_TAGE * 86_400,
  });
  const geraet = (c.req.header('user-agent') ?? '').slice(0, 160);
  return c.env.DB.prepare(
    `INSERT INTO sitzungen (token_hash, benutzer_id, ablauf_am, bestaetigt_am, geraet) VALUES (?, ?, ?, ?, ?)`,
  ).bind(tokenHash, benutzerId, inTagen(SITZUNG_TAGE), mitPasskey ? jetzt() : null, geraet);
}

export async function sitzungBeenden(c: Context<AppEnv>): Promise<void> {
  const s = c.get('sitzung');
  if (s) await c.env.DB.prepare('DELETE FROM sitzungen WHERE token_hash = ?').bind(s.tokenHash).run();
  deleteCookie(c, cookieName(c), { path: '/', secure: istHttps(c) });
}

/** Lädt die Sitzung (falls vorhanden) in c.var.sitzung. Blockiert nicht. */
export const sitzungLaden: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('sitzung', null);
  const token = getCookie(c, cookieName(c));
  if (token && token.length >= 32 && token.length <= 64) {
    const tokenHash = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT s.token_hash, s.bestaetigt_am, s.ablauf_am, b.id, b.name, b.rolle
         FROM sitzungen s JOIN benutzer b ON b.id = s.benutzer_id
        WHERE s.token_hash = ? AND s.ablauf_am > ?`,
    )
      .bind(tokenHash, jetzt())
      .first<{ token_hash: string; bestaetigt_am: string | null; id: string; name: string; rolle: Benutzer['rolle'] }>();
    if (row) {
      c.set('sitzung', {
        tokenHash: row.token_hash,
        bestaetigtAm: row.bestaetigt_am,
        benutzer: { id: row.id, name: row.name, rolle: row.rolle },
      });
    }
  }
  await next();
};

export function sitzungPflicht(c: Context<AppEnv>): SitzungsInfo {
  const s = c.get('sitzung');
  if (!s) throw new ApiFehler(401, 'nicht_angemeldet', 'Bitte zuerst anmelden.');
  return s;
}

export function gfPflicht(c: Context<AppEnv>): SitzungsInfo {
  const s = sitzungPflicht(c);
  if (s.benutzer.rolle !== 'gf') throw new ApiFehler(403, 'keine_berechtigung', 'Nur die Geschäftsführung darf das.');
  return s;
}

/** Für Stufe-3-Aktionen: verlangt eine frische Passkey-Bestätigung. */
export function stepUpPflicht(c: Context<AppEnv>): SitzungsInfo {
  const s = gfPflicht(c);
  const grenze = Date.now() - STEP_UP_MINUTEN * 60_000;
  if (!s.bestaetigtAm || Date.parse(s.bestaetigtAm) < grenze) {
    throw new ApiFehler(403, 'bestaetigung_noetig', 'Bitte mit Passkey bestätigen.');
  }
  return s;
}
