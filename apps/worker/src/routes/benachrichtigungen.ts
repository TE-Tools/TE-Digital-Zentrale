import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { body } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import { anGeraeteSenden, basisUrl, einstellungenLaden, melden, type Meldung } from '../lib/melden';
import { sitzungPflicht } from '../lib/sitzung';
import { vapidSchluessel } from '../lib/webpush';
import { jetzt } from '../lib/zeit';

const benachrichtigungen = new Hono<AppEnv>();

/** Für Routen: Meldung anlegen, Push im Hintergrund (waitUntil) versenden. */
export async function meldenAusRoute(c: Context<AppEnv>, m: Meldung): Promise<void> {
  const { versand: arbeit } = await melden(c.env, m, c.get('sitzung')?.benutzer.id ?? null, basisUrl(c.env, c.req.url));
  try {
    c.executionCtx.waitUntil(arbeit);
  } catch {
    await arbeit; // ohne ExecutionContext (z. B. in Tests) direkt abwarten
  }
}

benachrichtigungen.get('/', async (c) => {
  const s = sitzungPflicht(c);
  const db = c.env.DB;
  const [liste, zahl] = await db.batch([
    db.prepare('SELECT * FROM benachrichtigungen WHERE benutzer_id = ? ORDER BY erstellt_am DESC, id DESC LIMIT 100').bind(s.benutzer.id),
    db.prepare('SELECT COUNT(*) AS n FROM benachrichtigungen WHERE benutzer_id = ? AND gelesen_am IS NULL').bind(s.benutzer.id),
  ]);
  return c.json({ benachrichtigungen: liste?.results ?? [], ungelesen: (zahl?.results[0] as { n: number } | undefined)?.n ?? 0 });
});

benachrichtigungen.post('/gelesen', async (c) => {
  const s = sitzungPflicht(c);
  const { ids } = await body(c, z.object({ ids: z.array(z.number().int()).max(500).optional() }));
  const db = c.env.DB;
  if (ids?.length) {
    await db
      .prepare(`UPDATE benachrichtigungen SET gelesen_am = ? WHERE benutzer_id = ? AND gelesen_am IS NULL AND id IN (${ids.map(() => '?').join(',')})`)
      .bind(jetzt(), s.benutzer.id, ...ids)
      .run();
  } else {
    await db.prepare('UPDATE benachrichtigungen SET gelesen_am = ? WHERE benutzer_id = ? AND gelesen_am IS NULL').bind(jetzt(), s.benutzer.id).run();
  }
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Einstellungen & Geräte

benachrichtigungen.get('/einstellungen', async (c) => {
  const s = sitzungPflicht(c);
  const [e, schluessel, geraete] = await Promise.all([
    einstellungenLaden(c.env.DB, s.benutzer.id),
    vapidSchluessel(c.env),
    c.env.DB.prepare('SELECT id, geraet, erstellt_am, zuletzt_ok, fehler_zahl, endpoint FROM push_abos WHERE benutzer_id = ? ORDER BY erstellt_am')
      .bind(s.benutzer.id)
      .all<{ id: number; geraet: string; erstellt_am: string; zuletzt_ok: string | null; fehler_zahl: number; endpoint: string }>(),
  ]);
  return c.json({
    einstellungen: e,
    vapidSchluessel: schluessel.oeffentlich,
    // Endpunkt nur gekürzt herausgeben (Dienst erkennbar, Kennung nicht)
    geraete: geraete.results.map(({ endpoint, ...g }) => ({ ...g, dienst: new URL(endpoint).host, endpoint_ende: endpoint.slice(-12) })),
  });
});

const Uhrzeit = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit als HH:MM');
const EinstellungenSchema = z.object({
  kritisch: z.enum(['sofort', 'aus']),
  wichtig: z.enum(['sofort', 'gebuendelt', 'aus']),
  tagesbericht: z.boolean(),
  tagesbericht_zeit: Uhrzeit,
  ruhe_von: Uhrzeit.nullable(),
  ruhe_bis: Uhrzeit.nullable(),
});

benachrichtigungen.put('/einstellungen', async (c) => {
  const s = sitzungPflicht(c);
  const d = await body(c, EinstellungenSchema);
  if ((d.ruhe_von === null) !== (d.ruhe_bis === null)) throw new ApiFehler(400, 'ruhezeit_unvollstaendig', 'Ruhezeit bitte mit Beginn und Ende angeben.');
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO benachrichtigungs_einstellungen (benutzer_id, kritisch, wichtig, tagesbericht, tagesbericht_zeit, ruhe_von, ruhe_bis)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(benutzer_id) DO UPDATE SET kritisch = excluded.kritisch, wichtig = excluded.wichtig, tagesbericht = excluded.tagesbericht,
         tagesbericht_zeit = excluded.tagesbericht_zeit, ruhe_von = excluded.ruhe_von, ruhe_bis = excluded.ruhe_bis`,
    ).bind(s.benutzer.id, d.kritisch, d.wichtig, d.tagesbericht ? 1 : 0, d.tagesbericht_zeit, d.ruhe_von, d.ruhe_bis),
    auditStatement(c.env.DB, s, { aktion: 'benachrichtigungen.einstellungen', objektTyp: 'benutzer', objektId: s.benutzer.id, details: d }),
  ]);
  return c.json({ ok: true });
});

const AboSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => {
      const url = new URL(u);
      // Nur öffentliche HTTPS-Push-Dienste (Schutz davor, dass der Worker beliebige Adressen aufruft)
      return url.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(url.hostname);
    }, 'Ungültiger Push-Endpunkt'),
  keys: z.object({ p256dh: z.string().min(80).max(120), auth: z.string().min(16).max(40) }),
  geraet: z.string().trim().max(60).default(''),
});

benachrichtigungen.post('/abo', async (c) => {
  const s = sitzungPflicht(c);
  const d = await body(c, AboSchema);
  const origin = new URL(c.req.url).origin;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO push_abos (benutzer_id, endpoint, p256dh, auth, geraet, origin) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET benutzer_id = excluded.benutzer_id, p256dh = excluded.p256dh, auth = excluded.auth,
         geraet = CASE WHEN excluded.geraet <> '' THEN excluded.geraet ELSE push_abos.geraet END, origin = excluded.origin, fehler_zahl = 0`,
    ).bind(s.benutzer.id, d.endpoint, d.keys.p256dh, d.keys.auth, d.geraet, origin),
    auditStatement(c.env.DB, s, { aktion: 'push.geraet_angemeldet', objektTyp: 'benutzer', objektId: s.benutzer.id, details: { geraet: d.geraet, dienst: new URL(d.endpoint).host } }),
  ]);
  return c.json({ ok: true }, 201);
});

benachrichtigungen.post('/abo/abmelden', async (c) => {
  const s = sitzungPflicht(c);
  const d = await body(c, z.object({ endpoint: z.string().max(1000).optional(), id: z.number().int().optional() }));
  if (!d.endpoint && !d.id) throw new ApiFehler(400, 'angabe_fehlt', 'Gerät fehlt.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM push_abos WHERE benutzer_id = ? AND (endpoint = ? OR id = ?)').bind(s.benutzer.id, d.endpoint ?? '', d.id ?? -1),
    auditStatement(c.env.DB, s, { aktion: 'push.geraet_abgemeldet', objektTyp: 'benutzer', objektId: s.benutzer.id }),
  ]);
  return c.json({ ok: true });
});

/** Testnachricht an alle eigenen Geräte (ignoriert Einstellungen bewusst). */
benachrichtigungen.post('/test', async (c) => {
  const s = sitzungPflicht(c);
  const n = await anGeraeteSenden(
    c.env,
    s.benutzer.id,
    { kategorie: 'wichtig', titel: 'TE-Digital Zentrale', text: 'Testnachricht – Push funktioniert auf diesem Gerät.', url: '/benachrichtigungen', tag: 'test' },
    basisUrl(c.env, c.req.url),
  );
  return c.json({ ok: true, zugestellt: n });
});

export default benachrichtigungen;
