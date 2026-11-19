import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiFehler } from '../lib/fehler';
import { eingerichtet, GRENZEN, messen, SPARMODUS_AB } from '../lib/kosten';
import { gfPflicht, sitzungPflicht } from '../lib/sitzung';

const kosten = new Hono<AppEnv>();

kosten.get('/', async (c) => {
  sitzungPflicht(c);
  const db = c.env.DB;
  const heute = new Date().toISOString().slice(0, 10);
  const [werte, verlauf, schluessel] = await db.batch([
    db.prepare('SELECT dienst, metrik, wert, grenze, erfasst_am FROM kosten_messwerte WHERE datum = (SELECT MAX(datum) FROM kosten_messwerte)'),
    db.prepare(`SELECT datum, dienst, metrik, wert, grenze FROM kosten_messwerte WHERE datum >= date('now', '-13 days') ORDER BY datum`),
    db.prepare(`SELECT name, wert FROM system_schluessel WHERE name IN ('kosten_fehler', 'sparmodus')`),
  ]);
  const s = Object.fromEntries(((schluessel?.results ?? []) as { name: string; wert: string }[]).map((x) => [x.name, x.wert]));
  return c.json({
    eingerichtet: eingerichtet(c.env),
    tarif: 'Workers Free',
    heute,
    grenzen: GRENZEN,
    sparmodus_ab: SPARMODUS_AB,
    sparmodus: s.sparmodus === heute,
    fehler: s.kosten_fehler || null,
    aktuell: werte?.results ?? [],
    verlauf: verlauf?.results ?? [],
  });
});

kosten.post('/messen', async (c) => {
  gfPflicht(c);
  try {
    return c.json({ ok: true, messungen: await messen(c.env) });
  } catch (e) {
    throw new ApiFehler(502, 'messung_fehlgeschlagen', (e as Error).message);
  }
});

export default kosten;
