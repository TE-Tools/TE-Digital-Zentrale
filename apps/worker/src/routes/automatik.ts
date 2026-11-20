/**
 * Automatik je Aufgabe: Status der Läufe (Live-Anzeige), Starten, Abbrechen.
 * Starten ist normale Arbeit (Stufe 1) – die KI-Mitarbeiter selbst bleiben an ihre Regeln gebunden.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { aenderungMelden, laufAnlegen, laufSetzen, type LaufZeile } from '../lib/automatik';
import { body } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import { gfPflicht, sitzungPflicht } from '../lib/sitzung';
import { automatikAnstossen } from '../live';

const automatik = new Hono<AppEnv>();

async function nebenbei(c: Context<AppEnv>, p: Promise<unknown>): Promise<void> {
  try {
    c.executionCtx.waitUntil(p);
  } catch {
    await p; // ohne ExecutionContext (interne Aufrufe)
  }
}

automatik.get('/aufgaben/:id', async (c) => {
  sitzungPflicht(c);
  const id = c.req.param('id');
  const db = c.env.DB;
  const [a, l] = await db.batch([
    db.prepare(
      `SELECT a.id, a.zustaendig_id, m.name AS mitarbeiter, m.automatik
         FROM aufgaben a LEFT JOIN mitarbeiter m ON m.id = a.zustaendig_id WHERE a.id = ?`,
    ).bind(id),
    db.prepare('SELECT * FROM ki_laeufe WHERE aufgabe_id = ? ORDER BY id DESC LIMIT 10').bind(id),
  ]);
  const z0 = a?.results[0] as { mitarbeiter: string | null; automatik: string | null } | undefined;
  if (!z0) throw new ApiFehler(404, 'nicht_gefunden', 'Aufgabe nicht gefunden.');
  return c.json({ mitarbeiter: z0.mitarbeiter, automatik: z0.automatik, laeufe: (l?.results ?? []) as unknown as LaufZeile[], jetzt: new Date().toISOString() });
});

automatik.post('/aufgaben/:id/starten', async (c) => {
  const s = gfPflicht(c);
  const id = c.req.param('id');
  const d = await body(c, z.object({ modus: z.enum(['voll', 'fortsetzung']).default('voll') }));
  const db = c.env.DB;
  const laufId = await laufAnlegen(db, id, d.modus);
  const p = await db.prepare('SELECT projekt_slug FROM aufgaben WHERE id = ?').bind(id).first<{ projekt_slug: string }>();
  await auditStatement(db, s, {
    aktion: 'automatik.gestartet',
    objektTyp: 'aufgabe',
    objektId: id,
    projektSlug: p?.projekt_slug ?? null,
    details: { lauf: laufId, modus: d.modus },
  }).run();
  await nebenbei(c, automatikAnstossen(c.env));
  return c.json({ ok: true, lauf: laufId }, 201);
});

automatik.post('/laeufe/:id/abbrechen', async (c) => {
  const s = gfPflicht(c);
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const l = await db.prepare('SELECT * FROM ki_laeufe WHERE id = ?').bind(id).first<LaufZeile>();
  if (!l) throw new ApiFehler(404, 'nicht_gefunden', 'Lauf nicht gefunden.');
  if (!['wartet', 'laeuft'].includes(l.status)) throw new ApiFehler(409, 'beendet', 'Der Lauf ist bereits beendet.');
  await laufSetzen(db, id, 'abgebrochen', {
    meldung: l.art === 'github_claude' ? 'Abgebrochen – einen laufenden GitHub-Lauf bitte zusätzlich auf GitHub stoppen.' : 'Abgebrochen.',
  });
  await auditStatement(db, s, { aktion: 'automatik.abgebrochen', objektTyp: 'aufgabe', objektId: l.aufgabe_id, details: { lauf: id } }).run();
  await nebenbei(c, aenderungMelden(c.env, l.aufgabe_id));
  return c.json({ ok: true });
});

export default automatik;
