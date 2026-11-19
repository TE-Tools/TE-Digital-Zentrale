import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { berichtErzeugen, tagesberichtSpeichern } from '../lib/berichte';
import { body } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import { gfPflicht, sitzungPflicht } from '../lib/sitzung';
import { berlin } from '../lib/zeit';

const berichte = new Hono<AppEnv>();

berichte.get('/', async (c) => {
  sitzungPflicht(c);
  const typ = c.req.query('typ');
  const projekt = c.req.query('projekt');
  const bed: string[] = [];
  const werte: string[] = [];
  if (typ === 'tag' || typ === 'projekt') {
    bed.push('b.typ = ?');
    werte.push(typ);
  }
  if (projekt) {
    bed.push('b.projekt_slug = ?');
    werte.push(projekt);
  }
  const r = await c.env.DB.prepare(
    `SELECT b.id, b.typ, b.datum, b.projekt_slug, b.von, b.bis, b.titel, b.kennzahlen, b.erstellt_am, p.name AS projekt_name, p.farbe AS projekt_farbe
       FROM berichte b LEFT JOIN projekte p ON p.slug = b.projekt_slug
      ${bed.length ? 'WHERE ' + bed.join(' AND ') : ''} ORDER BY b.erstellt_am DESC LIMIT 60`,
  )
    .bind(...werte)
    .all<{ kennzahlen: string }>();
  return c.json({ berichte: r.results.map((b) => ({ ...b, kennzahlen: JSON.parse(b.kennzahlen) })) });
});

// ------------------------------------------------------------------ Aktivitätsprotokoll (vor /:id registrieren)

berichte.get('/protokoll', async (c) => {
  sitzungPflicht(c);
  const q = c.req.query();
  const bed: string[] = [];
  const werte: (string | number)[] = [];
  if (q.projekt) { bed.push('a.projekt_slug = ?'); werte.push(q.projekt); }
  if (q.akteur_typ && ['benutzer', 'mitarbeiter', 'system'].includes(q.akteur_typ)) { bed.push('a.akteur_typ = ?'); werte.push(q.akteur_typ); }
  if (q.bereich && /^[a-z_]{2,30}$/.test(q.bereich)) { bed.push('a.aktion LIKE ?'); werte.push(`${q.bereich}.%`); }
  if (q.vor && /^\d+$/.test(q.vor)) { bed.push('a.id < ?'); werte.push(Number(q.vor)); }
  const r = await c.env.DB.prepare(
    `SELECT a.id, a.zeit, a.akteur_typ, a.akteur_id, a.akteur_name, a.aktion, a.objekt_typ, a.objekt_id, a.projekt_slug, a.details
       FROM aktivitaeten a ${bed.length ? 'WHERE ' + bed.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 101`,
  )
    .bind(...werte)
    .all<{ id: number }>();
  const mehr = r.results.length > 100;
  return c.json({ eintraege: r.results.slice(0, 100), weiter: mehr ? r.results[99]!.id : null });
});

berichte.get('/:id', async (c) => {
  sitzungPflicht(c);
  const b = await c.env.DB.prepare(
    `SELECT b.*, p.name AS projekt_name, p.farbe AS projekt_farbe FROM berichte b LEFT JOIN projekte p ON p.slug = b.projekt_slug WHERE b.id = ?`,
  )
    .bind(Number(c.req.param('id')))
    .first<{ kennzahlen: string }>();
  if (!b) throw new ApiFehler(404, 'nicht_gefunden', 'Bericht nicht gefunden.');
  return c.json({ bericht: { ...b, kennzahlen: JSON.parse(b.kennzahlen) } });
});

berichte.post('/tag', async (c) => {
  const s = gfPflicht(c);
  const id = await tagesberichtSpeichern(c.env, new Date(), true, s.benutzer.name);
  await auditStatement(c.env.DB, s, { aktion: 'bericht.tag', objektTyp: 'bericht', objektId: String(id) }).run();
  return c.json({ ok: true, id }, 201);
});

berichte.post('/projekt', async (c) => {
  const s = gfPflicht(c);
  const d = await body(c, z.object({ projekt_slug: z.string().min(2).max(40), tage: z.number().int().min(1).max(365).default(7) }));
  const p = await c.env.DB.prepare('SELECT slug FROM projekte WHERE slug = ?').bind(d.projekt_slug).first();
  if (!p) throw new ApiFehler(400, 'projekt_unbekannt', 'Das Projekt existiert nicht.');
  const bis = new Date();
  const von = new Date(bis.getTime() - d.tage * 86_400_000);
  const b = await berichtErzeugen(c.env, von, bis, d.projekt_slug);
  const r = await c.env.DB.prepare(
    `INSERT INTO berichte (typ, datum, projekt_slug, von, bis, titel, inhalt, kennzahlen, erstellt_von) VALUES ('projekt', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(berlin(bis).datum, d.projekt_slug, b.von, b.bis, b.titel, b.inhalt, JSON.stringify(b.kennzahlen), s.benutzer.name)
    .first<{ id: number }>();
  await auditStatement(c.env.DB, s, { aktion: 'bericht.projekt', objektTyp: 'bericht', objektId: String(r!.id), projektSlug: d.projekt_slug }).run();
  return c.json({ ok: true, id: r!.id }, 201);
});

export default berichte;
