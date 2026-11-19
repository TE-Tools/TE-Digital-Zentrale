import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { body } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import { gfPflicht, sitzungPflicht } from '../lib/sitzung';
import { inMinuten, jetzt } from '../lib/zeit';

const mitarbeiter = new Hono<AppEnv>();

/**
 * Effektiver Status: Ist das Limit abgelaufen, gilt der Mitarbeiter wieder als verfügbar.
 * Der gespeicherte Status bleibt unverändert, bis jemand die Aufgabe fortsetzt.
 */
export const EFFEKTIVER_STATUS = `CASE WHEN m.status = 'wartend_limit' AND m.limit_bis IS NOT NULL AND m.limit_bis <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
  THEN 'verfuegbar' ELSE m.status END`;

mitarbeiter.get('/', async (c) => {
  sitzungPflicht(c);
  const r = await c.env.DB.prepare(
    `SELECT m.id, m.name, m.rolle, m.anbieter, m.zugang, m.arbeitsweg, ${EFFEKTIVER_STATUS} AS status, m.status_bestaetigt_am,
            m.limit_bis, m.farbe, m.aktiv,
            (SELECT COUNT(*) FROM aufgaben a WHERE a.zustaendig_id = m.id AND a.status NOT IN ('abgeschlossen','abgebrochen')) AS offene_aufgaben,
            (SELECT COUNT(*) FROM aufgaben a WHERE a.zustaendig_id = m.id AND a.status = 'abgeschlossen') AS erledigte_aufgaben,
            (SELECT a.id || ' · ' || a.titel FROM aufgaben a
               WHERE a.zustaendig_id = m.id AND a.status IN ('in_bearbeitung','zugewiesen','pruefung')
               ORDER BY a.aktualisiert_am DESC LIMIT 1) AS aktuelle_aufgabe
       FROM mitarbeiter m ORDER BY m.sortierung`,
  ).all();
  return c.json({ mitarbeiter: r.results });
});

const StatusSchema = z.object({
  status: z.enum(['verfuegbar', 'arbeitet', 'wartend_limit', 'pausiert']),
  limit_bis: z.string().datetime({ offset: true }).optional(),
});

/** Manuelle Statusmeldung (z. B. „Limit erreicht“ ohne konkrete Aufgabe). */
mitarbeiter.post('/:id/status', async (c) => {
  const s = gfPflicht(c);
  const id = c.req.param('id');
  const d = await body(c, StatusSchema);
  const db = c.env.DB;
  const m = await db.prepare('SELECT id FROM mitarbeiter WHERE id = ?').bind(id).first();
  if (!m) throw new ApiFehler(404, 'nicht_gefunden', 'Mitarbeiter nicht gefunden.');
  const bis = d.status === 'wartend_limit' ? (d.limit_bis ? new Date(d.limit_bis).toISOString() : inMinuten(180)) : null;
  await db.batch([
    db.prepare('UPDATE mitarbeiter SET status = ?, limit_bis = ?, status_bestaetigt_am = ? WHERE id = ?').bind(d.status, bis, jetzt(), id),
    auditStatement(db, s, { aktion: 'mitarbeiter.status', objektTyp: 'mitarbeiter', objektId: id, details: { status: d.status, bis } }),
  ]);
  return c.json({ ok: true, limit_bis: bis });
});

export default mitarbeiter;
