import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiFehler, validierungsFehler } from './fehler';

/** Liest den JSON-Body und prüft ihn gegen ein Schema. */
export async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let daten: unknown;
  try {
    daten = await c.req.json();
  } catch {
    throw new ApiFehler(400, 'json_ungueltig', 'Ungültiges JSON.');
  }
  const r = schema.safeParse(daten);
  if (!r.success) throw validierungsFehler(r.error);
  return r.data;
}

/** Vergibt die nächste laufende Nummer, z. B. TD-0007, FG-0003, EN-0012. */
export async function naechsteId(db: D1Database, zaehler: 'aufgabe' | 'freigabe' | 'entscheidung'): Promise<string> {
  const r = await db
    .prepare('UPDATE zaehler SET wert = wert + 1 WHERE name = ? RETURNING wert')
    .bind(zaehler)
    .first<{ wert: number }>();
  if (!r) throw new Error(`Zähler ${zaehler} fehlt`);
  const praefix = { aufgabe: 'TD', freigabe: 'FG', entscheidung: 'EN' }[zaehler];
  return `${praefix}-${String(r.wert).padStart(4, '0')}`;
}

/** Erlaubte Absender/Empfänger: 'gf' oder eine Mitarbeiter-ID. */
export async function pruefeTeilnehmer(db: D1Database, ...ids: (string | null | undefined)[]): Promise<void> {
  const zuPruefen = [...new Set(ids.filter((i): i is string => !!i && i !== 'gf'))];
  if (zuPruefen.length === 0) return;
  const r = await db
    .prepare(`SELECT id FROM mitarbeiter WHERE id IN (${zuPruefen.map(() => '?').join(',')})`)
    .bind(...zuPruefen)
    .all<{ id: string }>();
  const da = new Set(r.results.map((x) => x.id));
  const fehlt = zuPruefen.filter((i) => !da.has(i));
  if (fehlt.length) throw new ApiFehler(400, 'unbekannter_teilnehmer', `Unbekannter Mitarbeiter: ${fehlt.join(', ')}`);
}
