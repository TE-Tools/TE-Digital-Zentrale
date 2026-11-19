import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { sitzungPflicht } from '../lib/sitzung';

const mitarbeiter = new Hono<AppEnv>();

mitarbeiter.get('/', async (c) => {
  sitzungPflicht(c);
  const r = await c.env.DB.prepare(
    `SELECT id, name, rolle, anbieter, zugang, arbeitsweg, status, status_bestaetigt_am, limit_bis, farbe, aktiv
       FROM mitarbeiter ORDER BY sortierung`,
  ).all();
  return c.json({ mitarbeiter: r.results });
});

export default mitarbeiter;
