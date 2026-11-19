import { Hono } from 'hono';
import type { AppEnv } from './env';
import { ApiFehler } from './lib/fehler';
import { sitzungLaden } from './lib/sitzung';
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
  for (const [k, v] of Object.entries(SICHERHEITS_HEADER)) c.res.headers.set(k, v);
});

/**
 * CSRF-Schutz: Schreibende Anfragen müssen den Header "X-TE-Anfrage: 1" tragen und von einer
 * erlaubten Origin kommen. Fremde Seiten können diesen Header ohne CORS-Freigabe nicht setzen.
 */
app.use('/api/*', async (c, next) => {
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

app.get('/api/gesundheit', (c) => c.json({ ok: true, dienst: 'te-zentrale' }));
app.route('/api/auth', auth);
app.route('/api/dashboard', dashboard);
app.route('/api/projekte', projekte);
app.route('/api/mitarbeiter', mitarbeiter);
app.route('/api/aufgaben', aufgaben);
app.route('/api/nachrichten', nachrichten);
app.route('/api/entscheidungen', entscheidungen);
app.route('/api/freigaben', freigaben);

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

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<AppEnv['Bindings']>;
