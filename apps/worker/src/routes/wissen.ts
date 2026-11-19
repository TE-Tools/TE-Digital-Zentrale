import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { agentVon, pruefeProjekt, schreiberPflicht } from '../lib/agent';
import { auditStatement } from '../lib/audit';
import { body, teilAenderung } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import { gfPflicht, sitzungPflicht } from '../lib/sitzung';
import { jetzt } from '../lib/zeit';

/**
 * Unternehmens- und Projektwissen (Pflichtenheft 2.7, 11). Jede Änderung wird als Version gespeichert.
 * Firmenregeln (Organisation, Rollen, Arbeitsabläufe) ändert nur die Geschäftsführung; KI-Mitarbeiter
 * dürfen Projekt- und Fachwissen im eigenen Bereich pflegen (interne Dokumentation = Stufe 1).
 */
const wissen = new Hono<AppEnv>();

export const KATEGORIEN = ['organisation', 'rolle', 'arbeitsablauf', 'anleitung', 'architektur', 'technik', 'entscheidung', 'zusammenfassung', 'sonstiges'] as const;
const NUR_GF = new Set(['organisation', 'rolle', 'arbeitsablauf']);

interface Zeile {
  id: number;
  projekt_slug: string | null;
  kategorie: string;
  titel: string;
  zusammenfassung: string;
  inhalt: string;
  tags: string;
  quelle: string;
  fuer_kontext: number;
  archiviert: number;
  version: number;
}

async function laden(db: D1Database, id: number): Promise<Zeile> {
  const w = await db.prepare('SELECT * FROM wissen WHERE id = ?').bind(id).first<Zeile>();
  if (!w) throw new ApiFehler(404, 'nicht_gefunden', 'Wissensartikel nicht gefunden.');
  return w;
}

wissen.get('/', async (c) => {
  sitzungPflicht(c);
  const q = c.req.query();
  const bed: string[] = [q.archiviert === '1' ? 'w.archiviert = 1' : 'w.archiviert = 0'];
  const werte: string[] = [];
  if (q.suche && q.suche.trim().length >= 2) {
    const s = `%${q.suche.trim().slice(0, 80)}%`;
    bed.push('(w.titel LIKE ? OR w.zusammenfassung LIKE ? OR w.inhalt LIKE ? OR w.tags LIKE ?)');
    werte.push(s, s, s, s);
  }
  if (q.kategorie && (KATEGORIEN as readonly string[]).includes(q.kategorie)) {
    bed.push('w.kategorie = ?');
    werte.push(q.kategorie);
  }
  if (q.projekt === 'unternehmen') bed.push('w.projekt_slug IS NULL');
  else if (q.projekt) {
    bed.push('w.projekt_slug = ?');
    werte.push(q.projekt);
  }
  const agent = agentVon(c);
  if (agent?.projekte) {
    bed.push(`(w.projekt_slug IS NULL OR w.projekt_slug IN (${agent.projekte.map(() => '?').join(',')}))`);
    werte.push(...agent.projekte);
  }
  const r = await c.env.DB.prepare(
    `SELECT w.id, w.projekt_slug, w.kategorie, w.titel, w.zusammenfassung, w.tags, w.quelle, w.fuer_kontext, w.archiviert, w.version,
            w.aktualisiert_am, w.aktualisiert_von, p.name AS projekt_name, p.farbe AS projekt_farbe, length(w.inhalt) AS laenge
       FROM wissen w LEFT JOIN projekte p ON p.slug = w.projekt_slug
      WHERE ${bed.join(' AND ')}
      ORDER BY CASE w.kategorie WHEN 'organisation' THEN 0 WHEN 'arbeitsablauf' THEN 1 WHEN 'rolle' THEN 2 ELSE 3 END, w.aktualisiert_am DESC
      LIMIT 200`,
  )
    .bind(...werte)
    .all();
  return c.json({ wissen: r.results });
});

wissen.get('/:id', async (c) => {
  sitzungPflicht(c);
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const w = await laden(db, id);
  if (w.projekt_slug) pruefeProjekt(c, w.projekt_slug);
  const [p, v] = await db.batch([
    db.prepare('SELECT name, farbe FROM projekte WHERE slug = ?').bind(w.projekt_slug ?? ''),
    db.prepare('SELECT version, titel, geaendert_von, geaendert_am FROM wissen_versionen WHERE wissen_id = ? ORDER BY version DESC LIMIT 50').bind(id),
  ]);
  const pr = p?.results[0] as { name: string; farbe: string } | undefined;
  return c.json({ wissen: { ...w, projekt_name: pr?.name ?? null, projekt_farbe: pr?.farbe ?? null }, versionen: v?.results ?? [] });
});

wissen.get('/:id/versionen/:v', async (c) => {
  sitzungPflicht(c);
  const r = await c.env.DB.prepare('SELECT * FROM wissen_versionen WHERE wissen_id = ? AND version = ?')
    .bind(Number(c.req.param('id')), Number(c.req.param('v')))
    .first();
  if (!r) throw new ApiFehler(404, 'nicht_gefunden', 'Version nicht gefunden.');
  return c.json({ version: r });
});

const Felder = z.object({
  titel: z.string().trim().min(3).max(160),
  kategorie: z.enum(KATEGORIEN),
  projekt_slug: z.string().max(40).nullable().default(null),
  zusammenfassung: z.string().trim().max(600).default(''),
  inhalt: z.string().max(60_000).default(''),
  tags: z.string().trim().max(200).default(''),
  fuer_kontext: z.boolean().default(true),
});

function pruefeRechte(c: Parameters<typeof agentVon>[0], kategorie: string, projekt: string | null) {
  const agent = agentVon(c);
  if (!agent) return;
  if (NUR_GF.has(kategorie)) throw new ApiFehler(403, 'nur_gf', 'Firmenregeln, Rollen und Arbeitsabläufe ändert nur die Geschäftsführung.');
  if (projekt) pruefeProjekt(c, projekt);
  else if (agent.projekte) throw new ApiFehler(403, 'projekt_gesperrt', 'Unternehmensweites Wissen ist für diesen Zugang nicht freigegeben.');
}

wissen.post('/', async (c) => {
  const s = schreiberPflicht(c);
  const d = await body(c, Felder);
  pruefeRechte(c, d.kategorie, d.projekt_slug);
  const db = c.env.DB;
  if (d.projekt_slug && !(await db.prepare('SELECT 1 FROM projekte WHERE slug = ?').bind(d.projekt_slug).first())) {
    throw new ApiFehler(400, 'projekt_unbekannt', 'Das Projekt existiert nicht.');
  }
  const r = await db
    .prepare(
      `INSERT INTO wissen (projekt_slug, kategorie, titel, zusammenfassung, inhalt, tags, fuer_kontext, aktualisiert_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, erstellt_am`,
    )
    .bind(d.projekt_slug, d.kategorie, d.titel, d.zusammenfassung, d.inhalt, d.tags, d.fuer_kontext ? 1 : 0, s.benutzer.name)
    .first<{ id: number; erstellt_am: string }>();
  await db.batch([
    db
      .prepare(`INSERT INTO wissen_versionen (wissen_id, version, titel, zusammenfassung, inhalt, geaendert_von, geaendert_am) VALUES (?, 1, ?, ?, ?, ?, ?)`)
      .bind(r!.id, d.titel, d.zusammenfassung, d.inhalt, s.benutzer.name, r!.erstellt_am),
    auditStatement(db, s, { aktion: 'wissen.angelegt', objektTyp: 'wissen', objektId: String(r!.id), projektSlug: d.projekt_slug, details: { titel: d.titel } }),
  ]);
  return c.json({ ok: true, id: r!.id }, 201);
});

wissen.patch('/:id', async (c) => {
  const s = schreiberPflicht(c);
  const id = Number(c.req.param('id'));
  const d = await body(c, teilAenderung(Felder).extend({ version: z.number().int().min(1) }));
  const db = c.env.DB;
  const alt = await laden(db, id);
  pruefeRechte(c, alt.kategorie, alt.projekt_slug);
  if (d.kategorie !== undefined || d.projekt_slug !== undefined) pruefeRechte(c, d.kategorie ?? alt.kategorie, d.projekt_slug !== undefined ? d.projekt_slug : alt.projekt_slug);
  if (alt.version !== d.version) {
    throw new ApiFehler(409, 'veraltet', 'Der Artikel wurde inzwischen geändert. Bitte neu laden.', { aktuelleVersion: alt.version });
  }
  const neu = {
    titel: d.titel ?? alt.titel,
    kategorie: d.kategorie ?? alt.kategorie,
    projekt_slug: d.projekt_slug !== undefined ? d.projekt_slug : alt.projekt_slug,
    zusammenfassung: d.zusammenfassung ?? alt.zusammenfassung,
    inhalt: d.inhalt ?? alt.inhalt,
    tags: d.tags ?? alt.tags,
    fuer_kontext: d.fuer_kontext !== undefined ? (d.fuer_kontext ? 1 : 0) : alt.fuer_kontext,
  };
  const zeit = jetzt();
  const r = await db.batch([
    db
      .prepare(
        `UPDATE wissen SET titel = ?, kategorie = ?, projekt_slug = ?, zusammenfassung = ?, inhalt = ?, tags = ?, fuer_kontext = ?,
           version = version + 1, aktualisiert_am = ?, aktualisiert_von = ? WHERE id = ? AND version = ?`,
      )
      .bind(neu.titel, neu.kategorie, neu.projekt_slug, neu.zusammenfassung, neu.inhalt, neu.tags, neu.fuer_kontext, zeit, s.benutzer.name, id, d.version),
    db
      .prepare(`INSERT INTO wissen_versionen (wissen_id, version, titel, zusammenfassung, inhalt, geaendert_von, geaendert_am) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, d.version + 1, neu.titel, neu.zusammenfassung, neu.inhalt, s.benutzer.name, zeit),
    auditStatement(db, s, { aktion: 'wissen.geaendert', objektTyp: 'wissen', objektId: String(id), projektSlug: neu.projekt_slug, details: { version: d.version + 1 } }),
  ]);
  if ((r[0]?.meta.changes ?? 0) === 0) throw new ApiFehler(409, 'veraltet', 'Gleichzeitig geändert. Bitte neu laden.');
  return c.json({ ok: true, version: d.version + 1 });
});

/** Archivieren statt Löschen – Wissen bleibt nachvollziehbar. */
wissen.post('/:id/archivieren', async (c) => {
  const s = gfPflicht(c);
  const id = Number(c.req.param('id'));
  const { archiviert } = await body(c, z.object({ archiviert: z.boolean().default(true) }));
  const w = await laden(c.env.DB, id);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE wissen SET archiviert = ?, aktualisiert_am = ? WHERE id = ?').bind(archiviert ? 1 : 0, jetzt(), id),
    auditStatement(c.env.DB, s, { aktion: archiviert ? 'wissen.archiviert' : 'wissen.wiederhergestellt', objektTyp: 'wissen', objektId: String(id), projektSlug: w.projekt_slug }),
  ]);
  return c.json({ ok: true });
});

/** Ergebnis einer Aufgabe als Wissensartikel übernehmen (Wissenszusammenfassung). */
wissen.post('/aus-aufgabe/:id', async (c) => {
  const s = gfPflicht(c);
  const aid = c.req.param('id');
  const db = c.env.DB;
  const a = await db
    .prepare(
      `SELECT a.id, a.titel, a.ergebnis, a.projekt_slug, u.ziel, u.akzeptanzkriterien,
              (SELECT zusammenfassung FROM checkpoints WHERE aufgabe_id = a.id ORDER BY zeit DESC, id DESC LIMIT 1) AS zwischenstand
         FROM aufgaben a LEFT JOIN uebergaben u ON u.aufgabe_id = a.id WHERE a.id = ?`,
    )
    .bind(aid)
    .first<{ id: string; titel: string; ergebnis: string; projekt_slug: string; ziel: string | null; akzeptanzkriterien: string | null; zwischenstand: string | null }>();
  if (!a) throw new ApiFehler(404, 'nicht_gefunden', 'Aufgabe nicht gefunden.');
  if (!a.ergebnis.trim()) throw new ApiFehler(409, 'kein_ergebnis', 'Die Aufgabe hat noch kein Ergebnis.');
  const inhalt = [`# ${a.titel}`, a.ziel && `**Ziel:** ${a.ziel}`, `## Ergebnis\n${a.ergebnis}`, a.akzeptanzkriterien && `## Akzeptanzkriterien\n${a.akzeptanzkriterien}`, `_Quelle: Aufgabe ${a.id}_`]
    .filter(Boolean)
    .join('\n\n');
  const zusammenfassung = (a.zwischenstand ?? a.ergebnis).replace(/\s+/g, ' ').slice(0, 500);
  const r = await db
    .prepare(
      `INSERT INTO wissen (projekt_slug, kategorie, titel, zusammenfassung, inhalt, tags, quelle, aktualisiert_von) VALUES (?, 'zusammenfassung', ?, ?, ?, '', ?, ?) RETURNING id, erstellt_am`,
    )
    .bind(a.projekt_slug, `${a.id}: ${a.titel}`.slice(0, 160), zusammenfassung, inhalt, `aufgabe:${a.id}`, s.benutzer.name)
    .first<{ id: number; erstellt_am: string }>();
  await db.batch([
    db
      .prepare(`INSERT INTO wissen_versionen (wissen_id, version, titel, zusammenfassung, inhalt, geaendert_von, geaendert_am) VALUES (?, 1, ?, ?, ?, ?, ?)`)
      .bind(r!.id, `${a.id}: ${a.titel}`.slice(0, 160), zusammenfassung, inhalt, s.benutzer.name, r!.erstellt_am),
    auditStatement(db, s, { aktion: 'wissen.aus_aufgabe', objektTyp: 'wissen', objektId: String(r!.id), projektSlug: a.projekt_slug, details: { aufgabe: a.id } }),
  ]);
  return c.json({ ok: true, id: r!.id }, 201);
});

/** Kompakter Wissensauszug für Übergabepakete: Rolle + Projekt- und Fachwissen, knapp gehalten. */
export async function wissenFuerKontext(
  db: D1Database,
  projektSlug: string,
  mitarbeiterId: string | null,
  budgetZeichen = 1800,
): Promise<{ id: number; titel: string; zusammenfassung: string }[]> {
  const r = await db
    .prepare(
      `SELECT id, titel, zusammenfassung, kategorie, projekt_slug FROM wissen
        WHERE archiviert = 0 AND fuer_kontext = 1 AND zusammenfassung <> ''
          AND (
            (kategorie = 'rolle' AND ? IS NOT NULL AND (',' || replace(tags, ' ', '') || ',') LIKE '%,' || ? || ',%')
            OR projekt_slug = ?
            OR (projekt_slug IS NULL AND kategorie IN ('anleitung', 'technik', 'architektur', 'entscheidung'))
          )
        ORDER BY CASE WHEN kategorie = 'rolle' THEN 0 WHEN projekt_slug = ? THEN 1 ELSE 2 END, aktualisiert_am DESC
        LIMIT 12`,
    )
    .bind(mitarbeiterId, mitarbeiterId, projektSlug, projektSlug)
    .all<{ id: number; titel: string; zusammenfassung: string }>();
  const out: { id: number; titel: string; zusammenfassung: string }[] = [];
  let summe = 0;
  for (const w of r.results) {
    const laenge = w.titel.length + w.zusammenfassung.length + 12;
    if (summe + laenge > budgetZeichen) break;
    summe += laenge;
    out.push(w);
  }
  return out;
}

export default wissen;
