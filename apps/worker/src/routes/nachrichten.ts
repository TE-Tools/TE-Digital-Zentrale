import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { body, pruefeTeilnehmer } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import { gfPflicht, sitzungPflicht } from '../lib/sitzung';
import { jetzt } from '../lib/zeit';
import { meldenAusRoute } from './benachrichtigungen';

const nachrichten = new Hono<AppEnv>();

export const NACHRICHTEN_ARTEN = [
  'aufgabenuebergabe',
  'rueckfrage',
  'ergebnisbericht',
  'technische_empfehlung',
  'warnung',
  'entscheidungsvorschlag',
  'pruefbericht',
  'eskalation',
  'information',
  'notiz',
] as const;

nachrichten.get('/', async (c) => {
  sitzungPflicht(c);
  const q = c.req.query();
  const bed: string[] = [];
  const werte: string[] = [];
  if (q.aufgabe) { bed.push('n.aufgabe_id = ?'); werte.push(q.aufgabe); }
  if (q.projekt) { bed.push('n.projekt_slug = ?'); werte.push(q.projekt); }
  if (q.teilnehmer) { bed.push('(n.von = ? OR n.an = ?)'); werte.push(q.teilnehmer, q.teilnehmer); }
  if (q.art && (NACHRICHTEN_ARTEN as readonly string[]).includes(q.art)) { bed.push('n.art = ?'); werte.push(q.art); }
  if (q.ungelesen === '1') bed.push(`n.an = 'gf' AND n.gelesen_am IS NULL`);
  const r = await c.env.DB.prepare(
    `SELECT n.*, a.titel AS aufgabe_titel, p.name AS projekt_name, p.farbe AS projekt_farbe
       FROM nachrichten n
       LEFT JOIN aufgaben a ON a.id = n.aufgabe_id
       LEFT JOIN projekte p ON p.slug = n.projekt_slug
      ${bed.length ? 'WHERE ' + bed.join(' AND ') : ''}
      ORDER BY n.zeit DESC, n.id DESC LIMIT 150`,
  )
    .bind(...werte)
    .all();
  return c.json({ nachrichten: r.results });
});

const Neu = z.object({
  art: z.enum(NACHRICHTEN_ARTEN),
  von: z.string().min(2).max(40).default('gf'),
  an: z.string().min(2).max(40).nullable().default(null),
  projekt_slug: z.string().max(40).nullable().default(null),
  aufgabe_id: z.string().regex(/^TD-\d{4,}$/).nullable().default(null),
  inhalt: z.string().trim().min(1).max(50_000),
});

nachrichten.post('/', async (c) => {
  const s = gfPflicht(c);
  const d = await body(c, Neu);
  const db = c.env.DB;
  await pruefeTeilnehmer(db, d.von, d.an);
  let projekt = d.projekt_slug;
  if (d.aufgabe_id) {
    const a = await db.prepare('SELECT projekt_slug FROM aufgaben WHERE id = ?').bind(d.aufgabe_id).first<{ projekt_slug: string }>();
    if (!a) throw new ApiFehler(400, 'aufgabe_unbekannt', 'Die Aufgabe existiert nicht.');
    projekt = a.projekt_slug;
  } else if (projekt) {
    const p = await db.prepare('SELECT 1 FROM projekte WHERE slug = ?').bind(projekt).first();
    if (!p) throw new ApiFehler(400, 'projekt_unbekannt', 'Das Projekt existiert nicht.');
  }
  // Nachrichten der GF gelten als gelesen
  const gelesen = d.an === 'gf' && d.von === 'gf' ? jetzt() : null;
  const res = await db.batch([
    db
      .prepare(`INSERT INTO nachrichten (art, von, an, projekt_slug, aufgabe_id, inhalt, gelesen_am) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind(d.art, d.von, d.an, projekt, d.aufgabe_id, d.inhalt, gelesen),
    ...(d.aufgabe_id ? [db.prepare('UPDATE aufgaben SET aktualisiert_am = ? WHERE id = ?').bind(jetzt(), d.aufgabe_id)] : []),
    auditStatement(db, s, {
      aktion: 'nachricht.erfasst',
      objektTyp: 'nachricht',
      objektId: d.aufgabe_id ?? undefined,
      projektSlug: projekt,
      details: { art: d.art, von: d.von, an: d.an },
    }),
  ]);
  const id = (res[0]?.results[0] as { id: number } | undefined)?.id;
  if (d.von !== 'gf' && (d.an === 'gf' || d.an === null) && ['eskalation', 'warnung', 'rueckfrage'].includes(d.art)) {
    await meldenAusRoute(c, {
      kategorie: d.art === 'eskalation' ? 'kritisch' : 'wichtig',
      titel: `${d.art === 'eskalation' ? 'Eskalation' : d.art === 'warnung' ? 'Warnung' : 'Rückfrage'}${d.aufgabe_id ? ` zu ${d.aufgabe_id}` : ''}`,
      text: d.inhalt.slice(0, 200),
      url: d.aufgabe_id ? `/aufgaben/${d.aufgabe_id}` : '/kommunikation',
    });
  }
  return c.json({ ok: true, id }, 201);
});

nachrichten.post('/gelesen', async (c) => {
  gfPflicht(c);
  const { ids } = await body(c, z.object({ ids: z.array(z.number().int()).max(500).optional() }));
  const db = c.env.DB;
  if (ids && ids.length) {
    await db
      .prepare(`UPDATE nachrichten SET gelesen_am = ? WHERE an = 'gf' AND gelesen_am IS NULL AND id IN (${ids.map(() => '?').join(',')})`)
      .bind(jetzt(), ...ids)
      .run();
  } else {
    await db.prepare(`UPDATE nachrichten SET gelesen_am = ? WHERE an = 'gf' AND gelesen_am IS NULL`).bind(jetzt()).run();
  }
  return c.json({ ok: true });
});

export default nachrichten;
