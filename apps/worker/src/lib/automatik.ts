/**
 * Automatik: KI-Mitarbeiter arbeiten Aufträge selbstständig ab – ohne Kopieren.
 *
 * - workers_ai    → Cloudflare Workers AI im eigenen Konto. Gratis-Kontingent (10.000 Neurons/Tag),
 *                   danach Pause bis 00:00 UTC und automatische Fortsetzung. Keine Kosten im Free-Tarif.
 * - github_claude → Die Zentrale startet den Workflow „ki-auftrag.yml“ per GitHub-App. Dort arbeitet
 *                   Claude Code mit dem Claude-Abo (OAuth-Token) und meldet sich per MCP zurück.
 *
 * Abgearbeitet wird im Alarm der Takt-Instanz (live.ts) – nicht im Request, weil KI-Antworten länger
 * dauern können, als ein Request nachlaufen darf. Fachliche Schritte (Status, Ergebnis, Limit) laufen
 * über die normalen API-Routen als dieser KI-Mitarbeiter: gleiche Regeln, gleiches Audit, gleiche Pushes.
 */
import type { AgentKontext, Env } from '../env';
import { alsAgent } from './agent';
import { ApiFehler } from './fehler';
import { githubFetch, installationsToken, verbindungLaden } from './github';
import { jetzt } from './zeit';

export type Automatik = 'workers_ai' | 'github_claude';
export type LaufStatus = 'wartet' | 'laeuft' | 'fertig' | 'fehler' | 'limit' | 'abgebrochen';

export const STANDARD_MODELL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const STANDARD_ARBEITS_REPO = 'TE-Tools/TE-Digital-Zentrale';
export const WORKFLOW_DATEI = 'ki-auftrag.yml';
/** Ohne Lebenszeichen gilt ein Lauf als hängengeblieben */
const ZEITLIMIT_MIN: Record<Automatik, number> = { workers_ai: 15, github_claude: 150 };
/** Höchstens so viele Läufe je Alarm (Rest im nächsten Alarm eine Sekunde später) */
const JE_ALARM = 3;

export interface LaufZeile {
  id: number;
  aufgabe_id: string;
  mitarbeiter_id: string;
  art: Automatik;
  modus: 'voll' | 'fortsetzung';
  status: LaufStatus;
  meldung: string;
  repo: string | null;
  extern_url: string | null;
  erstellt_am: string;
  gestartet_am: string | null;
  aktualisiert_am: string;
  beendet_am: string | null;
}

// ------------------------------------------------------------------ Lauf anlegen

/** Legt einen Lauf an (Status „wartet“). Anstoßen übernimmt der Aufrufer (automatikAnstossen). */
export async function laufAnlegen(db: D1Database, aufgabeId: string, modus: 'voll' | 'fortsetzung' = 'voll'): Promise<number> {
  const a = await db
    .prepare(
      `SELECT a.status, a.zustaendig_id, m.automatik, m.aktiv
         FROM aufgaben a LEFT JOIN mitarbeiter m ON m.id = a.zustaendig_id WHERE a.id = ?`,
    )
    .bind(aufgabeId)
    .first<{ status: string; zustaendig_id: string | null; automatik: Automatik | null; aktiv: number | null }>();
  if (!a) throw new ApiFehler(404, 'nicht_gefunden', 'Aufgabe nicht gefunden.');
  if (!a.zustaendig_id || !a.automatik || !a.aktiv) {
    throw new ApiFehler(409, 'keine_automatik', 'Der zuständige Mitarbeiter arbeitet nicht automatisch. Bitte „Assistent“ oder „Claude Code“ zuweisen.');
  }
  if (['abgeschlossen', 'abgebrochen', 'freigabe_erforderlich'].includes(a.status)) {
    throw new ApiFehler(409, 'nicht_startbar', 'Die Aufgabe ist beendet oder wartet auf eine Freigabe.');
  }
  const aktiv = await db
    .prepare(`SELECT id FROM ki_laeufe WHERE aufgabe_id = ? AND status IN ('wartet','laeuft') LIMIT 1`)
    .bind(aufgabeId)
    .first<{ id: number }>();
  if (aktiv) throw new ApiFehler(409, 'laeuft_bereits', 'Für diese Aufgabe läuft bereits eine Bearbeitung.');
  const r = await db
    .prepare(`INSERT INTO ki_laeufe (aufgabe_id, mitarbeiter_id, art, modus) VALUES (?, ?, ?, ?) RETURNING id`)
    .bind(aufgabeId, a.zustaendig_id, a.automatik, modus)
    .first<{ id: number }>();
  return r!.id;
}

export async function laufSetzen(
  db: D1Database,
  id: number,
  status: LaufStatus,
  felder: { meldung?: string; extern_url?: string | null; repo?: string | null } = {},
): Promise<void> {
  const ende = ['fertig', 'fehler', 'limit', 'abgebrochen'].includes(status);
  await db
    .prepare(
      `UPDATE ki_laeufe SET status = ?, meldung = COALESCE(?, meldung), extern_url = COALESCE(?, extern_url), repo = COALESCE(?, repo),
              gestartet_am = CASE WHEN ? = 'laeuft' THEN COALESCE(gestartet_am, ?) ELSE gestartet_am END,
              beendet_am = CASE WHEN ? THEN ? ELSE NULL END, aktualisiert_am = ?
        WHERE id = ?`,
    )
    .bind(
      status,
      felder.meldung === undefined ? null : felder.meldung.slice(0, 2000),
      felder.extern_url ?? null,
      felder.repo ?? null,
      status,
      jetzt(),
      ende ? 1 : 0,
      jetzt(),
      jetzt(),
      id,
    )
    .run();
}

// ------------------------------------------------------------------ Interne API-Aufrufe als KI-Mitarbeiter

class InternFehler extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function alsMitarbeiter(env: Env, mitarbeiterId: string) {
  const m = await env.DB.prepare('SELECT id, name, rolle FROM mitarbeiter WHERE id = ?').bind(mitarbeiterId).first<{ id: string; name: string; rolle: string }>();
  if (!m) throw new Error(`Mitarbeiter ${mitarbeiterId} fehlt`);
  const agent: AgentKontext = { zugangId: 0, mitarbeiterId: m.id, name: m.name, rolle: m.rolle, projekte: null };
  // Spät laden: index.ts importiert live.ts, das wiederum diese Datei importiert
  const { app } = await import('../index');
  const basis = 'https://zentrale.intern';
  return async <T = Record<string, unknown>>(methode: string, pfad: string, body?: unknown): Promise<T> => {
    const offen: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => void offen.push(p),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    const req = new Request(basis + pfad, {
      method: methode,
      headers: { 'content-type': 'application/json', 'x-te-anfrage': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await app.fetch(alsAgent(req, agent), env, ctx);
    await Promise.allSettled(offen);
    const daten = (await res.json().catch(() => ({}))) as T & { fehler?: { meldung: string } };
    if (!res.ok) throw new InternFehler(daten.fehler?.meldung ?? `Fehler ${res.status}`, res.status);
    return daten;
  };
}

async function inBearbeitung(env: Env, api: Awaited<ReturnType<typeof alsMitarbeiter>>, aufgabeId: string): Promise<void> {
  const a = await env.DB.prepare('SELECT status, version FROM aufgaben WHERE id = ?').bind(aufgabeId).first<{ status: string; version: number }>();
  if (!a) throw new Error('Aufgabe gelöscht');
  if (a.status !== 'in_bearbeitung') await api('PATCH', `/api/aufgaben/${aufgabeId}`, { version: a.version, status: 'in_bearbeitung' });
}

// ------------------------------------------------------------------ Workers AI

const SYSTEM =
  'Du bist ein KI-Mitarbeiter der TE-Digital AI Company und arbeitest selbstständig. Antworte immer auf Deutsch. ' +
  'Du hast keinen Internetzugang und keine Werkzeuge: arbeite ausschließlich mit den Angaben im Auftrag und deinem Fachwissen. ' +
  'Erfinde keine Fakten, Zahlen oder Quellen. Fehlen Informationen, liefere das bestmögliche Ergebnis und stelle die Lücken unter OFFENE FRAGEN. ' +
  'Halte dich exakt an das Antwortformat am Ende des Auftrags.';

/** Erkennt das aufgebrauchte Gratis-Kontingent (Fehler 4006) */
export function istKontingentErschoepft(fehler: unknown): boolean {
  const t = fehler instanceof Error ? fehler.message : String(fehler);
  return /4006|daily free allocation|neurons/i.test(t);
}

/** Nächster Reset des Gratis-Kontingents: 00:00 UTC (+2 Min. Puffer) */
export function naechsterReset(ab = new Date()): string {
  const d = new Date(Date.UTC(ab.getUTCFullYear(), ab.getUTCMonth(), ab.getUTCDate() + 1, 0, 2));
  return d.toISOString();
}

type KiAufruf = (modell: string, eingabe: { messages: { role: string; content: string }[]; max_tokens: number }) => Promise<unknown>;

async function workersAiLauf(env: Env, lauf: LaufZeile): Promise<void> {
  const api = await alsMitarbeiter(env, lauf.mitarbeiter_id);
  await inBearbeitung(env, api, lauf.aufgabe_id);
  await laufSetzen(env.DB, lauf.id, 'laeuft', { meldung: 'Assistent schreibt die Antwort …' });

  if (!env.AI) throw new Error('Workers AI ist hier nicht verfügbar (nur in der Produktivumgebung).');
  const paket = await api<{ text: string }>('GET', `/api/aufgaben/${lauf.aufgabe_id}/paket?modus=${lauf.modus}`);
  let roh: unknown;
  try {
    roh = await (env.AI.run as unknown as KiAufruf)(env.KI_MODELL || STANDARD_MODELL, {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: paket.text },
      ],
      max_tokens: 2048,
    });
  } catch (e) {
    if (istKontingentErschoepft(e)) {
      const bis = naechsterReset();
      await api('POST', `/api/aufgaben/${lauf.aufgabe_id}/limit`, {
        bis,
        notiz: 'Tageskontingent von Workers AI aufgebraucht – geht nach 01:00 Uhr automatisch weiter.',
      });
      await laufSetzen(env.DB, lauf.id, 'limit', { meldung: `Tageskontingent aufgebraucht – automatische Fortsetzung ab ${bis}` });
      return;
    }
    throw e;
  }
  const antwort = typeof roh === 'string' ? roh : String((roh as { response?: unknown })?.response ?? '').trim();
  if (!antwort) throw new Error('Workers AI hat keine Antwort geliefert.');
  const r = await api<{ status: string; erkannt: { rueckfragen: boolean; freigabe: string | null } }>(
    'POST',
    `/api/aufgaben/${lauf.aufgabe_id}/ergebnis`,
    { text: antwort },
  );
  const teile = ['Ergebnis eingetragen'];
  if (r.erkannt.rueckfragen) teile.push('mit Rückfrage');
  if (r.erkannt.freigabe) teile.push(`Freigabe ${r.erkannt.freigabe} beantragt`);
  await laufSetzen(env.DB, lauf.id, 'fertig', { meldung: teile.join(' · ') });
}

// ------------------------------------------------------------------ Claude Code über GitHub Actions

async function zielRepo(env: Env, aufgabeId: string): Promise<{ repo: string; branch: string }> {
  const r = await env.DB.prepare(
    `SELECT g.full_name, g.standard_branch FROM github_repos g JOIN aufgaben a ON a.projekt_slug = g.projekt_slug WHERE a.id = ? LIMIT 1`,
  )
    .bind(aufgabeId)
    .first<{ full_name: string; standard_branch: string }>();
  if (r) return { repo: r.full_name, branch: r.standard_branch };
  return { repo: env.KI_ARBEITS_REPO || STANDARD_ARBEITS_REPO, branch: 'main' };
}

async function githubClaudeStarten(env: Env, lauf: LaufZeile): Promise<void> {
  const v = await verbindungLaden(env);
  if (v.status !== 'installiert') {
    throw new Error('GitHub ist nicht verbunden. Bitte unter Einstellungen → GitHub-Verbindung einrichten.');
  }
  const { repo, branch } = await zielRepo(env, lauf.aufgabe_id);
  const token = await installationsToken(env, v);
  const res = await githubFetch(`/repos/${repo}/actions/workflows/${WORKFLOW_DATEI}/dispatches`, {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: branch, inputs: { aufgabe: lauf.aufgabe_id, lauf: String(lauf.id), modus: lauf.modus } }),
  });
  if (res.status === 404) {
    throw new Error(`Im Repository ${repo} fehlt der Workflow .github/workflows/${WORKFLOW_DATEI} (Vorlage im Repository TE-Digital-Zentrale).`);
  }
  if (res.status === 403) {
    throw new Error('Die GitHub-App darf keine Workflows starten. Bitte in den App-Einstellungen das Recht „Actions: Read and write“ erteilen.');
  }
  if (!res.ok) throw new Error(`GitHub hat den Start abgelehnt (${res.status}).`);
  const api = await alsMitarbeiter(env, lauf.mitarbeiter_id);
  await inBearbeitung(env, api, lauf.aufgabe_id);
  await laufSetzen(env.DB, lauf.id, 'laeuft', {
    meldung: 'Auf GitHub gestartet – Claude meldet sich gleich.',
    repo,
    extern_url: `https://github.com/${repo}/actions/workflows/${WORKFLOW_DATEI}`,
  });
}

// ------------------------------------------------------------------ Abarbeiten (im Alarm)

/**
 * 1. hängengebliebene Läufe beenden, 2. nach Limit automatisch fortsetzen, 3. wartende Läufe starten.
 * Rückgabe: true, wenn noch wartende Läufe übrig sind.
 */
export async function laeufeAbarbeiten(env: Env, jetztDatum = new Date()): Promise<boolean> {
  const db = env.DB;
  const iso = jetztDatum.toISOString();

  // 1 – Zeitüberschreitung
  for (const art of Object.keys(ZEITLIMIT_MIN) as Automatik[]) {
    const grenze = new Date(jetztDatum.getTime() - ZEITLIMIT_MIN[art] * 60_000).toISOString();
    await db
      .prepare(
        `UPDATE ki_laeufe SET status = 'fehler', meldung = ?, beendet_am = ?, aktualisiert_am = ?
          WHERE status = 'laeuft' AND art = ? AND aktualisiert_am < ?`,
      )
      .bind('Keine Rückmeldung mehr – bitte erneut starten.', iso, iso, art, grenze)
      .run();
  }

  // 2 – nach abgelaufener Limit-Pause selbst weitermachen
  const fortsetzen = await db
    .prepare(
      `SELECT a.id FROM aufgaben a JOIN mitarbeiter m ON m.id = a.zustaendig_id
        WHERE a.status = 'wartend' AND m.automatik IS NOT NULL AND m.limit_bis IS NOT NULL AND m.limit_bis <= ?
          AND (SELECT l.status FROM ki_laeufe l WHERE l.aufgabe_id = a.id ORDER BY l.id DESC LIMIT 1) = 'limit'
        LIMIT 5`,
    )
    .bind(iso)
    .all<{ id: string }>();
  for (const { id } of fortsetzen.results) {
    try {
      await laufAnlegen(db, id, 'fortsetzung');
    } catch (e) {
      console.error('Fortsetzung', id, e);
    }
  }

  // 3 – wartende Läufe
  const wartend = await db
    .prepare(`SELECT * FROM ki_laeufe WHERE status = 'wartet' ORDER BY id LIMIT ?`)
    .bind(JE_ALARM + 1)
    .all<LaufZeile>();
  for (const lauf of wartend.results.slice(0, JE_ALARM)) {
    // Übernehmen (gegen doppelte Bearbeitung bei überlappenden Alarmen)
    const ok = await db
      .prepare(`UPDATE ki_laeufe SET status = 'laeuft', gestartet_am = ?, aktualisiert_am = ?, meldung = 'Wird gestartet …' WHERE id = ? AND status = 'wartet'`)
      .bind(iso, iso, lauf.id)
      .run();
    if (!ok.meta.changes) continue;
    try {
      if (lauf.art === 'workers_ai') await workersAiLauf(env, lauf);
      else await githubClaudeStarten(env, lauf);
    } catch (e) {
      console.error('Lauf', lauf.id, e);
      await laufSetzen(db, lauf.id, 'fehler', { meldung: e instanceof Error ? e.message : String(e) });
    }
    await aenderungMelden(env, lauf.aufgabe_id);
  }
  return wartend.results.length > JE_ALARM;
}

/** Geräte aktualisieren lassen (Pfad der Aufgabe → Detailansicht und Listen laden neu) */
export async function aenderungMelden(env: Env, aufgabeId: string): Promise<void> {
  const { liveSenden } = await import('../live');
  await liveSenden(env, { art: 'geaendert', pfad: `/api/aufgaben/${aufgabeId}` });
}
