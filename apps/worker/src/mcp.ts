/**
 * MCP-Server der TE-Digital Zentrale (Model Context Protocol, Streamable HTTP, zustandslos).
 *
 * Damit arbeiten Claude Code (lokal und in der Cloud) und Claude.ai direkt mit der Zentrale:
 * Aufgaben lesen, Zwischenstände und Ergebnisse melden, Freigaben beantragen – über das Claude-Abo,
 * ohne kostenpflichtige API. Die KI-Arbeit läuft beim Anbieter; dieser Server liefert nur Daten.
 *
 * Sicherheit
 * - Zugang per Bearer-Token je KI-Mitarbeiter (in der PWA erstellt, nur Hash gespeichert, widerrufbar),
 *   optional auf Projekte beschränkt.
 * - Schreibende Werkzeuge rufen die normalen API-Routen intern als dieser Mitarbeiter auf → dieselben
 *   Regeln wie in der PWA, plus: nur eigene Aufgaben, nie Freigaben erteilen, nie Rechte ändern.
 * - Origin-Prüfung gegen DNS-Rebinding; Protokoll im Audit (akteur_typ = mitarbeiter).
 */
import type { Hono } from 'hono';
import type { AgentKontext, AppEnv, Env } from './env';
import { alsAgent } from './lib/agent';
import { anschluss, gedrosselt } from './lib/drossel';
import { sha256Hex } from './lib/krypto';
import { branchVorschlag } from './lib/pfade';
import { jetzt } from './lib/zeit';

const PROTOKOLLE = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'te-digital-zentrale', title: 'TE-Digital Zentrale', version: '0.5.0' };

const ANLEITUNG =
  'Du arbeitest als KI-Mitarbeiter der TE-Digital AI Company. Ablauf: 1) meine_aufgaben, 2) aufgabe_lesen (enthält Rolle, Ziel, Regeln, Antwortformat), ' +
  '3) aufgabe_starten, 4) bei längerer Arbeit regelmäßig zwischenstand_speichern, 5) ergebnis_melden mit den Abschnitten ERGEBNIS, OFFENE FRAGEN, FREIGABEANTRÄGE, ZWISCHENSTAND. ' +
  'Bei Code: eigener Branch je Aufgabe (branch_melden), vor konfliktträchtigen Änderungen sperre_setzen. Merges in main, Veröffentlichungen, Kosten, Löschungen, ' +
  'Sicherheits- und Rechteänderungen sind Stufe 3: nur per freigabe_beantragen, nie selbst ausführen. Ist dein Nutzungslimit erreicht: limit_melden mit Zwischenstand.';

// ------------------------------------------------------------------ Werkzeuge

interface Werkzeug {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
}

const id = { type: 'string', pattern: '^TD-\\d{4,}$', description: 'Aufgabennummer, z. B. TD-0007' };

const WERKZEUGE: Werkzeug[] = [
  {
    name: 'meine_aufgaben',
    title: 'Meine Aufgaben',
    description: 'Listet die offenen Aufgaben, die dir zugewiesen sind (mit Status, Priorität, Projekt).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'aufgabe_lesen',
    title: 'Aufgabe lesen (Übergabepaket)',
    description:
      'Liefert das Übergabepaket einer Aufgabe: Rolle, Entscheidungsrahmen, Ziel, Ausgangslage, Dateien, Akzeptanzkriterien, letzter Zwischenstand, Entscheidungen, Antwortformat. ' +
      'modus „fortsetzung“ liefert die Kurzfassung ab dem letzten Zwischenstand.',
    inputSchema: { type: 'object', properties: { id, modus: { type: 'string', enum: ['voll', 'fortsetzung'] } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'projekt_kontext',
    title: 'Projektkontext',
    description: 'Beschreibung, Ziele, Technik, Repository und die letzten Entscheidungen eines Projekts.',
    inputSchema: { type: 'object', properties: { projekt: { type: 'string', description: 'Projekt-Kürzel, z. B. orchester' } }, required: ['projekt'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'nachrichten_lesen',
    title: 'Nachrichten lesen',
    description: 'Die letzten Nachrichten an dich oder zu einer deiner Aufgaben (z. B. Antworten der Geschäftsführung auf Rückfragen).',
    inputSchema: { type: 'object', properties: { aufgabe_id: id }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'aufgabe_starten',
    title: 'Aufgabe starten',
    description: 'Setzt eine eigene Aufgabe auf „in Bearbeitung“ (nur wenn alle Abhängigkeiten erledigt sind). Liefert einen Branch-Vorschlag.',
    inputSchema: { type: 'object', properties: { id }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'status_melden',
    title: 'Status melden',
    description: 'Meldet den Arbeitsstatus einer eigenen Aufgabe: in_bearbeitung, pruefung, blockiert oder wartend. Mit grund wird zusätzlich ein Zwischenstand gespeichert.',
    inputSchema: {
      type: 'object',
      properties: { id, status: { type: 'string', enum: ['in_bearbeitung', 'pruefung', 'blockiert', 'wartend'] }, grund: { type: 'string', maxLength: 4000 } },
      required: ['id', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'zwischenstand_speichern',
    title: 'Zwischenstand speichern',
    description: 'Speichert einen Checkpoint (2–5 Sätze: was erledigt ist, was als Nächstes kommt), damit nach einer Unterbrechung nahtlos weitergearbeitet werden kann.',
    inputSchema: {
      type: 'object',
      properties: { id, zusammenfassung: { type: 'string', minLength: 3, maxLength: 8000 }, naechste_schritte: { type: 'string', maxLength: 4000 } },
      required: ['id', 'zusammenfassung'],
      additionalProperties: false,
    },
  },
  {
    name: 'ergebnis_melden',
    title: 'Ergebnis melden',
    description:
      'Meldet das Ergebnis einer eigenen Aufgabe. Text mit den Abschnitten ERGEBNIS, OFFENE FRAGEN, FREIGABEANTRÄGE, ZWISCHENSTAND – sie werden automatisch zugeordnet ' +
      '(Rückfragen gehen an die Geschäftsführung, Freigabeanträge werden angelegt). Die Aufgabe geht danach in Prüfung.',
    inputSchema: { type: 'object', properties: { id, text: { type: 'string', minLength: 1, maxLength: 100000 } }, required: ['id', 'text'], additionalProperties: false },
  },
  {
    name: 'limit_melden',
    title: 'Nutzungslimit melden',
    description: 'Dein Nutzungslimit ist erreicht: Aufgabe sicher pausieren. notiz = letzter Arbeitsstand. bis = ISO-Zeitpunkt, ab wann wieder verfügbar (sonst 3 Std.).',
    inputSchema: {
      type: 'object',
      properties: { id, bis: { type: 'string', format: 'date-time' }, notiz: { type: 'string', maxLength: 4000 } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'branch_melden',
    title: 'Branch / Pull Request melden',
    description: 'Hinterlegt Branch (Konvention aufgabe/td-0007-kurztitel) und optional die Pull-Request-Adresse an einer eigenen Aufgabe.',
    inputSchema: {
      type: 'object',
      properties: { id, branch: { type: 'string', maxLength: 200 }, pr_url: { type: 'string', maxLength: 300 } },
      required: ['id', 'branch'],
      additionalProperties: false,
    },
  },
  {
    name: 'sperre_setzen',
    title: 'Dateien sperren',
    description: 'Sperrt Pfade eines Repositorys exklusiv für eine eigene Aufgabe (z. B. ["worker/src/auth.js", "web/**"]). Schlägt fehl, wenn eine andere Aufgabe überlappende Pfade gesperrt hat.',
    inputSchema: {
      type: 'object',
      properties: {
        aufgabe_id: id,
        repo: { type: 'string', description: 'Organisation/Name, z. B. TE-Tools/orchester-orga' },
        pfade: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30 },
        grund: { type: 'string', maxLength: 500 },
      },
      required: ['aufgabe_id', 'repo', 'pfade'],
      additionalProperties: false,
    },
  },
  {
    name: 'sperre_freigeben',
    title: 'Sperre freigeben',
    description: 'Gibt eine eigene Sperre wieder frei (Nummer aus sperre_setzen).',
    inputSchema: { type: 'object', properties: { sperre_id: { type: 'integer' } }, required: ['sperre_id'], additionalProperties: false },
  },
  {
    name: 'nachricht_senden',
    title: 'Nachricht senden',
    description: 'Legt eine Nachricht in der zentralen Kommunikation ab (an: gf = Geschäftsführung, oder Mitarbeiter-ID wie projektleitung, qualitaet).',
    inputSchema: {
      type: 'object',
      properties: {
        art: { type: 'string', enum: ['rueckfrage', 'technische_empfehlung', 'warnung', 'entscheidungsvorschlag', 'pruefbericht', 'eskalation', 'information'] },
        an: { type: 'string' },
        aufgabe_id: id,
        inhalt: { type: 'string', minLength: 1, maxLength: 50000 },
      },
      required: ['art', 'inhalt'],
      additionalProperties: false,
    },
  },
  {
    name: 'freigabe_beantragen',
    title: 'Freigabe beantragen (Stufe 3)',
    description: 'Beantragt eine Freigabe der Geschäftsführung (Kosten, Veröffentlichung, Produktivsetzung, Löschung, Sicherheit, Vertrag). Die Aufgabe wird bis zur Entscheidung angehalten.',
    inputSchema: {
      type: 'object',
      properties: {
        typ: { type: 'string', enum: ['kosten', 'veroeffentlichung', 'produktiv', 'loeschung', 'sicherheit', 'vertrag', 'sonstiges'] },
        titel: { type: 'string', minLength: 3, maxLength: 160 },
        begruendung: { type: 'string', maxLength: 8000 },
        aufgabe_id: id,
        dringend: { type: 'boolean' },
      },
      required: ['typ', 'titel'],
      additionalProperties: false,
    },
  },
  {
    name: 'entscheidung_dokumentieren',
    title: 'Entscheidung dokumentieren',
    description: 'Dokumentiert eine Entscheidung der Stufe 1 (selbstständig) oder 2 (mit Informationspflicht – Projektleitung und Geschäftsführung werden benachrichtigt).',
    inputSchema: {
      type: 'object',
      properties: {
        stufe: { type: 'integer', enum: [1, 2] },
        titel: { type: 'string', minLength: 3, maxLength: 200 },
        begruendung: { type: 'string', maxLength: 8000 },
        alternativen: { type: 'string', maxLength: 4000 },
        aufgabe_id: id,
        projekt: { type: 'string' },
      },
      required: ['stufe', 'titel'],
      additionalProperties: false,
    },
  },
  {
    name: 'wissen_suchen',
    title: 'Unternehmenswissen durchsuchen',
    description: 'Sucht im Unternehmens- und Projektwissen (Titel, Kurzfassung, Inhalt, Stichworte). Liefert Nummer, Titel und Kurzfassung.',
    inputSchema: {
      type: 'object',
      properties: { suche: { type: 'string', minLength: 2, maxLength: 80 }, projekt: { type: 'string' } },
      required: ['suche'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'wissen_lesen',
    title: 'Wissensartikel lesen',
    description: 'Liefert einen Wissensartikel vollständig (Nummer z. B. aus dem Übergabepaket: W12 → 12).',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'wissen_speichern',
    title: 'Wissen festhalten',
    description:
      'Legt einen Wissensartikel an oder aktualisiert ihn (mit id). Für Projektwissen, Anleitungen, technische Zusammenfassungen und Architekturentscheidungen. ' +
      'Die Kurzfassung (max. 500 Zeichen) fließt in künftige Übergabepakete ein. Firmenregeln und Rollen ändert nur die Geschäftsführung.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        titel: { type: 'string', minLength: 3, maxLength: 160 },
        kategorie: { type: 'string', enum: ['anleitung', 'architektur', 'technik', 'entscheidung', 'zusammenfassung', 'sonstiges'] },
        projekt: { type: 'string', description: 'Projekt-Kürzel; leer = unternehmensweit' },
        zusammenfassung: { type: 'string', maxLength: 500 },
        inhalt: { type: 'string', maxLength: 60000 },
        tags: { type: 'string', maxLength: 200 },
      },
      required: ['titel', 'zusammenfassung', 'inhalt'],
      additionalProperties: false,
    },
  },
];

// ------------------------------------------------------------------ Hilfen

type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };
type Antwort = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

class WerkzeugFehler extends Error {}

function text(t: string, struktur?: unknown) {
  return { content: [{ type: 'text', text: t }], ...(struktur !== undefined ? { structuredContent: struktur } : {}) };
}

export async function agentAusToken(env: Env, auth: string | undefined): Promise<AgentKontext | null> {
  const m = auth?.match(/^Bearer\s+(tez_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const hash = await sha256Hex(m[1]!);
  const z = await env.DB.prepare(
    `SELECT k.id, k.mitarbeiter_id, k.projekte, k.zuletzt_am, m.name, m.rolle
       FROM ki_zugaenge k JOIN mitarbeiter m ON m.id = k.mitarbeiter_id
      WHERE k.token_hash = ? AND k.widerrufen_am IS NULL AND m.aktiv = 1`,
  )
    .bind(hash)
    .first<{ id: number; mitarbeiter_id: string; projekte: string | null; zuletzt_am: string | null; name: string; rolle: string }>();
  if (!z) return null;
  // „Zuletzt benutzt“ höchstens alle 5 Minuten schreiben (D1-Schreibkontingent sparen)
  if (!z.zuletzt_am || Date.now() - Date.parse(z.zuletzt_am) > 300_000) {
    await env.DB.prepare('UPDATE ki_zugaenge SET zuletzt_am = ? WHERE id = ?').bind(jetzt(), z.id).run();
  }
  return {
    zugangId: z.id,
    mitarbeiterId: z.mitarbeiter_id,
    name: z.name,
    rolle: z.rolle,
    projekte: z.projekte ? (JSON.parse(z.projekte) as string[]) : null,
  };
}

// ------------------------------------------------------------------ Server

export async function mcpBehandeln(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  app: Hono<AppEnv>,
): Promise<Response> {
  const kopf = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const origin = request.headers.get('origin');
  const eigene = new URL(request.url).origin;
  const erlaubt = [eigene, ...env.ERLAUBTE_ORIGINS.split(',').map((o) => o.trim()), 'https://claude.ai'];
  if (origin && !erlaubt.includes(origin)) return new Response('Origin nicht erlaubt', { status: 403, headers: kopf });

  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...kopf, Allow: 'POST' } });
  }
  if (await gedrosselt(env, 'RL_MCP', anschluss(request))) {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Zu viele Anfragen – bitte kurz warten.' } },
      { status: 429, headers: { ...kopf, 'Retry-After': '60' } },
    );
  }
  const agent = await agentAusToken(env, request.headers.get('authorization') ?? undefined);
  if (!agent) {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Kein gültiges Zugangstoken (in der Zentrale unter Einstellungen → KI-Zugänge erstellen).' } },
      { status: 401, headers: { ...kopf, 'WWW-Authenticate': 'Bearer realm="TE-Digital Zentrale"' } },
    );
  }

  let eingang: JsonRpc | JsonRpc[];
  try {
    eingang = (await request.json()) as JsonRpc | JsonRpc[];
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Ungültiges JSON' } }, { status: 400, headers: kopf });
  }
  const liste = Array.isArray(eingang) ? eingang : [eingang];
  const antworten: Antwort[] = [];
  for (const nachricht of liste) {
    const a = await einzeln(nachricht, agent, request, env, ctx, app);
    if (a) antworten.push(a);
  }
  if (antworten.length === 0) return new Response(null, { status: 202, headers: kopf });
  return Response.json(Array.isArray(eingang) ? antworten : antworten[0], { headers: kopf });
}

async function einzeln(
  n: JsonRpc,
  agent: AgentKontext,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  app: Hono<AppEnv>,
): Promise<Antwort | null> {
  const istAnfrage = n && typeof n === 'object' && 'id' in n && n.id !== undefined;
  if (!n || n.jsonrpc !== '2.0' || typeof n.method !== 'string') {
    return { jsonrpc: '2.0', id: istAnfrage ? (n.id ?? null) : null, error: { code: -32600, message: 'Ungültige Anfrage' } };
  }
  if (!istAnfrage) return null; // Benachrichtigungen (z. B. notifications/initialized) brauchen keine Antwort
  const antwort = (result: unknown): Antwort => ({ jsonrpc: '2.0', id: n.id ?? null, result });
  const fehler = (code: number, message: string): Antwort => ({ jsonrpc: '2.0', id: n.id ?? null, error: { code, message } });

  switch (n.method) {
    case 'initialize': {
      const gewuenscht = String(n.params?.protocolVersion ?? '');
      return antwort({
        protocolVersion: PROTOKOLLE.includes(gewuenscht) ? gewuenscht : PROTOKOLLE[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: `${ANLEITUNG} Du bist: ${agent.rolle} (${agent.name}).`,
      });
    }
    case 'ping':
      return antwort({});
    case 'tools/list':
      return antwort({ tools: WERKZEUGE });
    case 'tools/call': {
      const name = String(n.params?.name ?? '');
      const args = (n.params?.arguments ?? {}) as Record<string, unknown>;
      if (!WERKZEUGE.some((w) => w.name === name)) return fehler(-32602, `Unbekanntes Werkzeug: ${name}`);
      try {
        return antwort(await werkzeugAusfuehren(name, args, agent, request, env, ctx, app));
      } catch (e) {
        // Fachliche Fehler als Werkzeug-Ergebnis zurückgeben, damit das Modell reagieren kann
        return antwort({ ...text(e instanceof Error ? e.message : String(e)), isError: true });
      }
    }
    default:
      return fehler(-32601, `Methode nicht unterstützt: ${n.method}`);
  }
}

/** Interner Aufruf einer API-Route als dieser KI-Mitarbeiter. */
async function intern<T = Record<string, unknown>>(
  app: Hono<AppEnv>,
  env: Env,
  ctx: ExecutionContext,
  basis: string,
  agent: AgentKontext,
  methode: string,
  pfad: string,
  body?: unknown,
): Promise<T> {
  const req = new Request(basis + pfad, {
    method: methode,
    headers: { 'content-type': 'application/json', 'x-te-anfrage': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await app.fetch(alsAgent(req, agent), env, ctx);
  const daten = (await res.json().catch(() => ({}))) as T & { fehler?: { meldung: string; details?: unknown } };
  if (!res.ok) {
    const d = daten.fehler?.details;
    throw new WerkzeugFehler(`${daten.fehler?.meldung ?? `Fehler ${res.status}`}${Array.isArray(d) && d.length ? ' ' + JSON.stringify(d) : ''}`);
  }
  return daten;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function version(env: Env, id: string): Promise<number> {
  const r = await env.DB.prepare('SELECT version FROM aufgaben WHERE id = ?').bind(id).first<{ version: number }>();
  if (!r) throw new WerkzeugFehler(`Aufgabe ${id} nicht gefunden.`);
  return r.version;
}

async function werkzeugAusfuehren(
  name: string,
  args: Record<string, unknown>,
  agent: AgentKontext,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  app: Hono<AppEnv>,
) {
  const basis = new URL(request.url).origin;
  const api = <T = Record<string, unknown>>(m: string, p: string, b?: unknown) => intern<T>(app, env, ctx, basis, agent, m, p, b);
  const db = env.DB;
  const projektFilter = agent.projekte ? `AND a.projekt_slug IN (${agent.projekte.map(() => '?').join(',')})` : '';

  switch (name) {
    case 'meine_aufgaben': {
      const r = await db
        .prepare(
          `SELECT a.id, a.titel, a.status, a.prioritaet, a.projekt_slug, p.name AS projekt, a.branch, a.aktualisiert_am,
                  (SELECT COUNT(*) FROM aufgaben_abhaengigkeiten d JOIN aufgaben b ON b.id = d.haengt_ab_von WHERE d.aufgabe_id = a.id AND b.status <> 'abgeschlossen') AS offene_abhaengigkeiten
             FROM aufgaben a JOIN projekte p ON p.slug = a.projekt_slug
            WHERE a.zustaendig_id = ? AND a.status NOT IN ('abgeschlossen','abgebrochen') ${projektFilter}
            ORDER BY CASE a.prioritaet WHEN 'kritisch' THEN 0 WHEN 'hoch' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, a.aktualisiert_am DESC`,
        )
        .bind(agent.mitarbeiterId, ...(agent.projekte ?? []))
        .all<{ id: string; titel: string; status: string; prioritaet: string; projekt: string; offene_abhaengigkeiten: number }>();
      const zeilen = r.results.map(
        (a) => `- ${a.id} [${a.status}, ${a.prioritaet}] ${a.titel} (${a.projekt})${a.offene_abhaengigkeiten ? ` – wartet auf ${a.offene_abhaengigkeiten} Abhängigkeit(en)` : ''}`,
      );
      return text(zeilen.length ? `Offene Aufgaben für ${agent.rolle}:\n${zeilen.join('\n')}` : 'Keine offenen Aufgaben.', { aufgaben: r.results });
    }
    case 'aufgabe_lesen': {
      const modus = args.modus === 'fortsetzung' ? 'fortsetzung' : 'voll';
      const p = await api<{ text: string; warnungen: string[] }>('GET', `/api/aufgaben/${str(args.id)}/paket?modus=${modus}`);
      return text(p.text);
    }
    case 'projekt_kontext': {
      const slug = str(args.projekt);
      if (agent.projekte && !agent.projekte.includes(slug)) throw new WerkzeugFehler('Kein Zugriff auf dieses Projekt.');
      const [p, ent, repo] = await db.batch([
        db.prepare('SELECT name, kurz, beschreibung, ziele, repo_url, website_url, hosting, stack, status FROM projekte WHERE slug = ?').bind(slug),
        db.prepare('SELECT id, stufe, titel, zeit FROM entscheidungen WHERE projekt_slug = ? ORDER BY zeit DESC LIMIT 8').bind(slug),
        db.prepare('SELECT full_name, standard_branch FROM github_repos WHERE projekt_slug = ?').bind(slug),
      ]);
      const pr = p?.results[0] as Record<string, string> | undefined;
      if (!pr) throw new WerkzeugFehler('Projekt nicht gefunden.');
      const teile = [
        `# ${pr.name} – ${pr.kurz}`,
        pr.beschreibung,
        pr.ziele && `## Ziele\n${pr.ziele}`,
        `## Technik\nStack: ${pr.stack || '–'}\nHosting: ${pr.hosting || '–'}\nRepository: ${pr.repo_url || '–'}\nWebsite: ${pr.website_url || '–'}`,
        (repo?.results.length ?? 0) > 0 && `Verbundene Repos: ${(repo!.results as { full_name: string; standard_branch: string }[]).map((r) => `${r.full_name} (${r.standard_branch})`).join(', ')}`,
        (ent?.results.length ?? 0) > 0 &&
          `## Letzte Entscheidungen\n${(ent!.results as { id: string; stufe: number; titel: string }[]).map((e) => `- ${e.id} (Stufe ${e.stufe}): ${e.titel}`).join('\n')}`,
      ];
      return text(teile.filter(Boolean).join('\n\n'));
    }
    case 'nachrichten_lesen': {
      const aufgabe = str(args.aufgabe_id);
      const r = await db
        .prepare(
          `SELECT n.id, n.art, n.von, n.an, n.aufgabe_id, n.inhalt, n.zeit FROM nachrichten n LEFT JOIN aufgaben a ON a.id = n.aufgabe_id
            WHERE ${aufgabe ? 'n.aufgabe_id = ? AND a.zustaendig_id = ?' : '(n.an = ? OR (a.zustaendig_id = ? AND n.von = \'gf\'))'}
            ORDER BY n.zeit DESC LIMIT 20`,
        )
        .bind(...(aufgabe ? [aufgabe, agent.mitarbeiterId] : [agent.mitarbeiterId, agent.mitarbeiterId]))
        .all<{ art: string; von: string; an: string | null; aufgabe_id: string | null; inhalt: string; zeit: string }>();
      if (!r.results.length) return text('Keine Nachrichten.');
      return text(
        r.results
          .reverse()
          .map((m) => `[${m.zeit.slice(0, 16).replace('T', ' ')}] ${m.von} → ${m.an ?? 'alle'} (${m.art}${m.aufgabe_id ? `, ${m.aufgabe_id}` : ''}):\n${m.inhalt}`)
          .join('\n\n'),
      );
    }
    case 'aufgabe_starten': {
      const aid = str(args.id);
      await api('PATCH', `/api/aufgaben/${aid}`, { version: await version(env, aid), status: 'in_bearbeitung' });
      const a = await db.prepare('SELECT titel, branch FROM aufgaben WHERE id = ?').bind(aid).first<{ titel: string; branch: string | null }>();
      return text(`${aid} ist in Bearbeitung. Branch: ${a?.branch ?? branchVorschlag(aid, a?.titel ?? '')} (bitte mit branch_melden bestätigen).`);
    }
    case 'status_melden': {
      const aid = str(args.id);
      if (str(args.grund)) await api('POST', `/api/aufgaben/${aid}/checkpoint`, { zusammenfassung: str(args.grund) });
      await api('PATCH', `/api/aufgaben/${aid}`, { version: await version(env, aid), status: str(args.status) });
      return text(`Status von ${aid}: ${str(args.status)}.`);
    }
    case 'zwischenstand_speichern': {
      await api('POST', `/api/aufgaben/${str(args.id)}/checkpoint`, { zusammenfassung: str(args.zusammenfassung), naechste_schritte: str(args.naechste_schritte) });
      return text('Zwischenstand gespeichert.');
    }
    case 'ergebnis_melden': {
      const r = await api<{ status: string; erkannt: Record<string, unknown> }>('POST', `/api/aufgaben/${str(args.id)}/ergebnis`, { text: str(args.text) });
      return text(`Ergebnis gespeichert, Status jetzt „${r.status}“. Erkannt: ${JSON.stringify(r.erkannt)}`, r);
    }
    case 'limit_melden': {
      const r = await api<{ bis: string }>('POST', `/api/aufgaben/${str(args.id)}/limit`, { ...(args.bis ? { bis: str(args.bis) } : {}), notiz: str(args.notiz) });
      return text(`Pausiert bis ${r.bis}. Die Geschäftsführung wird erinnert, wenn es weitergehen kann.`);
    }
    case 'branch_melden': {
      const aid = str(args.id);
      const branch = str(args.branch);
      if (!/^[\w./-]{3,200}$/.test(branch)) throw new WerkzeugFehler('Ungültiger Branch-Name.');
      await api('PATCH', `/api/aufgaben/${aid}`, { version: await version(env, aid), branch, ...(args.pr_url ? { pr_url: str(args.pr_url) } : {}) });
      return text(`Branch ${branch} an ${aid} hinterlegt.`);
    }
    case 'sperre_setzen': {
      const r = await api<{ id: number }>('POST', '/api/sperren', { aufgabe_id: str(args.aufgabe_id), repo: str(args.repo), pfade: args.pfade, grund: str(args.grund) });
      return text(`Sperre ${r.id} gesetzt.`, r);
    }
    case 'sperre_freigeben': {
      await api('POST', `/api/sperren/${Number(args.sperre_id)}/freigeben`, {});
      return text('Sperre freigegeben.');
    }
    case 'nachricht_senden': {
      await api('POST', '/api/nachrichten', { art: str(args.art), an: str(args.an) || 'gf', aufgabe_id: str(args.aufgabe_id) || null, inhalt: str(args.inhalt) });
      return text('Nachricht gespeichert.');
    }
    case 'freigabe_beantragen': {
      const r = await api<{ id: string }>('POST', '/api/freigaben', {
        typ: str(args.typ),
        titel: str(args.titel),
        begruendung: str(args.begruendung),
        aufgabe_id: str(args.aufgabe_id) || null,
        dringend: args.dringend === true,
      });
      return text(`Freigabe ${r.id} beantragt. Bis zur Entscheidung der Geschäftsführung nichts davon ausführen.`, r);
    }
    case 'entscheidung_dokumentieren': {
      const r = await api<{ id: string }>('POST', '/api/entscheidungen', {
        stufe: Number(args.stufe),
        titel: str(args.titel),
        begruendung: str(args.begruendung),
        alternativen: str(args.alternativen),
        aufgabe_id: str(args.aufgabe_id) || null,
        projekt_slug: str(args.projekt) || null,
      });
      return text(`Entscheidung ${r.id} dokumentiert.`, r);
    }
    case 'wissen_suchen': {
      const q = new URLSearchParams({ suche: str(args.suche) });
      if (str(args.projekt)) q.set('projekt', str(args.projekt));
      const r = await api<{ wissen: { id: number; titel: string; zusammenfassung: string; projekt_slug: string | null }[] }>('GET', `/api/wissen?${q}`);
      if (!r.wissen.length) return text('Nichts gefunden.');
      return text(r.wissen.slice(0, 15).map((w) => `- W${w.id} ${w.titel}${w.projekt_slug ? ` (${w.projekt_slug})` : ''}: ${w.zusammenfassung}`).join('\n'));
    }
    case 'wissen_lesen': {
      const r = await api<{ wissen: { id: number; titel: string; inhalt: string; version: number; aktualisiert_am: string } }>('GET', `/api/wissen/${Number(args.id)}`);
      return text(`# W${r.wissen.id} ${r.wissen.titel} (Version ${r.wissen.version}, ${r.wissen.aktualisiert_am.slice(0, 10)})\n\n${r.wissen.inhalt}`);
    }
    case 'wissen_speichern': {
      const felder = {
        titel: str(args.titel),
        zusammenfassung: str(args.zusammenfassung),
        inhalt: str(args.inhalt),
        ...(args.kategorie ? { kategorie: str(args.kategorie) } : {}),
        ...(args.tags !== undefined ? { tags: str(args.tags) } : {}),
      };
      if (args.id !== undefined) {
        const alt = await api<{ wissen: { version: number } }>('GET', `/api/wissen/${Number(args.id)}`);
        const r = await api<{ version: number }>('PATCH', `/api/wissen/${Number(args.id)}`, { ...felder, version: alt.wissen.version });
        return text(`W${Number(args.id)} aktualisiert (Version ${r.version}).`);
      }
      const r = await api<{ id: number }>('POST', '/api/wissen', {
        kategorie: 'technik',
        ...felder,
        projekt_slug: str(args.projekt) || null,
      });
      return text(`Wissensartikel W${r.id} angelegt.`);
    }
  }
  throw new WerkzeugFehler('Unbekanntes Werkzeug.');
}
