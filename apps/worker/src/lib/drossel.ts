/**
 * Drosselung (Rate Limiting) gegen Durchprobieren von Codes/Passkeys, Token-Missbrauch und Überlast.
 * Nutzt das Rate-Limiting-Binding von Cloudflare (lokal von Miniflare nachgebildet).
 * Fehlt das Binding, wird nicht gedrosselt – das ist nur in Umgebungen ohne Konfiguration der Fall.
 */
import type { Env } from '../env';
import { ApiFehler } from './fehler';

export type Drossel = 'RL_ANMELDUNG' | 'RL_MCP' | 'RL_SCHREIBEN';

export function anschluss(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? 'unbekannt';
}

export async function gedrosselt(env: Env, art: Drossel, schluessel: string): Promise<boolean> {
  const binding = env[art];
  if (!binding) return false;
  const { success } = await binding.limit({ key: `${art}:${schluessel}` });
  return !success;
}

export async function drosseln(env: Env, art: Drossel, schluessel: string): Promise<void> {
  if (await gedrosselt(env, art, schluessel)) {
    throw new ApiFehler(429, 'zu_viele_anfragen', 'Zu viele Anfragen. Bitte kurz warten und erneut versuchen.');
  }
}
