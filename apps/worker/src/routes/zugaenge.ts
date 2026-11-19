import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { body } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import { base64url, sha256Hex, zufallsBytes } from '../lib/krypto';
import { gfPflicht, stepUpPflicht } from '../lib/sitzung';
import { jetzt } from '../lib/zeit';

/** KI-Zugänge (Bearer-Token für den MCP-Server). Anlegen = Rechtevergabe → Stufe 3 mit Passkey. */
const zugaenge = new Hono<AppEnv>();

zugaenge.get('/', async (c) => {
  gfPflicht(c);
  const r = await c.env.DB.prepare(
    `SELECT k.id, k.mitarbeiter_id, m.name AS mitarbeiter_name, m.rolle AS mitarbeiter_rolle, k.bezeichnung, k.token_anfang, k.projekte,
            k.erstellt_am, k.zuletzt_am, k.widerrufen_am
       FROM ki_zugaenge k JOIN mitarbeiter m ON m.id = k.mitarbeiter_id ORDER BY k.widerrufen_am IS NOT NULL, k.erstellt_am DESC`,
  ).all<{ projekte: string | null }>();
  return c.json({ zugaenge: r.results.map((z) => ({ ...z, projekte: z.projekte ? JSON.parse(z.projekte) : null })) });
});

const Neu = z.object({
  mitarbeiter_id: z.string().min(2).max(40),
  bezeichnung: z.string().trim().min(2).max(60),
  projekte: z.array(z.string().min(2).max(40)).max(50).nullable().default(null),
});

zugaenge.post('/', async (c) => {
  const s = stepUpPflicht(c);
  const d = await body(c, Neu);
  const db = c.env.DB;
  const m = await db.prepare('SELECT id, anbieter FROM mitarbeiter WHERE id = ? AND aktiv = 1').bind(d.mitarbeiter_id).first<{ id: string; anbieter: string }>();
  if (!m) throw new ApiFehler(400, 'mitarbeiter_unbekannt', 'Mitarbeiter nicht gefunden.');
  if (d.projekte?.length) {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM projekte WHERE slug IN (${d.projekte.map(() => '?').join(',')})`).bind(...d.projekte).first<{ n: number }>();
    if ((r?.n ?? 0) !== new Set(d.projekte).size) throw new ApiFehler(400, 'projekt_unbekannt', 'Ein Projekt existiert nicht.');
  }
  const token = `tez_${base64url(zufallsBytes(32))}`;
  const res = await db.batch([
    db
      .prepare(`INSERT INTO ki_zugaenge (mitarbeiter_id, bezeichnung, token_hash, token_anfang, projekte, erstellt_von) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind(d.mitarbeiter_id, d.bezeichnung, await sha256Hex(token), token.slice(0, 10), d.projekte?.length ? JSON.stringify(d.projekte) : null, s.benutzer.id),
    auditStatement(db, s, {
      aktion: 'zugang.erstellt',
      objektTyp: 'mitarbeiter',
      objektId: d.mitarbeiter_id,
      details: { bezeichnung: d.bezeichnung, projekte: d.projekte ?? 'alle' },
    }),
  ]);
  // Klartext nur dieses eine Mal
  return c.json({ ok: true, id: (res[0]?.results[0] as { id: number }).id, token }, 201);
});

zugaenge.post('/:id/widerrufen', async (c) => {
  const s = gfPflicht(c); // Rechte entziehen geht immer sofort, ohne Passkey-Hürde
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const r = await db.batch([
    db.prepare('UPDATE ki_zugaenge SET widerrufen_am = ? WHERE id = ? AND widerrufen_am IS NULL').bind(jetzt(), id),
    auditStatement(db, s, { aktion: 'zugang.widerrufen', objektTyp: 'zugang', objektId: String(id) }),
  ]);
  if ((r[0]?.meta.changes ?? 0) === 0) throw new ApiFehler(404, 'nicht_gefunden', 'Zugang nicht gefunden oder bereits widerrufen.');
  return c.json({ ok: true });
});

export default zugaenge;
