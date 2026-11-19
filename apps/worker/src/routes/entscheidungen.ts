import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { body, naechsteId, pruefeTeilnehmer } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import { gfPflicht, sitzungPflicht } from '../lib/sitzung';

const entscheidungen = new Hono<AppEnv>();

entscheidungen.get('/', async (c) => {
  sitzungPflicht(c);
  const q = c.req.query();
  const bed: string[] = [];
  const werte: (string | number)[] = [];
  if (q.projekt) { bed.push('e.projekt_slug = ?'); werte.push(q.projekt); }
  if (q.aufgabe) { bed.push('e.aufgabe_id = ?'); werte.push(q.aufgabe); }
  if (q.stufe && ['1', '2', '3'].includes(q.stufe)) { bed.push('e.stufe = ?'); werte.push(Number(q.stufe)); }
  const r = await c.env.DB.prepare(
    `SELECT e.*, p.name AS projekt_name, p.farbe AS projekt_farbe, a.titel AS aufgabe_titel
       FROM entscheidungen e LEFT JOIN projekte p ON p.slug = e.projekt_slug LEFT JOIN aufgaben a ON a.id = e.aufgabe_id
      ${bed.length ? 'WHERE ' + bed.join(' AND ') : ''}
      ORDER BY e.zeit DESC LIMIT 200`,
  )
    .bind(...werte)
    .all();
  return c.json({ entscheidungen: r.results });
});

const Neu = z.object({
  stufe: z.union([z.literal(1), z.literal(2)]),
  titel: z.string().trim().min(3).max(200),
  begruendung: z.string().trim().max(8000).default(''),
  alternativen: z.string().trim().max(4000).default(''),
  von: z.string().min(2).max(40).default('gf'),
  projekt_slug: z.string().max(40).nullable().default(null),
  aufgabe_id: z.string().regex(/^TD-\d{4,}$/).nullable().default(null),
});

/**
 * Dokumentiert Entscheidungen der Stufen 1 und 2. Stufe 3 entsteht ausschließlich über eine
 * Freigabe (siehe freigaben.ts). Stufe 2 löst die Informationspflicht aus: Nachricht an Projektleitung und GF.
 */
entscheidungen.post('/', async (c) => {
  const s = gfPflicht(c);
  const d = await body(c, Neu.or(z.object({ stufe: z.literal(3) }).passthrough()));
  if (d.stufe === 3) {
    throw new ApiFehler(400, 'stufe3_ueber_freigabe', 'Stufe-3-Entscheidungen entstehen nur über eine Freigabe.');
  }
  const db = c.env.DB;
  await pruefeTeilnehmer(db, d.von);
  let projekt = d.projekt_slug;
  if (d.aufgabe_id) {
    const a = await db.prepare('SELECT projekt_slug FROM aufgaben WHERE id = ?').bind(d.aufgabe_id).first<{ projekt_slug: string }>();
    if (!a) throw new ApiFehler(400, 'aufgabe_unbekannt', 'Die Aufgabe existiert nicht.');
    projekt = a.projekt_slug;
  }
  const id = await naechsteId(db, 'entscheidung');
  const info =
    d.stufe === 2
      ? [
          db
            .prepare(`INSERT INTO nachrichten (art, von, an, projekt_slug, aufgabe_id, inhalt) VALUES ('information', ?, 'gf', ?, ?, ?)`)
            .bind(d.von, projekt, d.aufgabe_id, `Entscheidung ${id} (Stufe 2): ${d.titel}${d.begruendung ? `\n\n${d.begruendung}` : ''}`),
          ...(d.von !== 'projektleitung'
            ? [
                db
                  .prepare(`INSERT INTO nachrichten (art, von, an, projekt_slug, aufgabe_id, inhalt) VALUES ('information', ?, 'projektleitung', ?, ?, ?)`)
                  .bind(d.von, projekt, d.aufgabe_id, `Entscheidung ${id} (Stufe 2): ${d.titel}`),
              ]
            : []),
        ]
      : [];
  await db.batch([
    db
      .prepare(`INSERT INTO entscheidungen (id, stufe, titel, begruendung, alternativen, projekt_slug, aufgabe_id, von) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, d.stufe, d.titel, d.begruendung, d.alternativen, projekt, d.aufgabe_id, d.von),
    ...info,
    auditStatement(db, s, { aktion: 'entscheidung.dokumentiert', objektTyp: 'entscheidung', objektId: id, projektSlug: projekt, details: { stufe: d.stufe } }),
  ]);
  return c.json({ ok: true, id }, 201);
});

export default entscheidungen;
