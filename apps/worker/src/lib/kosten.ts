/**
 * Kostenwächter (Pflichtenheft 13, Plan Kap. 11 / 4.1).
 * Liest die Tagesnutzung des Cloudflare-Kontos über die GraphQL-Analytics-API (kostenlos, Token nur mit
 * „Account Analytics: Lesen“) und vergleicht sie mit den Grenzen des Free-Tarifs. Das Konto wird mit den
 * anderen TE-Apps geteilt – gemessen wird daher die Gesamtnutzung.
 *
 * Im Free-Tarif entstehen beim Überschreiten keine Kosten (Anfragen schlagen fehl); gewarnt wird ab 80 %
 * (wichtig) und 95 % (kritisch). Ab 70 % der Worker-Anfragen schaltet die Zentrale in den Sparmodus.
 */
import type { Env } from '../env';
import { jetzt } from './zeit';

export const GRENZEN = [
  { dienst: 'workers', metrik: 'anfragen', grenze: 100_000, text: 'Worker-Anfragen pro Tag' },
  { dienst: 'd1', metrik: 'zeilen_gelesen', grenze: 5_000_000, text: 'D1: gelesene Zeilen pro Tag' },
  { dienst: 'd1', metrik: 'zeilen_geschrieben', grenze: 100_000, text: 'D1: geschriebene Zeilen pro Tag' },
  { dienst: 'durable_objects', metrik: 'anfragen', grenze: 100_000, text: 'Durable Objects: Anfragen pro Tag' },
] as const;

export const SPARMODUS_AB = 0.7;

const ABFRAGE = `query Nutzung($konto: string!, $start: Time!, $ende: Time!, $tag: Date!) {
  viewer {
    accounts(filter: { accountTag: $konto }) {
      workers: workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $ende }) { sum { requests } }
      d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $tag, date_leq: $tag }) { sum { rowsRead rowsWritten } }
      dos: durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: { date_geq: $tag, date_leq: $tag }) { sum { requests } }
    }
  }
}`;

export interface Messung {
  dienst: string;
  metrik: string;
  wert: number;
  grenze: number;
}

type Summe<T> = { sum: T }[] | undefined;

/** Pure Auswertung der GraphQL-Antwort (testbar ohne Netz). */
export function auswerten(daten: unknown): Messung[] {
  const konto = (daten as { data?: { viewer?: { accounts?: unknown[] } } })?.data?.viewer?.accounts?.[0] as
    | { workers: Summe<{ requests: number }>; d1: Summe<{ rowsRead: number; rowsWritten: number }>; dos: Summe<{ requests: number }> }
    | undefined;
  if (!konto) throw new Error('Antwort ohne Kontodaten (Konto-ID oder Token-Recht prüfen).');
  const summe = <T>(liste: Summe<T>, f: (x: T) => number) => (liste ?? []).reduce((n, x) => n + (f(x.sum) || 0), 0);
  const werte: Record<string, number> = {
    'workers.anfragen': summe(konto.workers, (s) => s.requests),
    'd1.zeilen_gelesen': summe(konto.d1, (s) => s.rowsRead),
    'd1.zeilen_geschrieben': summe(konto.d1, (s) => s.rowsWritten),
    'durable_objects.anfragen': summe(konto.dos, (s) => s.requests),
  };
  return GRENZEN.map((g) => ({ dienst: g.dienst, metrik: g.metrik, grenze: g.grenze, wert: werte[`${g.dienst}.${g.metrik}`] ?? 0 }));
}

export function eingerichtet(env: Env): boolean {
  return !!(env.CF_ACCOUNT_ID && env.CF_ANALYTICS_TOKEN);
}

/** Misst die heutige Nutzung (UTC-Tag – die Free-Grenzen gelten ab 00:00 UTC) und speichert sie. */
export async function messen(env: Env, d: Date = new Date()): Promise<Messung[]> {
  if (!eingerichtet(env)) throw new Error('Kostenwächter nicht eingerichtet (CF_ACCOUNT_ID / CF_ANALYTICS_TOKEN fehlen).');
  const tag = d.toISOString().slice(0, 10);
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: ABFRAGE, variables: { konto: env.CF_ACCOUNT_ID, start: `${tag}T00:00:00Z`, ende: d.toISOString(), tag } }),
    });
    const json = (await r.json()) as { errors?: { message: string }[] | null };
    if (!r.ok || json.errors?.length) throw new Error(json.errors?.map((e) => e.message).join('; ') || `HTTP ${r.status}`);
    const messungen = auswerten(json);
    await env.DB.batch([
      ...messungen.map((m) =>
        env.DB.prepare(
          `INSERT INTO kosten_messwerte (datum, dienst, metrik, wert, grenze) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(datum, dienst, metrik) DO UPDATE SET wert = excluded.wert, grenze = excluded.grenze, erfasst_am = excluded.erfasst_am`,
        ).bind(tag, m.dienst, m.metrik, m.wert, m.grenze),
      ),
      env.DB.prepare(`INSERT INTO system_schluessel (name, wert) VALUES ('kosten_fehler', '') ON CONFLICT(name) DO UPDATE SET wert = ''`),
      env.DB.prepare(
        `INSERT INTO system_schluessel (name, wert) VALUES ('sparmodus', ?) ON CONFLICT(name) DO UPDATE SET wert = excluded.wert`,
      ).bind(messungen.some((m) => m.dienst === 'workers' && m.wert / m.grenze >= SPARMODUS_AB) ? tag : ''),
    ]);
    return messungen;
  } catch (e) {
    await env.DB.prepare(`INSERT INTO system_schluessel (name, wert) VALUES ('kosten_fehler', ?) ON CONFLICT(name) DO UPDATE SET wert = excluded.wert`)
      .bind(`${jetzt()} ${(e as Error).message}`.slice(0, 400))
      .run();
    throw e;
  }
}

/** Sparmodus gilt nur für den UTC-Tag, an dem er ausgelöst wurde. */
export async function sparmodusAktiv(env: Env, d: Date = new Date()): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT wert FROM system_schluessel WHERE name = 'sparmodus'`).first<{ wert: string }>();
  return r?.wert === d.toISOString().slice(0, 10);
}

export function warnstufe(m: Messung): 'ok' | 'wichtig' | 'kritisch' {
  const anteil = m.wert / m.grenze;
  return anteil >= 0.95 ? 'kritisch' : anteil >= 0.8 ? 'wichtig' : 'ok';
}
