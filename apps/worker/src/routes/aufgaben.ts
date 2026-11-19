import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { hatInhalt, zerlegeAntwort } from '../lib/antwort';
import { auditStatement } from '../lib/audit';
import { body, naechsteId, pruefeTeilnehmer } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import { erzeugePaket, pruefePaket, type PaketDaten } from '../lib/paket';
import { gfPflicht, sitzungPflicht } from '../lib/sitzung';
import { agentVon, pruefeEigeneAufgabe, schreiberPflicht } from '../lib/agent';
import { AUFGABEN_STATUS, istErlaubt, OFFEN, type AufgabenStatus } from '../lib/status';
import { inMinuten, jetzt } from '../lib/zeit';
import { meldenAusRoute } from './benachrichtigungen';

const aufgaben = new Hono<AppEnv>();

const PRIORITAETEN = ['niedrig', 'normal', 'hoch', 'kritisch'] as const;
const text = (max: number) => z.string().trim().max(max);

const UebergabeSchema = z.object({
  ziel: text(4000).default(''),
  ausgangslage: text(4000).default(''),
  dateien: text(4000).default(''),
  ergebnis_soll: text(4000).default(''),
  einschraenkungen: text(4000).default(''),
  akzeptanzkriterien: text(4000).default(''),
  freigaben: text(2000).default(''),
});

const NeuSchema = z.object({
  titel: z.string().trim().min(3).max(160),
  beschreibung: text(8000).default(''),
  projekt_slug: z.string().min(2).max(40),
  zustaendig_id: z.string().max(40).nullable().default(null),
  prioritaet: z.enum(PRIORITAETEN).default('normal'),
  uebergabe: UebergabeSchema.default(UebergabeSchema.parse({})),
  abhaengig_von: z.array(z.string().regex(/^TD-\d{4,}$/)).max(20).default([]),
});

const AenderungSchema = z.object({
  version: z.number().int().min(1),
  titel: z.string().trim().min(3).max(160).optional(),
  beschreibung: text(8000).optional(),
  prioritaet: z.enum(PRIORITAETEN).optional(),
  zustaendig_id: z.string().max(40).nullable().optional(),
  status: z.enum(AUFGABEN_STATUS).optional(),
  pruefstatus: z.enum(['offen', 'bestanden', 'abgelehnt', 'nicht_noetig']).optional(),
  branch: z.string().trim().max(200).nullable().optional(),
  pr_url: z.string().trim().max(300).regex(/^(https:\/\/.*)?$/, 'Nur https-Adressen').nullable().optional(),
  uebergabe: UebergabeSchema.partial().optional(),
});

interface AufgabeZeile {
  id: string;
  projekt_slug: string;
  titel: string;
  beschreibung: string;
  zustaendig_id: string | null;
  prioritaet: string;
  status: AufgabenStatus;
  pruefstatus: string;
  ergebnis: string;
  version: number;
}

async function ladeAufgabe(db: D1Database, id: string): Promise<AufgabeZeile> {
  const a = await db.prepare('SELECT * FROM aufgaben WHERE id = ?').bind(id).first<AufgabeZeile>();
  if (!a) throw new ApiFehler(404, 'nicht_gefunden', 'Aufgabe nicht gefunden.');
  return a;
}

/** Setzt den Mitarbeiter auf „verfügbar“, wenn er keine weitere Aufgabe in Arbeit hat. */
function mitarbeiterFreiStatement(db: D1Database, mitarbeiterId: string, ausserAufgabe: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE mitarbeiter SET status = 'verfuegbar', status_bestaetigt_am = ?
        WHERE id = ? AND status IN ('arbeitet','unbekannt')
          AND NOT EXISTS (SELECT 1 FROM aufgaben WHERE zustaendig_id = ? AND status = 'in_bearbeitung' AND id <> ?)`,
    )
    .bind(jetzt(), mitarbeiterId, mitarbeiterId, ausserAufgabe);
}

// ------------------------------------------------------------------ Liste

const GRUPPEN: Record<string, AufgabenStatus[]> = {
  offen: OFFEN,
  arbeit: ['zugewiesen', 'in_bearbeitung'],
  pruefung: ['pruefung', 'freigabe_erforderlich'],
  wartend: ['neu', 'geplant', 'wartend'],
  blockiert: ['blockiert'],
  erledigt: ['abgeschlossen', 'abgebrochen'],
};

aufgaben.get('/', async (c) => {
  sitzungPflicht(c);
  const q = c.req.query();
  const bed: string[] = [];
  const werte: (string | number)[] = [];
  const gruppe = GRUPPEN[q.gruppe ?? ''];
  if (gruppe) {
    bed.push(`a.status IN (${gruppe.map(() => '?').join(',')})`);
    werte.push(...gruppe);
  }
  if (q.status && (AUFGABEN_STATUS as readonly string[]).includes(q.status)) {
    bed.push('a.status = ?');
    werte.push(q.status);
  }
  if (q.projekt) {
    bed.push('a.projekt_slug = ?');
    werte.push(q.projekt);
  }
  if (q.zustaendig) {
    bed.push('a.zustaendig_id = ?');
    werte.push(q.zustaendig);
  }
  if (q.suche) {
    bed.push('(a.titel LIKE ? OR a.id LIKE ?)');
    werte.push(`%${q.suche.slice(0, 60)}%`, `%${q.suche.slice(0, 60)}%`);
  }
  const r = await c.env.DB.prepare(
    `SELECT a.id, a.titel, a.projekt_slug, a.zustaendig_id, a.prioritaet, a.status, a.pruefstatus, a.erstellt_am, a.aktualisiert_am,
            p.name AS projekt_name, p.farbe AS projekt_farbe, m.name AS zustaendig_name, m.rolle AS zustaendig_rolle,
            (SELECT COUNT(*) FROM aufgaben_abhaengigkeiten d JOIN aufgaben b ON b.id = d.haengt_ab_von
              WHERE d.aufgabe_id = a.id AND b.status <> 'abgeschlossen') AS offene_abhaengigkeiten
       FROM aufgaben a
       JOIN projekte p ON p.slug = a.projekt_slug
       LEFT JOIN mitarbeiter m ON m.id = a.zustaendig_id
      ${bed.length ? 'WHERE ' + bed.join(' AND ') : ''}
      ORDER BY CASE a.prioritaet WHEN 'kritisch' THEN 0 WHEN 'hoch' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
               a.aktualisiert_am DESC
      LIMIT 200`,
  )
    .bind(...werte)
    .all();
  return c.json({ aufgaben: r.results });
});

// ------------------------------------------------------------------ Detail

aufgaben.get('/:id', async (c) => {
  sitzungPflicht(c);
  const id = c.req.param('id');
  const db = c.env.DB;
  const [a, ue, abh, blockiert, cps, msgs, fgs, ents, prs, sps] = await db.batch([
    db.prepare(
      `SELECT a.*, p.name AS projekt_name, p.farbe AS projekt_farbe, m.name AS zustaendig_name, m.rolle AS zustaendig_rolle,
              m.status AS zustaendig_status, m.limit_bis AS zustaendig_limit_bis
         FROM aufgaben a JOIN projekte p ON p.slug = a.projekt_slug LEFT JOIN mitarbeiter m ON m.id = a.zustaendig_id
        WHERE a.id = ?`,
    ).bind(id),
    db.prepare('SELECT * FROM uebergaben WHERE aufgabe_id = ?').bind(id),
    db.prepare(
      `SELECT b.id, b.titel, b.status FROM aufgaben_abhaengigkeiten d JOIN aufgaben b ON b.id = d.haengt_ab_von WHERE d.aufgabe_id = ? ORDER BY b.id`,
    ).bind(id),
    db.prepare(
      `SELECT b.id, b.titel, b.status FROM aufgaben_abhaengigkeiten d JOIN aufgaben b ON b.id = d.aufgabe_id WHERE d.haengt_ab_von = ? ORDER BY b.id`,
    ).bind(id),
    db.prepare('SELECT * FROM checkpoints WHERE aufgabe_id = ? ORDER BY zeit DESC, id DESC LIMIT 20').bind(id),
    db.prepare('SELECT * FROM nachrichten WHERE aufgabe_id = ? ORDER BY zeit, id LIMIT 200').bind(id),
    db.prepare('SELECT * FROM freigaben WHERE aufgabe_id = ? ORDER BY angefragt_am DESC').bind(id),
    db.prepare('SELECT * FROM entscheidungen WHERE aufgabe_id = ? ORDER BY zeit DESC').bind(id),
    db.prepare('SELECT repo, nummer, titel, zustand, branch, url, checks, aktualisiert_am FROM github_prs WHERE aufgabe_id = ? ORDER BY aktualisiert_am DESC').bind(id),
    db.prepare('SELECT id, repo, pfade, inhaber_id, seit FROM repo_sperren WHERE aufgabe_id = ? AND freigegeben_am IS NULL').bind(id),
  ]);
  const aufgabe = a?.results[0];
  if (!aufgabe) throw new ApiFehler(404, 'nicht_gefunden', 'Aufgabe nicht gefunden.');
  return c.json({
    aufgabe,
    uebergabe: ue?.results[0] ?? null,
    abhaengig_von: abh?.results ?? [],
    blockiert_fuer: blockiert?.results ?? [],
    checkpoints: cps?.results ?? [],
    nachrichten: msgs?.results ?? [],
    freigaben: fgs?.results ?? [],
    entscheidungen: ents?.results ?? [],
    pull_requests: prs?.results ?? [],
    sperren: ((sps?.results ?? []) as { pfade: string }[]).map((x) => ({ ...x, pfade: JSON.parse(x.pfade) as string[] })),
  });
});

// ------------------------------------------------------------------ Anlegen

aufgaben.post('/', async (c) => {
  const s = gfPflicht(c);
  const d = await body(c, NeuSchema);
  const db = c.env.DB;
  const projekt = await db.prepare('SELECT slug FROM projekte WHERE slug = ?').bind(d.projekt_slug).first();
  if (!projekt) throw new ApiFehler(400, 'projekt_unbekannt', 'Das Projekt existiert nicht.');
  await pruefeTeilnehmer(db, d.zustaendig_id);
  if (d.abhaengig_von.length) {
    const r = await db
      .prepare(`SELECT COUNT(*) AS n FROM aufgaben WHERE id IN (${d.abhaengig_von.map(() => '?').join(',')})`)
      .bind(...d.abhaengig_von)
      .first<{ n: number }>();
    if ((r?.n ?? 0) !== new Set(d.abhaengig_von).size) throw new ApiFehler(400, 'abhaengigkeit_unbekannt', 'Eine Abhängigkeit existiert nicht.');
  }

  const id = await naechsteId(db, 'aufgabe');
  const status: AufgabenStatus = d.zustaendig_id ? 'zugewiesen' : 'neu';
  const u = d.uebergabe;
  await db.batch([
    db
      .prepare(
        `INSERT INTO aufgaben (id, projekt_slug, titel, beschreibung, zustaendig_id, prioritaet, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, d.projekt_slug, d.titel, d.beschreibung, d.zustaendig_id, d.prioritaet, status),
    db
      .prepare(
        `INSERT INTO uebergaben (aufgabe_id, ziel, ausgangslage, dateien, ergebnis_soll, einschraenkungen, akzeptanzkriterien, freigaben)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, u.ziel, u.ausgangslage, u.dateien, u.ergebnis_soll, u.einschraenkungen, u.akzeptanzkriterien, u.freigaben),
    ...[...new Set(d.abhaengig_von)].map((v) =>
      db.prepare('INSERT INTO aufgaben_abhaengigkeiten (aufgabe_id, haengt_ab_von) VALUES (?, ?)').bind(id, v),
    ),
    ...(d.zustaendig_id
      ? [
          db
            .prepare(`INSERT INTO nachrichten (art, von, an, projekt_slug, aufgabe_id, inhalt) VALUES ('aufgabenuebergabe', 'gf', ?, ?, ?, ?)`)
            .bind(d.zustaendig_id, d.projekt_slug, id, `Neuer Auftrag ${id}: ${d.titel}`),
        ]
      : []),
    auditStatement(db, s, { aktion: 'aufgabe.angelegt', objektTyp: 'aufgabe', objektId: id, projektSlug: d.projekt_slug, details: { titel: d.titel } }),
  ]);
  return c.json({ ok: true, id }, 201);
});

// ------------------------------------------------------------------ Ändern (inkl. Status)

aufgaben.patch('/:id', async (c) => {
  const s = schreiberPflicht(c);
  const id = c.req.param('id');
  const d = await body(c, AenderungSchema);
  const db = c.env.DB;
  const alt = await ladeAufgabe(db, id);
  pruefeEigeneAufgabe(c, alt);
  if (agentVon(c)) {
    // KI-Mitarbeiter: nur Arbeitsstatus und Branch/PR melden
    const erlaubt = new Set(['version', 'status', 'branch', 'pr_url']);
    const fremd = Object.keys(d).filter((k) => !erlaubt.has(k));
    if (fremd.length) throw new ApiFehler(403, 'nicht_erlaubt', `Als KI-Mitarbeiter nicht änderbar: ${fremd.join(', ')}`);
    if (d.status && !['in_bearbeitung', 'wartend', 'blockiert', 'pruefung'].includes(d.status)) {
      throw new ApiFehler(403, 'nicht_erlaubt', 'Diesen Status setzt nur die Geschäftsführung.');
    }
  }
  if (alt.version !== d.version) {
    throw new ApiFehler(409, 'veraltet', 'Die Aufgabe wurde inzwischen auf einem anderen Gerät geändert. Bitte neu laden.', {
      aktuelleVersion: alt.version,
    });
  }
  if (d.zustaendig_id !== undefined) await pruefeTeilnehmer(db, d.zustaendig_id);

  const felder: [string, string | number | null][] = [];
  for (const k of ['titel', 'beschreibung', 'prioritaet', 'zustaendig_id', 'pruefstatus', 'branch', 'pr_url'] as const) {
    if (d[k] !== undefined) felder.push([k, d[k] as string | null]);
  }

  const stmts: D1PreparedStatement[] = [];
  const neuStatus = d.status;
  if (neuStatus && neuStatus !== alt.status) {
    if (neuStatus === 'freigabe_erforderlich') {
      throw new ApiFehler(409, 'freigabe_beantragen', 'Bitte eine Freigabe beantragen – der Status wird dann automatisch gesetzt.');
    }
    if (!istErlaubt(alt.status, neuStatus)) {
      throw new ApiFehler(409, 'statuswechsel_unzulaessig', `Wechsel von „${alt.status}“ nach „${neuStatus}“ ist nicht erlaubt.`);
    }
    if (neuStatus === 'in_bearbeitung') {
      const offen = await db
        .prepare(
          `SELECT b.id FROM aufgaben_abhaengigkeiten x JOIN aufgaben b ON b.id = x.haengt_ab_von WHERE x.aufgabe_id = ? AND b.status <> 'abgeschlossen'`,
        )
        .bind(id)
        .all<{ id: string }>();
      if (offen.results.length) {
        throw new ApiFehler(409, 'abhaengigkeit_offen', `Erst abschließen: ${offen.results.map((r) => r.id).join(', ')}`);
      }
      const zust = d.zustaendig_id !== undefined ? d.zustaendig_id : alt.zustaendig_id;
      if (zust) {
        stmts.push(
          db.prepare(`UPDATE mitarbeiter SET status = 'arbeitet', status_bestaetigt_am = ?, limit_bis = NULL WHERE id = ?`).bind(jetzt(), zust),
        );
      }
    }
    if (neuStatus === 'abgeschlossen') {
      const pruef = d.pruefstatus ?? alt.pruefstatus;
      if (pruef !== 'bestanden' && pruef !== 'nicht_noetig') {
        throw new ApiFehler(409, 'pruefung_offen', 'Vor dem Abschluss muss die Prüfung bestanden oder als nicht nötig markiert sein.');
      }
      const fg = await db.prepare(`SELECT COUNT(*) AS n FROM freigaben WHERE aufgabe_id = ? AND status = 'offen'`).bind(id).first<{ n: number }>();
      if ((fg?.n ?? 0) > 0) throw new ApiFehler(409, 'freigabe_offen', 'Es gibt noch offene Freigaben zu dieser Aufgabe.');
      felder.push(['abgeschlossen_am', jetzt()]);
      if (alt.zustaendig_id) stmts.push(mitarbeiterFreiStatement(db, alt.zustaendig_id, id));
    }
    if (alt.status === 'abgeschlossen') felder.push(['abgeschlossen_am', null]);
    felder.push(['status', neuStatus]);
    if (neuStatus === 'abgeschlossen' || neuStatus === 'abgebrochen') {
      // Sperren der beendeten Aufgabe automatisch lösen
      stmts.push(db.prepare('UPDATE repo_sperren SET freigegeben_am = ? WHERE aufgabe_id = ? AND freigegeben_am IS NULL').bind(jetzt(), id));
    }
  }

  if (felder.length === 0 && !d.uebergabe) throw new ApiFehler(400, 'keine_aenderung', 'Keine Änderung übermittelt.');

  const set = [...felder.map(([k]) => `${k} = ?`), 'aktualisiert_am = ?', 'version = version + 1'].join(', ');
  const haupt = db
    .prepare(`UPDATE aufgaben SET ${set} WHERE id = ? AND version = ?`)
    .bind(...felder.map(([, v]) => v), jetzt(), id, d.version);

  if (d.uebergabe) {
    const ue = Object.entries(d.uebergabe).filter(([, v]) => v !== undefined) as [string, string][];
    if (ue.length) {
      stmts.push(
        db
          .prepare(`UPDATE uebergaben SET ${ue.map(([k]) => `${k} = ?`).join(', ')}, aktualisiert_am = ? WHERE aufgabe_id = ?`)
          .bind(...ue.map(([, v]) => v), jetzt(), id),
      );
    }
  }
  if (d.zustaendig_id && d.zustaendig_id !== alt.zustaendig_id) {
    stmts.push(
      db
        .prepare(`INSERT INTO nachrichten (art, von, an, projekt_slug, aufgabe_id, inhalt) VALUES ('aufgabenuebergabe', 'gf', ?, ?, ?, ?)`)
        .bind(d.zustaendig_id, alt.projekt_slug, id, `Auftrag ${id} übernommen: ${d.titel ?? alt.titel}`),
    );
  }
  const res = await db.batch([
    haupt,
    ...stmts,
    auditStatement(db, s, {
      aktion: neuStatus && neuStatus !== alt.status ? 'aufgabe.status' : 'aufgabe.geaendert',
      objektTyp: 'aufgabe',
      objektId: id,
      projektSlug: alt.projekt_slug,
      details: neuStatus && neuStatus !== alt.status ? { von: alt.status, nach: neuStatus } : { felder: felder.map(([k]) => k) },
    }),
  ]);
  if ((res[0]?.meta.changes ?? 0) === 0) throw new ApiFehler(409, 'veraltet', 'Die Aufgabe wurde gleichzeitig geändert. Bitte neu laden.');
  const prio = d.prioritaet ?? alt.prioritaet;
  if (neuStatus === 'blockiert' && alt.status !== 'blockiert' && (prio === 'hoch' || prio === 'kritisch')) {
    await meldenAusRoute(c, { kategorie: 'kritisch', titel: `Blockiert: ${id}`, text: d.titel ?? alt.titel, url: `/aufgaben/${id}` });
  }
  return c.json({ ok: true, version: d.version + 1 });
});

// ------------------------------------------------------------------ Übergabepaket

aufgaben.get('/:id/paket', async (c) => {
  sitzungPflicht(c);
  const id = c.req.param('id');
  const modus = c.req.query('modus') === 'fortsetzung' ? 'fortsetzung' : 'voll';
  const db = c.env.DB;
  const [a, ue, cp, ent, abh, rf] = await db.batch([
    db.prepare(
      `SELECT a.id, a.titel, a.beschreibung, a.prioritaet, a.status, a.projekt_slug, a.zustaendig_id,
              p.name AS p_name, p.kurz AS p_kurz, p.stack AS p_stack, p.repo_url AS p_repo,
              m.name AS m_name, m.rolle AS m_rolle
         FROM aufgaben a JOIN projekte p ON p.slug = a.projekt_slug LEFT JOIN mitarbeiter m ON m.id = a.zustaendig_id
        WHERE a.id = ?`,
    ).bind(id),
    db.prepare('SELECT * FROM uebergaben WHERE aufgabe_id = ?').bind(id),
    db.prepare('SELECT zusammenfassung, naechste_schritte, zeit FROM checkpoints WHERE aufgabe_id = ? ORDER BY zeit DESC, id DESC LIMIT 1').bind(id),
    db.prepare(
      `SELECT id, stufe, titel FROM entscheidungen
        WHERE aufgabe_id = ? OR (aufgabe_id IS NULL AND projekt_slug = (SELECT projekt_slug FROM aufgaben WHERE id = ?))
        ORDER BY zeit DESC LIMIT 5`,
    ).bind(id, id),
    db.prepare(
      `SELECT b.id, b.titel, b.status FROM aufgaben_abhaengigkeiten x JOIN aufgaben b ON b.id = x.haengt_ab_von WHERE x.aufgabe_id = ?`,
    ).bind(id),
    // Antworten der GF auf Rückfragen dieser Aufgabe (letzte 5)
    db.prepare(`SELECT von, inhalt FROM nachrichten WHERE aufgabe_id = ? AND von = 'gf' AND art IN ('information','notiz','rueckfrage') ORDER BY zeit DESC LIMIT 5`).bind(id),
  ]);
  const z = a?.results[0] as Record<string, string | null> | undefined;
  if (!z) throw new ApiFehler(404, 'nicht_gefunden', 'Aufgabe nicht gefunden.');
  pruefeEigeneAufgabe(c, { zustaendig_id: z.zustaendig_id ?? null, projekt_slug: z.projekt_slug! });
  const daten: PaketDaten = {
    aufgabe: { id: z.id!, titel: z.titel!, beschreibung: z.beschreibung ?? '', prioritaet: z.prioritaet!, status: z.status! },
    projekt: { name: z.p_name!, kurz: z.p_kurz ?? '', stack: z.p_stack ?? '', repo_url: z.p_repo ?? null },
    mitarbeiter: z.m_rolle ? { name: z.m_name!, rolle: z.m_rolle } : null,
    uebergabe: (ue?.results[0] as PaketDaten['uebergabe']) ?? null,
    checkpoint: (cp?.results[0] as PaketDaten['checkpoint']) ?? null,
    entscheidungen: (ent?.results ?? []) as PaketDaten['entscheidungen'],
    abhaengigkeiten: (abh?.results ?? []) as PaketDaten['abhaengigkeiten'],
    offeneRueckfragen: ((rf?.results ?? []) as PaketDaten['offeneRueckfragen']).reverse(),
  };
  const paket = erzeugePaket(daten, modus);
  return c.json({ modus, text: paket, zeichen: paket.length, warnungen: pruefePaket(paket) });
});

// ------------------------------------------------------------------ Ergebnis zurückführen

aufgaben.post('/:id/ergebnis', async (c) => {
  const s = schreiberPflicht(c);
  const id = c.req.param('id');
  const { text: roh } = await body(c, z.object({ text: z.string().trim().min(1).max(100_000) }));
  const db = c.env.DB;
  const a = await ladeAufgabe(db, id);
  pruefeEigeneAufgabe(c, a);
  if (a.status === 'abgeschlossen' || a.status === 'abgebrochen') {
    throw new ApiFehler(409, 'aufgabe_beendet', 'Die Aufgabe ist bereits beendet. Bitte erst wieder öffnen.');
  }
  const t = zerlegeAntwort(roh);
  const von = a.zustaendig_id ?? 'gf';
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(`INSERT INTO nachrichten (art, von, an, projekt_slug, aufgabe_id, inhalt) VALUES ('ergebnisbericht', ?, 'gf', ?, ?, ?)`)
      .bind(von, a.projekt_slug, id, roh),
  ];
  if (t.zwischenstand) {
    stmts.push(
      db
        .prepare(`INSERT INTO checkpoints (aufgabe_id, mitarbeiter_id, zusammenfassung, grund) VALUES (?, ?, ?, 'zwischenstand')`)
        .bind(id, a.zustaendig_id, t.zwischenstand),
    );
  }
  const fragen = hatInhalt(t.offeneFragen);
  if (fragen) {
    stmts.push(
      db
        .prepare(`INSERT INTO nachrichten (art, von, an, projekt_slug, aufgabe_id, inhalt) VALUES ('rueckfrage', ?, 'gf', ?, ?, ?)`)
        .bind(von, a.projekt_slug, id, t.offeneFragen),
    );
  }
  let freigabeId: string | null = null;
  let neuStatus: AufgabenStatus = 'pruefung';
  if (hatInhalt(t.freigabeantraege)) {
    freigabeId = await naechsteId(db, 'freigabe');
    neuStatus = 'freigabe_erforderlich';
    stmts.push(
      db
        .prepare(
          `INSERT INTO freigaben (id, typ, titel, begruendung, projekt_slug, aufgabe_id, angefragt_von) VALUES (?, 'sonstiges', ?, ?, ?, ?, ?)`,
        )
        .bind(freigabeId, `Freigabeantrag zu ${id}: ${a.titel}`.slice(0, 160), t.freigabeantraege, a.projekt_slug, id, von),
    );
  }
  stmts.push(
    db
      .prepare(`UPDATE aufgaben SET ergebnis = ?, status = ?, pruefstatus = 'offen', aktualisiert_am = ?, version = version + 1 WHERE id = ?`)
      .bind(t.strukturiert && t.ergebnis ? t.ergebnis : roh, neuStatus, jetzt(), id),
  );
  if (a.zustaendig_id) stmts.push(mitarbeiterFreiStatement(db, a.zustaendig_id, id));
  stmts.push(
    auditStatement(db, s, {
      aktion: 'aufgabe.ergebnis',
      objektTyp: 'aufgabe',
      objektId: id,
      projektSlug: a.projekt_slug,
      details: { strukturiert: t.strukturiert, rueckfragen: fragen, freigabe: freigabeId },
    }),
  );
  await db.batch(stmts);
  await meldenAusRoute(c, {
    kategorie: 'wichtig',
    titel: `Neues Ergebnis zu ${id}`,
    text: [a.titel, fragen && 'mit Rückfrage', freigabeId && `Freigabe ${freigabeId} beantragt`].filter(Boolean).join(' · '),
    url: `/aufgaben/${id}`,
  });
  return c.json({
    ok: true,
    status: neuStatus,
    erkannt: { strukturiert: t.strukturiert, zwischenstand: !!t.zwischenstand, rueckfragen: fragen, freigabe: freigabeId },
  });
});

// ------------------------------------------------------------------ Checkpoint

aufgaben.post('/:id/checkpoint', async (c) => {
  const s = schreiberPflicht(c);
  const id = c.req.param('id');
  const d = await body(
    c,
    z.object({ zusammenfassung: z.string().trim().min(3).max(8000), naechste_schritte: text(4000).default('') }),
  );
  const db = c.env.DB;
  const a = await ladeAufgabe(db, id);
  pruefeEigeneAufgabe(c, a);
  await db.batch([
    db
      .prepare(`INSERT INTO checkpoints (aufgabe_id, mitarbeiter_id, zusammenfassung, naechste_schritte, grund) VALUES (?, ?, ?, ?, 'zwischenstand')`)
      .bind(id, a.zustaendig_id, d.zusammenfassung, d.naechste_schritte),
    db.prepare('UPDATE aufgaben SET aktualisiert_am = ? WHERE id = ?').bind(jetzt(), id),
    auditStatement(db, s, { aktion: 'aufgabe.checkpoint', objektTyp: 'aufgabe', objektId: id, projektSlug: a.projekt_slug }),
  ]);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Limit erreicht → Pause (Kap. 6.1)

const STANDARD_PAUSE_MINUTEN = 180;

aufgaben.post('/:id/limit', async (c) => {
  const s = schreiberPflicht(c);
  const id = c.req.param('id');
  const d = await body(
    c,
    z.object({
      bis: z.string().datetime({ offset: true }).optional(),
      notiz: text(4000).default(''),
    }),
  );
  const db = c.env.DB;
  const a = await ladeAufgabe(db, id);
  pruefeEigeneAufgabe(c, a);
  if (!a.zustaendig_id) throw new ApiFehler(409, 'kein_zustaendiger', 'Die Aufgabe hat keinen zuständigen Mitarbeiter.');
  if (a.status === 'abgeschlossen' || a.status === 'abgebrochen') throw new ApiFehler(409, 'aufgabe_beendet', 'Die Aufgabe ist bereits beendet.');
  const bis = d.bis ? new Date(d.bis).toISOString() : inMinuten(STANDARD_PAUSE_MINUTEN);
  if (Date.parse(bis) <= Date.now()) throw new ApiFehler(400, 'zeit_vergangen', 'Der Zeitpunkt liegt in der Vergangenheit.');
  await db.batch([
    db
      .prepare(`UPDATE mitarbeiter SET status = 'wartend_limit', limit_bis = ?, status_bestaetigt_am = ? WHERE id = ?`)
      .bind(bis, jetzt(), a.zustaendig_id),
    db
      .prepare(`UPDATE aufgaben SET status = 'wartend', aktualisiert_am = ?, version = version + 1 WHERE id = ?`)
      .bind(jetzt(), id),
    db
      .prepare(`INSERT INTO checkpoints (aufgabe_id, mitarbeiter_id, zusammenfassung, grund) VALUES (?, ?, ?, 'limit')`)
      .bind(id, a.zustaendig_id, d.notiz || 'Nutzungslimit erreicht – Arbeit sicher pausiert.'),
    auditStatement(db, s, {
      aktion: 'aufgabe.limit',
      objektTyp: 'aufgabe',
      objektId: id,
      projektSlug: a.projekt_slug,
      details: { mitarbeiter: a.zustaendig_id, bis },
    }),
  ]);
  return c.json({ ok: true, bis });
});

aufgaben.post('/:id/fortsetzen', async (c) => {
  const s = gfPflicht(c);
  const id = c.req.param('id');
  const db = c.env.DB;
  const a = await ladeAufgabe(db, id);
  if (a.status !== 'wartend') throw new ApiFehler(409, 'nicht_wartend', 'Nur wartende Aufgaben können fortgesetzt werden.');
  const offen = await db
    .prepare(
      `SELECT b.id FROM aufgaben_abhaengigkeiten x JOIN aufgaben b ON b.id = x.haengt_ab_von WHERE x.aufgabe_id = ? AND b.status <> 'abgeschlossen'`,
    )
    .bind(id)
    .all<{ id: string }>();
  if (offen.results.length) throw new ApiFehler(409, 'abhaengigkeit_offen', `Erst abschließen: ${offen.results.map((r) => r.id).join(', ')}`);
  await db.batch([
    db.prepare(`UPDATE aufgaben SET status = 'in_bearbeitung', aktualisiert_am = ?, version = version + 1 WHERE id = ?`).bind(jetzt(), id),
    ...(a.zustaendig_id
      ? [db.prepare(`UPDATE mitarbeiter SET status = 'arbeitet', limit_bis = NULL, status_bestaetigt_am = ? WHERE id = ?`).bind(jetzt(), a.zustaendig_id)]
      : []),
    auditStatement(db, s, { aktion: 'aufgabe.fortgesetzt', objektTyp: 'aufgabe', objektId: id, projektSlug: a.projekt_slug }),
  ]);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Abhängigkeiten

aufgaben.post('/:id/abhaengigkeiten', async (c) => {
  const s = gfPflicht(c);
  const id = c.req.param('id');
  const { haengt_ab_von } = await body(c, z.object({ haengt_ab_von: z.string().regex(/^TD-\d{4,}$/) }));
  const db = c.env.DB;
  const a = await ladeAufgabe(db, id);
  await ladeAufgabe(db, haengt_ab_von);
  if (haengt_ab_von === id) throw new ApiFehler(400, 'zyklus', 'Eine Aufgabe kann nicht von sich selbst abhängen.');
  // Zyklus-Prüfung: hängt die Ziel-Aufgabe (transitiv) bereits von dieser Aufgabe ab?
  const zyklus = await db
    .prepare(
      `WITH RECURSIVE kette(id) AS (
         SELECT haengt_ab_von FROM aufgaben_abhaengigkeiten WHERE aufgabe_id = ?
         UNION SELECT x.haengt_ab_von FROM aufgaben_abhaengigkeiten x JOIN kette k ON x.aufgabe_id = k.id
       ) SELECT 1 FROM kette WHERE id = ? LIMIT 1`,
    )
    .bind(haengt_ab_von, id)
    .first();
  if (zyklus) throw new ApiFehler(409, 'zyklus', 'Diese Abhängigkeit würde einen Kreis erzeugen.');
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO aufgaben_abhaengigkeiten (aufgabe_id, haengt_ab_von) VALUES (?, ?)').bind(id, haengt_ab_von),
    auditStatement(db, s, { aktion: 'aufgabe.abhaengigkeit', objektTyp: 'aufgabe', objektId: id, projektSlug: a.projekt_slug, details: { haengt_ab_von } }),
  ]);
  return c.json({ ok: true });
});

aufgaben.delete('/:id/abhaengigkeiten/:von', async (c) => {
  const s = gfPflicht(c);
  const id = c.req.param('id');
  const von = c.req.param('von');
  const db = c.env.DB;
  const a = await ladeAufgabe(db, id);
  await db.batch([
    db.prepare('DELETE FROM aufgaben_abhaengigkeiten WHERE aufgabe_id = ? AND haengt_ab_von = ?').bind(id, von),
    auditStatement(db, s, { aktion: 'aufgabe.abhaengigkeit_entfernt', objektTyp: 'aufgabe', objektId: id, projektSlug: a.projekt_slug, details: { von } }),
  ]);
  return c.json({ ok: true });
});

export default aufgaben;
