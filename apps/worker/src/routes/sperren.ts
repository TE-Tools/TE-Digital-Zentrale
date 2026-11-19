import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { agentVon, pruefeEigeneAufgabe, schreiberPflicht } from '../lib/agent';
import { auditStatement } from '../lib/audit';
import { body } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import { listenUeberschneidung } from '../lib/pfade';
import { sitzungPflicht } from '../lib/sitzung';
import { jetzt } from '../lib/zeit';

/** Exklusive Sperren für konfliktträchtige Änderungen (Pflichtenheft 7.1) */
const sperren = new Hono<AppEnv>();

interface SperreZeile {
  id: number;
  repo: string;
  pfade: string;
  aufgabe_id: string;
  inhaber_id: string;
  grund: string;
  seit: string;
}

sperren.get('/', async (c) => {
  sitzungPflicht(c);
  const repo = c.req.query('repo');
  const r = await c.env.DB.prepare(
    `SELECT s.*, a.titel AS aufgabe_titel, a.status AS aufgabe_status FROM repo_sperren s JOIN aufgaben a ON a.id = s.aufgabe_id
      WHERE s.freigegeben_am IS NULL ${repo ? 'AND s.repo = ?' : ''} ORDER BY s.seit DESC`,
  )
    .bind(...(repo ? [repo] : []))
    .all<SperreZeile>();
  return c.json({ sperren: r.results.map((s) => ({ ...s, pfade: JSON.parse(s.pfade) as string[] })) });
});

const Neu = z.object({
  aufgabe_id: z.string().regex(/^TD-\d{4,}$/),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Repository als Organisation/Name'),
  pfade: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  grund: z.string().trim().max(500).default(''),
});

sperren.post('/', async (c) => {
  const s = schreiberPflicht(c);
  const d = await body(c, Neu);
  const db = c.env.DB;
  const a = await db
    .prepare('SELECT id, projekt_slug, zustaendig_id, status FROM aufgaben WHERE id = ?')
    .bind(d.aufgabe_id)
    .first<{ id: string; projekt_slug: string; zustaendig_id: string | null; status: string }>();
  if (!a) throw new ApiFehler(400, 'aufgabe_unbekannt', 'Die Aufgabe existiert nicht.');
  pruefeEigeneAufgabe(c, a);
  if (a.status === 'abgeschlossen' || a.status === 'abgebrochen') throw new ApiFehler(409, 'aufgabe_beendet', 'Die Aufgabe ist beendet.');

  const aktive = await db
    .prepare('SELECT * FROM repo_sperren WHERE repo = ? AND freigegeben_am IS NULL AND aufgabe_id <> ?')
    .bind(d.repo, d.aufgabe_id)
    .all<SperreZeile>();
  const konflikte = aktive.results
    .map((x) => ({ sperre: x, pfade: listenUeberschneidung(d.pfade, JSON.parse(x.pfade) as string[]) }))
    .filter((k) => k.pfade.length > 0);
  if (konflikte.length) {
    // Keine automatische Übernahme fremder Sperren – die Aufgabe wird als blockiert gemeldet.
    throw new ApiFehler(
      409,
      'gesperrt',
      `Bereits gesperrt durch ${konflikte.map((k) => `${k.sperre.aufgabe_id} (${k.pfade.join(', ')})`).join('; ')}.`,
      konflikte.map((k) => ({ sperre: k.sperre.id, aufgabe: k.sperre.aufgabe_id, inhaber: k.sperre.inhaber_id, pfade: k.pfade })),
    );
  }
  const inhaber = agentVon(c)?.mitarbeiterId ?? 'gf';
  const r = await db.batch([
    db
      .prepare('INSERT INTO repo_sperren (repo, pfade, aufgabe_id, inhaber_id, grund) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(d.repo, JSON.stringify(d.pfade), d.aufgabe_id, inhaber, d.grund),
    auditStatement(db, s, { aktion: 'sperre.gesetzt', objektTyp: 'aufgabe', objektId: d.aufgabe_id, projektSlug: a.projekt_slug, details: { repo: d.repo, pfade: d.pfade } }),
  ]);
  return c.json({ ok: true, id: (r[0]?.results[0] as { id: number }).id }, 201);
});

sperren.post('/:id/freigeben', async (c) => {
  const s = schreiberPflicht(c);
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const sp = await db
    .prepare(`SELECT s.*, a.projekt_slug, a.zustaendig_id FROM repo_sperren s JOIN aufgaben a ON a.id = s.aufgabe_id WHERE s.id = ? AND s.freigegeben_am IS NULL`)
    .bind(id)
    .first<SperreZeile & { projekt_slug: string; zustaendig_id: string | null }>();
  if (!sp) throw new ApiFehler(404, 'nicht_gefunden', 'Sperre nicht gefunden oder bereits freigegeben.');
  // Agenten geben nur eigene Sperren frei; die Geschäftsführung darf jede lösen.
  if (agentVon(c)) pruefeEigeneAufgabe(c, sp);
  await db.batch([
    db.prepare('UPDATE repo_sperren SET freigegeben_am = ? WHERE id = ?').bind(jetzt(), id),
    auditStatement(db, s, { aktion: 'sperre.freigegeben', objektTyp: 'aufgabe', objektId: sp.aufgabe_id, projektSlug: sp.projekt_slug, details: { sperre: id, repo: sp.repo } }),
  ]);
  return c.json({ ok: true });
});

export default sperren;
