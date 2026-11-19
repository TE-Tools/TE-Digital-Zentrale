/**
 * Benachrichtigungen (Pflichtenheft 4.5): Posteingang + Web Push nach den Einstellungen des Benutzers.
 *
 * Regeln
 * - kritisch: sofort, auch in der Ruhezeit (abschaltbar)
 * - wichtig: sofort | gebündelt (stündliche Zusammenfassung per Cron) | aus; in der Ruhezeit zurückgestellt
 * - tagesbericht: einmal täglich zur eingestellten Uhrzeit (Cron)
 * - Keine Push-Meldung für eigene Aktionen: Wer etwas selbst in der Zentrale auslöst, bekommt es nur
 *   als gelesenen Eintrag im Posteingang (sonst würde das eigene Handy bei jeder Eingabe am PC piepen).
 */
import type { Env } from '../env';
import { sendePush, type PushNachricht } from './webpush';
import { berlin, inRuhezeit, jetzt } from './zeit';

export type Kategorie = PushNachricht['kategorie'];

export interface Meldung {
  kategorie: Kategorie;
  titel: string;
  text?: string;
  url?: string;
  /** Entdoppelung: dieselbe Meldung wird pro Benutzer nur einmal angelegt */
  schluessel?: string;
}

export interface Einstellungen {
  kritisch: 'sofort' | 'aus';
  wichtig: 'sofort' | 'gebuendelt' | 'aus';
  tagesbericht: number;
  tagesbericht_zeit: string;
  ruhe_von: string | null;
  ruhe_bis: string | null;
  letzter_tagesbericht: string | null;
}

export const STANDARD_EINSTELLUNGEN: Einstellungen = {
  kritisch: 'sofort',
  wichtig: 'sofort',
  tagesbericht: 1,
  tagesbericht_zeit: '07:30',
  ruhe_von: null,
  ruhe_bis: null,
  letzter_tagesbericht: null,
};

export async function einstellungenLaden(db: D1Database, benutzerId: string): Promise<Einstellungen> {
  const e = await db.prepare('SELECT * FROM benachrichtigungs_einstellungen WHERE benutzer_id = ?').bind(benutzerId).first<Einstellungen>();
  return e ?? STANDARD_EINSTELLUNGEN;
}

export function basisUrl(env: Env, anfrageUrl?: string): string {
  const erste = env.ERLAUBTE_ORIGINS.split(',')[0]?.trim();
  return anfrageUrl ? new URL(anfrageUrl).origin : erste || 'http://localhost:8787';
}

type Entscheidung = 'sofort' | 'zurueckstellen' | 'unterdrueckt';

export function entscheide(m: Meldung, e: Einstellungen, eigeneAktion: boolean, d: Date = new Date()): Entscheidung {
  if (eigeneAktion) return 'unterdrueckt';
  if (m.kategorie === 'kritisch') return e.kritisch === 'aus' ? 'unterdrueckt' : 'sofort';
  if (m.kategorie === 'wichtig') {
    if (e.wichtig === 'aus') return 'unterdrueckt';
    if (e.wichtig === 'gebuendelt' || inRuhezeit(berlin(d).hhmm, e.ruhe_von, e.ruhe_bis)) return 'zurueckstellen';
    return 'sofort';
  }
  return e.tagesbericht ? 'sofort' : 'unterdrueckt';
}

/** Schickt eine Nachricht an alle Geräte eines Benutzers; räumt abgemeldete Geräte auf. Liefert Anzahl zugestellt. */
export async function anGeraeteSenden(env: Env, benutzerId: string, n: PushNachricht, basis: string): Promise<number> {
  const abos = await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM push_abos WHERE benutzer_id = ?')
    .bind(benutzerId)
    .all<{ id: number; endpoint: string; p256dh: string; auth: string }>();
  if (abos.results.length === 0) return 0;
  const ergebnisse = await Promise.all(abos.results.map((a) => sendePush(env, a, n, basis)));
  const stmts: D1PreparedStatement[] = [];
  let ok = 0;
  ergebnisse.forEach((e, i) => {
    const id = abos.results[i]!.id;
    if (e.ok) {
      ok++;
      stmts.push(env.DB.prepare('UPDATE push_abos SET zuletzt_ok = ?, fehler_zahl = 0 WHERE id = ?').bind(jetzt(), id));
    } else if (e.veraltet) {
      stmts.push(env.DB.prepare('DELETE FROM push_abos WHERE id = ?').bind(id));
    } else {
      // Nach 10 Fehlversuchen in Folge gilt das Gerät als tot
      stmts.push(env.DB.prepare('UPDATE push_abos SET fehler_zahl = fehler_zahl + 1 WHERE id = ?').bind(id));
      stmts.push(env.DB.prepare('DELETE FROM push_abos WHERE id = ? AND fehler_zahl >= 10').bind(id));
    }
  });
  if (stmts.length) await env.DB.batch(stmts);
  return ok;
}

/**
 * Legt die Meldung für alle Geschäftsführer im Posteingang an und liefert die Arbeit für den
 * Push-Versand als Promise (für waitUntil), damit die API-Antwort nicht wartet.
 */
export async function melden(env: Env, m: Meldung, ausloeserId: string | null, basis: string): Promise<{ versand: Promise<void> }> {
  const empfaenger = await env.DB.prepare(`SELECT id FROM benutzer WHERE rolle = 'gf'`).all<{ id: string }>();
  const versand: (() => Promise<void>)[] = [];
  for (const { id } of empfaenger.results) {
    const e = await einstellungenLaden(env.DB, id);
    const ent = entscheide(m, e, ausloeserId === id);
    const status = ent === 'sofort' ? 'offen' : ent === 'zurueckstellen' ? 'offen' : 'unterdrueckt';
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO benachrichtigungen (benutzer_id, kategorie, titel, text, url, schluessel, push_status, gelesen_am)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(id, m.kategorie, m.titel.slice(0, 160), (m.text ?? '').slice(0, 500), m.url ?? '/', m.schluessel ?? null, status, ausloeserId === id ? jetzt() : null)
      .first<{ id: number }>();
    if (!r || ent !== 'sofort') continue; // bereits gemeldet oder zurückgestellt
    versand.push(async () => {
      const zugestellt = await anGeraeteSenden(env, id, { kategorie: m.kategorie, titel: m.titel, text: m.text ?? '', url: m.url ?? '/', tag: m.schluessel }, basis);
      await env.DB.prepare('UPDATE benachrichtigungen SET push_status = ?, gesendet_am = ? WHERE id = ?')
        .bind(zugestellt > 0 ? 'gesendet' : 'kein_geraet', jetzt(), r.id)
        .run();
    });
  }
  // In ein Objekt verpackt, damit await den Versand nicht sofort abwartet
  return { versand: Promise.all(versand.map((f) => f().catch((err) => console.error('Push-Versand', err)))).then(() => undefined) };
}
