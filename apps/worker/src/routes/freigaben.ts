import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { body, naechsteId, pruefeTeilnehmer } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import { gfPflicht, sitzungPflicht, stepUpPflicht } from '../lib/sitzung';
import { meldenAusRoute } from './benachrichtigungen';
import { agentVon, pruefeEigeneAufgabe, pruefeProjekt, schreiberPflicht } from '../lib/agent';
import { jetzt } from '../lib/zeit';

const freigaben = new Hono<AppEnv>();

const TYPEN = ['kosten', 'veroeffentlichung', 'produktiv', 'loeschung', 'sicherheit', 'vertrag', 'sonstiges'] as const;

freigaben.get('/', async (c) => {
  sitzungPflicht(c);
  const status = c.req.query('status');
  const bed = status === 'offen' ? `WHERE f.status = 'offen'` : status === 'entschieden' ? `WHERE f.status <> 'offen'` : '';
  const r = await c.env.DB.prepare(
    `SELECT f.*, p.name AS projekt_name, p.farbe AS projekt_farbe, a.titel AS aufgabe_titel
       FROM freigaben f LEFT JOIN projekte p ON p.slug = f.projekt_slug LEFT JOIN aufgaben a ON a.id = f.aufgabe_id
      ${bed}
      ORDER BY CASE f.status WHEN 'offen' THEN 0 ELSE 1 END, f.dringend DESC, COALESCE(f.entschieden_am, f.angefragt_am) DESC
      LIMIT 200`,
  ).all();
  return c.json({ freigaben: r.results });
});

const Neu = z.object({
  typ: z.enum(TYPEN),
  titel: z.string().trim().min(3).max(160),
  begruendung: z.string().trim().max(8000).default(''),
  projekt_slug: z.string().max(40).nullable().default(null),
  aufgabe_id: z.string().regex(/^TD-\d{4,}$/).nullable().default(null),
  angefragt_von: z.string().min(2).max(40).default('gf'),
  dringend: z.boolean().default(false),
});

/** Freigabe beantragen. Mit Aufgabenbezug wird die Aufgabe angehalten (Status „Freigabe erforderlich“). */
freigaben.post('/', async (c) => {
  const s = schreiberPflicht(c);
  const d = await body(c, Neu);
  const agent = agentVon(c);
  if (agent) d.angefragt_von = agent.mitarbeiterId;
  const db = c.env.DB;
  await pruefeTeilnehmer(db, d.angefragt_von);
  if (agent && !d.aufgabe_id) pruefeProjekt(c, d.projekt_slug);
  let projekt = d.projekt_slug;
  const stmts: D1PreparedStatement[] = [];
  if (d.aufgabe_id) {
    const a = await db.prepare('SELECT projekt_slug, status, zustaendig_id FROM aufgaben WHERE id = ?').bind(d.aufgabe_id).first<{ projekt_slug: string; status: string; zustaendig_id: string | null }>();
    if (!a) throw new ApiFehler(400, 'aufgabe_unbekannt', 'Die Aufgabe existiert nicht.');
    pruefeEigeneAufgabe(c, a);
    if (a.status === 'abgeschlossen' || a.status === 'abgebrochen') throw new ApiFehler(409, 'aufgabe_beendet', 'Die Aufgabe ist bereits beendet.');
    projekt = a.projekt_slug;
    stmts.push(
      db
        .prepare(`UPDATE aufgaben SET status = 'freigabe_erforderlich', aktualisiert_am = ?, version = version + 1 WHERE id = ?`)
        .bind(jetzt(), d.aufgabe_id),
    );
  }
  const id = await naechsteId(db, 'freigabe');
  await db.batch([
    db
      .prepare(`INSERT INTO freigaben (id, typ, titel, begruendung, projekt_slug, aufgabe_id, angefragt_von, dringend) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, d.typ, d.titel, d.begruendung, projekt, d.aufgabe_id, d.angefragt_von, d.dringend ? 1 : 0),
    ...stmts,
    auditStatement(db, s, { aktion: 'freigabe.beantragt', objektTyp: 'freigabe', objektId: id, projektSlug: projekt, details: { typ: d.typ } }),
  ]);
  await meldenAusRoute(c, {
    kategorie: d.dringend ? 'kritisch' : 'wichtig',
    titel: `${d.dringend ? 'Dringende ' : ''}Freigabe erforderlich: ${d.titel}`,
    text: `${id}${d.aufgabe_id ? ` · Aufgabe ${d.aufgabe_id}` : ''}`,
    url: '/freigaben',
    schluessel: `freigabe:${id}`,
  });
  return c.json({ ok: true, id }, 201);
});

/**
 * Stufe-3-Entscheidung der Geschäftsführung. Verlangt eine frische Passkey-Bestätigung (Step-up).
 * Erteilt → Aufgabe läuft weiter („in Bearbeitung“). Abgelehnt → Aufgabe „blockiert“.
 * Jede Entscheidung wird unveränderlich im Entscheidungsprotokoll (Stufe 3) festgehalten.
 */
freigaben.post('/:id/entscheiden', async (c) => {
  const s = stepUpPflicht(c);
  const id = c.req.param('id');
  const d = await body(c, z.object({ entscheidung: z.enum(['erteilt', 'abgelehnt']), kommentar: z.string().trim().max(4000).default('') }));
  const db = c.env.DB;
  const f = await db.prepare('SELECT * FROM freigaben WHERE id = ?').bind(id).first<{
    id: string; titel: string; status: string; aufgabe_id: string | null; projekt_slug: string | null; typ: string;
  }>();
  if (!f) throw new ApiFehler(404, 'nicht_gefunden', 'Freigabe nicht gefunden.');
  if (f.status !== 'offen') throw new ApiFehler(409, 'bereits_entschieden', 'Diese Freigabe wurde bereits entschieden.');
  const enId = await naechsteId(db, 'entscheidung');
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE freigaben SET status = ?, entschieden_am = ?, entschieden_von = ?, kommentar = ? WHERE id = ? AND status = 'offen'`)
      .bind(d.entscheidung, jetzt(), s.benutzer.id, d.kommentar || null, id),
    db
      .prepare(`INSERT INTO entscheidungen (id, stufe, titel, begruendung, projekt_slug, aufgabe_id, von, freigabe_id) VALUES (?, 3, ?, ?, ?, ?, 'gf', ?)`)
      .bind(enId, `${d.entscheidung === 'erteilt' ? 'Freigegeben' : 'Abgelehnt'}: ${f.titel}`.slice(0, 200), d.kommentar, f.projekt_slug, f.aufgabe_id, id),
  ];
  if (f.aufgabe_id) {
    // Erst wenn keine weitere Freigabe dieser Aufgabe offen ist, läuft sie weiter.
    stmts.push(
      d.entscheidung === 'abgelehnt'
        ? db
            .prepare(`UPDATE aufgaben SET status = 'blockiert', aktualisiert_am = ?, version = version + 1 WHERE id = ? AND status = 'freigabe_erforderlich'`)
            .bind(jetzt(), f.aufgabe_id)
        : db
            .prepare(
              `UPDATE aufgaben SET status = 'in_bearbeitung', aktualisiert_am = ?, version = version + 1
                WHERE id = ? AND status = 'freigabe_erforderlich'
                  AND NOT EXISTS (SELECT 1 FROM freigaben WHERE aufgabe_id = ? AND status = 'offen' AND id <> ?)`,
            )
            .bind(jetzt(), f.aufgabe_id, f.aufgabe_id, id),
      db
        .prepare(`INSERT INTO nachrichten (art, von, an, projekt_slug, aufgabe_id, inhalt) VALUES ('information', 'gf', NULL, ?, ?, ?)`)
        .bind(f.projekt_slug, f.aufgabe_id, `Freigabe ${id} ${d.entscheidung === 'erteilt' ? 'erteilt' : 'abgelehnt'}${d.kommentar ? `: ${d.kommentar}` : '.'}`),
    );
  }
  stmts.push(
    auditStatement(db, s, {
      aktion: d.entscheidung === 'erteilt' ? 'freigabe.erteilt' : 'freigabe.abgelehnt',
      objektTyp: 'freigabe',
      objektId: id,
      projektSlug: f.projekt_slug,
      details: { entscheidung: enId, typ: f.typ },
    }),
  );
  const res = await db.batch(stmts);
  if ((res[0]?.meta.changes ?? 0) === 0) throw new ApiFehler(409, 'bereits_entschieden', 'Diese Freigabe wurde gleichzeitig entschieden.');
  return c.json({ ok: true, entscheidung: enId });
});

freigaben.post('/:id/zurueckziehen', async (c) => {
  const s = gfPflicht(c);
  const id = c.req.param('id');
  const db = c.env.DB;
  const f = await db.prepare('SELECT aufgabe_id, projekt_slug, status FROM freigaben WHERE id = ?').bind(id).first<{ aufgabe_id: string | null; projekt_slug: string | null; status: string }>();
  if (!f) throw new ApiFehler(404, 'nicht_gefunden', 'Freigabe nicht gefunden.');
  if (f.status !== 'offen') throw new ApiFehler(409, 'bereits_entschieden', 'Nur offene Freigaben können zurückgezogen werden.');
  await db.batch([
    db.prepare(`UPDATE freigaben SET status = 'zurueckgezogen', entschieden_am = ?, entschieden_von = ? WHERE id = ?`).bind(jetzt(), s.benutzer.id, id),
    ...(f.aufgabe_id
      ? [
          db
            .prepare(
              `UPDATE aufgaben SET status = 'in_bearbeitung', aktualisiert_am = ?, version = version + 1
                WHERE id = ? AND status = 'freigabe_erforderlich' AND NOT EXISTS (SELECT 1 FROM freigaben WHERE aufgabe_id = ? AND status = 'offen' AND id <> ?)`,
            )
            .bind(jetzt(), f.aufgabe_id, f.aufgabe_id, id),
        ]
      : []),
    auditStatement(db, s, { aktion: 'freigabe.zurueckgezogen', objektTyp: 'freigabe', objektId: id, projektSlug: f.projekt_slug }),
  ]);
  return c.json({ ok: true });
});

export default freigaben;
