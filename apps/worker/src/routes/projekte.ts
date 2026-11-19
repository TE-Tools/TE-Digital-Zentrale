import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiFehler, validierungsFehler } from '../lib/fehler';
import { gfPflicht, sitzungPflicht } from '../lib/sitzung';
import { jetzt } from '../lib/zeit';

const projekte = new Hono<AppEnv>();

const url = z
  .string()
  .trim()
  .max(300)
  .refine((u) => u === '' || /^https:\/\//.test(u), 'Nur https-Adressen')
  .transform((u) => (u === '' ? null : u));

const Felder = z.object({
  name: z.string().trim().min(2).max(80),
  kurz: z.string().trim().max(120).default(''),
  beschreibung: z.string().trim().max(4000).default(''),
  ziele: z.string().trim().max(4000).default(''),
  repo_url: url.nullable().default(null),
  website_url: url.nullable().default(null),
  hosting: z.string().trim().max(300).default(''),
  stack: z.string().trim().max(300).default(''),
  farbe: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Farbe als #RRGGBB').default('#C8912A'),
  status: z.enum(['aktiv', 'geplant', 'pausiert', 'archiviert']).default('aktiv'),
  sortierung: z.number().int().min(0).max(10_000).default(100),
});

const Neu = Felder.extend({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'Kleinbuchstaben, Ziffern, Bindestrich (2–40)'),
});
const Aenderung = Felder.partial().extend({ version: z.number().int().min(1) });

const SPALTEN = `p.slug, p.name, p.kurz, p.beschreibung, p.ziele, p.repo_url, p.website_url, p.hosting, p.stack,
  p.farbe, p.status, p.sortierung, p.erstellt_am, p.aktualisiert_am, p.version`;

const ZAEHLER = `
  (SELECT COUNT(*) FROM aufgaben a WHERE a.projekt_slug = p.slug AND a.status NOT IN ('abgeschlossen','abgebrochen')) AS offene_aufgaben,
  (SELECT COUNT(*) FROM aufgaben a WHERE a.projekt_slug = p.slug AND a.status = 'blockiert') AS blockiert,
  (SELECT COUNT(*) FROM aufgaben a WHERE a.projekt_slug = p.slug AND a.status = 'abgeschlossen') AS abgeschlossen,
  (SELECT COUNT(*) FROM freigaben f WHERE f.projekt_slug = p.slug AND f.status = 'offen') AS offene_freigaben`;

projekte.get('/', async (c) => {
  sitzungPflicht(c);
  const r = await c.env.DB.prepare(`SELECT ${SPALTEN}, ${ZAEHLER} FROM projekte p ORDER BY p.sortierung, p.name`).all();
  return c.json({ projekte: r.results });
});

projekte.get('/:slug', async (c) => {
  sitzungPflicht(c);
  const slug = c.req.param('slug');
  const db = c.env.DB;
  const [p, akt] = await db.batch([
    db.prepare(`SELECT ${SPALTEN}, ${ZAEHLER} FROM projekte p WHERE p.slug = ?`).bind(slug),
    db
      .prepare(
        `SELECT id, zeit, akteur_typ, akteur_name, aktion, objekt_typ, objekt_id, details
           FROM aktivitaeten WHERE projekt_slug = ? ORDER BY zeit DESC, id DESC LIMIT 20`,
      )
      .bind(slug),
  ]);
  const projekt = p?.results[0];
  if (!projekt) throw new ApiFehler(404, 'nicht_gefunden', 'Projekt nicht gefunden.');
  return c.json({ projekt, aktivitaeten: akt?.results ?? [] });
});

projekte.post('/', async (c) => {
  const s = gfPflicht(c);
  const r = Neu.safeParse(await c.req.json());
  if (!r.success) throw validierungsFehler(r.error);
  const d = r.data;
  const db = c.env.DB;
  const vorhanden = await db.prepare('SELECT 1 FROM projekte WHERE slug = ?').bind(d.slug).first();
  if (vorhanden) throw new ApiFehler(409, 'existiert', 'Ein Projekt mit diesem Kürzel existiert bereits.');
  await db.batch([
    db
      .prepare(
        `INSERT INTO projekte (slug, name, kurz, beschreibung, ziele, repo_url, website_url, hosting, stack, farbe, status, sortierung)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(d.slug, d.name, d.kurz, d.beschreibung, d.ziele, d.repo_url, d.website_url, d.hosting, d.stack, d.farbe, d.status, d.sortierung),
    auditStatement(db, s, { aktion: 'projekt.angelegt', objektTyp: 'projekt', objektId: d.slug, projektSlug: d.slug, details: { name: d.name } }),
  ]);
  return c.json({ ok: true, slug: d.slug }, 201);
});

projekte.patch('/:slug', async (c) => {
  const s = gfPflicht(c);
  const slug = c.req.param('slug');
  const r = Aenderung.safeParse(await c.req.json());
  if (!r.success) throw validierungsFehler(r.error);
  const { version, ...felder } = r.data;
  const eintraege = Object.entries(felder).filter(([, v]) => v !== undefined);
  if (eintraege.length === 0) throw new ApiFehler(400, 'keine_aenderung', 'Keine Änderung übermittelt.');

  const db = c.env.DB;
  const set = eintraege.map(([k]) => `${k} = ?`).join(', ');
  // Optimistisches Sperren: nur wenn die Version noch stimmt (Schutz vor Überschreiben von einem anderen Gerät)
  const res = await db.batch([
    db
      .prepare(`UPDATE projekte SET ${set}, aktualisiert_am = ?, version = version + 1 WHERE slug = ? AND version = ?`)
      .bind(...eintraege.map(([, v]) => v as string | number | null), jetzt(), slug, version),
  ]);
  if ((res[0]?.meta.changes ?? 0) === 0) {
    const da = await db.prepare('SELECT version FROM projekte WHERE slug = ?').bind(slug).first<{ version: number }>();
    if (!da) throw new ApiFehler(404, 'nicht_gefunden', 'Projekt nicht gefunden.');
    throw new ApiFehler(409, 'veraltet', 'Das Projekt wurde inzwischen auf einem anderen Gerät geändert. Bitte neu laden.', {
      aktuelleVersion: da.version,
    });
  }
  await auditStatement(db, s, {
    aktion: 'projekt.geaendert',
    objektTyp: 'projekt',
    objektId: slug,
    projektSlug: slug,
    details: { felder: eintraege.map(([k]) => k) },
  }).run();
  return c.json({ ok: true, version: version + 1 });
});

export default projekte;
