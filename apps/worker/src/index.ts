import { Hono } from 'hono';
import type { AppEnv } from './env';
import { ApiFehler } from './lib/fehler';
import { sitzungLaden, sitzungPflicht } from './lib/sitzung';
import { cronAusfuehren } from './cron';
import { liveSenden, liveStub, ZentraleLive } from './live';
import benachrichtigungen from './routes/benachrichtigungen';
import entwicklung from './routes/entwicklung';
import github from './routes/github';
import sperren from './routes/sperren';
import zugaenge from './routes/zugaenge';
import wissen from './routes/wissen';
import berichte from './routes/berichte';
import kosten from './routes/kosten';
import { agentLaden } from './lib/agent';
import { anschluss, drosseln } from './lib/drossel';
import { mcpBehandeln } from './mcp';
import aufgaben from './routes/aufgaben';
import auth from './routes/auth';
import dashboard from './routes/dashboard';
import entscheidungen from './routes/entscheidungen';
import freigaben from './routes/freigaben';
import mitarbeiter from './routes/mitarbeiter';
import nachrichten from './routes/nachrichten';
import projekte from './routes/projekte';

export const app = new Hono<AppEnv>();

const SICHERHEITS_HEADER: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

app.use('/api/*', async (c, next) => {
  await next();
  if (c.res.status === 101) return; // WebSocket-Antwort nicht verändern
  for (const [k, v] of Object.entries(SICHERHEITS_HEADER)) c.res.headers.set(k, v);
});

/**
 * CSRF-Schutz: Schreibende Anfragen müssen den Header "X-TE-Anfrage: 1" tragen und von einer
 * erlaubten Origin kommen. Fremde Seiten können diesen Header ohne CORS-Freigabe nicht setzen.
 */
app.use('/api/*', async (c, next) => {
  // GitHub-Webhooks sind per HMAC-Signatur gesichert (kein Cookie, kein CSRF-Header)
  if (c.req.path === '/api/github/webhook') return next();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    if (c.req.header('x-te-anfrage') !== '1') {
      throw new ApiFehler(403, 'csrf', 'Anfrage abgelehnt.');
    }
    const origin = c.req.header('origin');
    const erlaubt = c.env.ERLAUBTE_ORIGINS.split(',').map((o) => o.trim());
    const eigene = new URL(c.req.url).origin;
    if (origin && origin !== eigene && !erlaubt.includes(origin)) {
      throw new ApiFehler(403, 'csrf', 'Anfrage abgelehnt.');
    }
  }
  await next();
});

app.use('/api/*', sitzungLaden);
app.use('/api/*', agentLaden);

/**
 * KI-Mitarbeiter (MCP, interne Aufrufe) dürfen nur diese Routen nutzen – alles andere wird abgelehnt,
 * unabhängig von den Prüfungen in den Routen selbst (doppelte Sicherung).
 */
const AGENT_WEGE: [string, RegExp][] = [
  ['GET', /^\/api\/aufgaben\/TD-\d{4,}\/paket$/],
  ['PATCH', /^\/api\/aufgaben\/TD-\d{4,}$/],
  ['POST', /^\/api\/aufgaben\/TD-\d{4,}\/(ergebnis|checkpoint|limit)$/],
  ['POST', /^\/api\/(nachrichten|freigaben|entscheidungen|sperren)$/],
  ['POST', /^\/api\/sperren\/\d+\/freigeben$/],
  ['GET', /^\/api\/wissen(\/\d+)?$/],
  ['POST', /^\/api\/wissen$/],
  ['PATCH', /^\/api\/wissen\/\d+$/],
];
/**
 * Drosselung: Anmeldewege je Anschluss (gegen Durchprobieren von Codes), schreibende Anfragen je Benutzer.
 * Interne Aufrufe des MCP-Servers sind bereits über RL_MCP gedrosselt.
 */
app.use('/api/*', async (c, next) => {
  const m = c.req.method;
  if (m === 'POST' && c.req.path.startsWith('/api/auth/') && !/\/(dev-anmeldung|abmelden)$/.test(c.req.path)) {
    await drosseln(c.env, 'RL_ANMELDUNG', anschluss(c.req.raw));
  } else if (!['GET', 'HEAD', 'OPTIONS'].includes(m) && !c.get('agent')) {
    await drosseln(c.env, 'RL_SCHREIBEN', c.get('sitzung')?.benutzer.id ?? anschluss(c.req.raw));
  }
  await next();
});

app.use('/api/*', async (c, next) => {
  if (c.get('agent') && !AGENT_WEGE.some(([m, re]) => m === c.req.method && re.test(c.req.path))) {
    throw new ApiFehler(403, 'agent_nicht_erlaubt', 'Für KI-Mitarbeiter nicht freigegeben.');
  }
  await next();
});

/** Nach jeder erfolgreichen Änderung alle verbundenen Geräte benachrichtigen (nur Signal, keine Daten). */
app.use('/api/*', async (c, next) => {
  await next();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) && c.res.status < 400 && !c.req.path.startsWith('/api/auth/')) {
    const arbeit = liveSenden(c.env, { art: 'geaendert', pfad: c.req.path });
    try {
      c.executionCtx.waitUntil(arbeit);
    } catch {
      await arbeit;
    }
  }
});

/** Echtzeit-Verbindung (WebSocket) – nur angemeldet und nur von eigener/erlaubter Origin. */
app.get('/api/live', async (c) => {
  sitzungPflicht(c);
  if (c.req.header('upgrade') !== 'websocket') throw new ApiFehler(426, 'websocket_erwartet', 'WebSocket erwartet.');
  const origin = c.req.header('origin');
  const erlaubt = [new URL(c.req.url).origin, ...c.env.ERLAUBTE_ORIGINS.split(',').map((o) => o.trim())];
  if (!origin || !erlaubt.includes(origin)) throw new ApiFehler(403, 'origin', 'Verbindung abgelehnt.');
  return liveStub(c.env).fetch(c.req.raw);
});

app.get('/api/gesundheit', async (c) => {
  // Weckt bei Bedarf den Takt (Durable-Object-Alarm statt Cron); der Rauchtest nach jedem Deploy ruft das auf.
  let takt = false;
  try {
    takt = (await liveStub(c.env).fetch('https://live/takt')).ok;
  } catch (e) {
    console.error('Takt nicht erreichbar', e);
  }
  return c.json({ ok: true, dienst: 'te-zentrale', takt });
});
app.route('/api/auth', auth);
app.route('/api/dashboard', dashboard);
app.route('/api/projekte', projekte);
app.route('/api/mitarbeiter', mitarbeiter);
app.route('/api/aufgaben', aufgaben);
app.route('/api/nachrichten', nachrichten);
app.route('/api/entscheidungen', entscheidungen);
app.route('/api/freigaben', freigaben);
app.route('/api/benachrichtigungen', benachrichtigungen);
app.route('/api/sperren', sperren);
app.route('/api/zugaenge', zugaenge);
app.route('/api/github', github);
app.route('/api/entwicklung', entwicklung);
app.route('/api/wissen', wissen);
app.route('/api/berichte', berichte);
app.route('/api/kosten', kosten);

/** MCP-Server für Claude Code / Claude.ai (eigene Token-Authentifizierung, siehe mcp.ts) */
app.all('/mcp', (c) => mcpBehandeln(c.req.raw, c.env, c.executionCtx as unknown as ExecutionContext, app));

app.all('/api/*', () => {
  throw new ApiFehler(404, 'nicht_gefunden', 'Unbekannter Endpunkt.');
});

app.onError((err, c) => {
  if (err instanceof ApiFehler) {
    return c.json({ fehler: { code: err.code, meldung: err.message, details: err.details } }, err.status);
  }
  if (err instanceof SyntaxError) {
    return c.json({ fehler: { code: 'json_ungueltig', meldung: 'Ungültiges JSON.' } }, 400);
  }
  console.error('Unerwarteter Fehler', err);
  return c.json({ fehler: { code: 'serverfehler', meldung: 'Interner Fehler.' } }, 500);
});

export { ZentraleLive };

export default {
  fetch: app.fetch,
  // Nur noch für manuelle Auslösung (lokal: wrangler dev --test-scheduled); im Betrieb taktet der Alarm in ZentraleLive.
  async scheduled(_ctrl, env, ctx) {
    ctx.waitUntil(cronAusfuehren(env).then((s) => console.log('Cron', JSON.stringify(s))));
  },
} satisfies ExportedHandler<AppEnv['Bindings']>;
