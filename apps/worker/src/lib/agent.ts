/**
 * KI-Mitarbeiter als Akteure (MCP).
 * Der MCP-Server ruft die normalen API-Routen intern auf. Welcher Agent handelt, wird über eine
 * WeakMap am Request-Objekt übergeben – nie über Header, die von außen gefälscht werden könnten.
 * Agenten erhalten eine Pseudo-Sitzung mit Rolle 'agent': gfPflicht/stepUpPflicht lehnen sie ab,
 * nur ausdrücklich freigegebene Routen nutzen schreiberPflicht + Bereichsprüfung.
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { AgentKontext, AppEnv, SitzungsInfo } from '../env';
import { ApiFehler } from './fehler';

const intern = new WeakMap<Request, AgentKontext>();

export function alsAgent(req: Request, agent: AgentKontext): Request {
  intern.set(req, agent);
  return req;
}

export const agentLaden: MiddlewareHandler<AppEnv> = async (c, next) => {
  const a = intern.get(c.req.raw) ?? null;
  c.set('agent', a);
  if (a) {
    c.set('sitzung', {
      tokenHash: '',
      bestaetigtAm: null,
      benutzer: { id: `ma:${a.mitarbeiterId}`, name: `${a.rolle} (${a.name})`, rolle: 'agent' },
    });
  }
  await next();
};

/** Schreibrecht: Geschäftsführung oder KI-Mitarbeiter (mit anschließender Bereichsprüfung). */
export function schreiberPflicht(c: Context<AppEnv>): SitzungsInfo {
  const s = c.get('sitzung');
  if (!s) throw new ApiFehler(401, 'nicht_angemeldet', 'Bitte zuerst anmelden.');
  if (s.benutzer.rolle !== 'gf' && s.benutzer.rolle !== 'agent') throw new ApiFehler(403, 'keine_berechtigung', 'Keine Schreibrechte.');
  return s;
}

export function agentVon(c: Context<AppEnv>): AgentKontext | null {
  return c.get('agent') ?? null;
}

/** Projektbereich: Agenten sehen/ändern nur freigegebene Projekte. */
export function pruefeProjekt(c: Context<AppEnv>, projektSlug: string | null | undefined): void {
  const a = agentVon(c);
  if (!a || a.projekte === null) return;
  if (!projektSlug || !a.projekte.includes(projektSlug)) {
    throw new ApiFehler(403, 'projekt_gesperrt', 'Kein Zugriff auf dieses Projekt.');
  }
}

/** Agenten dürfen nur an eigenen Aufgaben arbeiten. */
export function pruefeEigeneAufgabe(c: Context<AppEnv>, aufgabe: { zustaendig_id: string | null; projekt_slug: string }): void {
  const a = agentVon(c);
  if (!a) return;
  pruefeProjekt(c, aufgabe.projekt_slug);
  if (aufgabe.zustaendig_id !== a.mitarbeiterId) {
    throw new ApiFehler(403, 'nicht_zustaendig', 'Diese Aufgabe ist einem anderen Mitarbeiter zugewiesen.');
  }
}
