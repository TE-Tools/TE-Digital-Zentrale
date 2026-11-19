import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { body } from '../lib/eingabe';
import { ApiFehler } from '../lib/fehler';
import {
  abgleichen,
  APP_EREIGNISSE,
  APP_RECHTE,
  appToken,
  githubFetch,
  installationsToken,
  prDateienLaden,
  prStatement,
  tokenCacheLeeren,
  verbindungLaden,
  verschluesseln,
  entschluesseln,
  webhookPruefen,
} from '../lib/github';
import { zufallsId } from '../lib/krypto';
import { gfPflicht, sitzungPflicht, stepUpPflicht } from '../lib/sitzung';
import { inMinuten, jetzt } from '../lib/zeit';

const github = new Hono<AppEnv>();

function organisation(env: AppEnv['Bindings']): string {
  return env.GITHUB_ORGANISATION || 'TE-Tools';
}

github.get('/status', async (c) => {
  sitzungPflicht(c);
  const v = await verbindungLaden(c.env);
  const repos = await c.env.DB.prepare(
    `SELECT r.full_name, r.privat, r.standard_branch, r.url, r.projekt_slug, p.name AS projekt_name, p.farbe AS projekt_farbe,
            (SELECT COUNT(*) FROM github_prs x WHERE x.repo = r.full_name AND x.zustand IN ('offen','entwurf')) AS offene_prs
       FROM github_repos r LEFT JOIN projekte p ON p.slug = r.projekt_slug ORDER BY r.full_name`,
  ).all();
  return c.json({
    verbindung: {
      status: v.status,
      organisation: v.organisation ?? organisation(c.env),
      app_slug: v.app_slug,
      app_url: v.app_url,
      eingerichtet_am: v.eingerichtet_am,
      installiert_am: v.installiert_am,
      letzter_abgleich: v.letzter_abgleich,
      letzter_fehler: v.letzter_fehler,
      schluessel_vorhanden: !!c.env.ZENTRALE_SCHLUESSEL,
      installieren_url: v.app_url ? `${v.app_url}/installations/new` : null,
    },
    rechte: APP_RECHTE,
    repos: repos.results,
  });
});

/** Schritt 1: Manifest für github.com erzeugen (Stufe 3 → Passkey). Das Formular schickt der Browser selbst an GitHub. */
github.post('/einrichten', async (c) => {
  const s = stepUpPflicht(c);
  if (!c.env.ZENTRALE_SCHLUESSEL) {
    throw new ApiFehler(503, 'schluessel_fehlt', 'Auf dem Server fehlt das Secret ZENTRALE_SCHLUESSEL – bitte zuerst hinterlegen (siehe README).');
  }
  const v = await verbindungLaden(c.env);
  if (v.status !== 'getrennt') throw new ApiFehler(409, 'bereits_verbunden', 'Es besteht bereits eine Verbindung. Bitte zuerst trennen.');
  const origin = new URL(c.req.url).origin;
  const state = zufallsId(24);
  const org = organisation(c.env);
  const manifest = {
    name: `TE-Zentrale-${zufallsId(3).replace(/[^a-zA-Z0-9]/g, 'x')}`,
    url: origin,
    description: 'TE-Digital Zentrale: liest Repositories, Pull Requests und Checks; schreibt nur Issues/Kommentare. Kein Schreibzugriff auf Code.',
    hook_attributes: { url: `${origin}/api/github/webhook`, active: true },
    redirect_url: `${origin}/api/github/rueckkehr`,
    setup_url: `${origin}/api/github/installiert`,
    setup_on_update: true,
    public: false,
    default_permissions: APP_RECHTE,
    default_events: APP_EREIGNISSE,
  };
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE github_verbindung SET state = ?, state_ablauf = ?, organisation = ? WHERE id = 1').bind(state, inMinuten(15), org),
    auditStatement(c.env.DB, s, { aktion: 'github.einrichtung_gestartet', objektTyp: 'github', details: { organisation: org, rechte: APP_RECHTE } }),
  ]);
  return c.json({
    aktion: `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${encodeURIComponent(state)}`,
    manifest,
  });
});

/**
 * Schritt 2: GitHub leitet nach dem Anlegen der App hierher zurück (seitenübergreifend → kein Sitzungs-Cookie).
 * Berechtigt ist der Aufruf allein durch das einmalige, 15 Minuten gültige state-Token.
 */
github.get('/rueckkehr', async (c) => {
  const code = c.req.query('code') ?? '';
  const state = c.req.query('state') ?? '';
  const v = await verbindungLaden(c.env);
  const ziel = (q: string) => c.redirect(`/einstellungen?github=${q}`, 302);
  if (!state || state !== v.state || !v.state_ablauf || Date.parse(v.state_ablauf) < Date.now() || !/^[\w-]{10,100}$/.test(code)) {
    return ziel('ungueltig');
  }
  // state sofort verbrauchen
  await c.env.DB.prepare('UPDATE github_verbindung SET state = NULL, state_ablauf = NULL WHERE id = 1').run();
  const r = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TE-Digital-Zentrale', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!r.ok) return ziel('fehler');
  const d = (await r.json()) as { id: number; slug: string; html_url: string; pem: string; webhook_secret: string; owner?: { login: string } };
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE github_verbindung SET status = 'eingerichtet', app_id = ?, app_slug = ?, app_url = ?, pem_verschluesselt = ?, webhook_verschluesselt = ?,
         eingerichtet_am = ?, organisation = COALESCE(?, organisation), letzter_fehler = NULL WHERE id = 1`,
    ).bind(d.id, d.slug, d.html_url, await verschluesseln(c.env, d.pem), await verschluesseln(c.env, d.webhook_secret), jetzt(), d.owner?.login ?? null),
    auditStatement(c.env.DB, null, { aktion: 'github.app_angelegt', objektTyp: 'github', details: { app: d.slug } }),
  ]);
  return ziel('eingerichtet');
});

/** Schritt 3: Nach der Installation (Repo-Auswahl auf GitHub) leitet GitHub hierher. Geprüft wird über die GitHub-API. */
github.get('/installiert', async (c) => {
  const id = Number(c.req.query('installation_id'));
  const v = await verbindungLaden(c.env);
  const ziel = (q: string) => c.redirect(`/entwicklung?github=${q}`, 302);
  if (!Number.isInteger(id) || id <= 0 || v.status === 'getrennt') return ziel('ungueltig');
  const r = await githubFetch(`/app/installations/${id}`, { token: await appToken(c.env, v) });
  if (!r.ok) return ziel('ungueltig'); // gehört nicht zu unserer App
  const inst = (await r.json()) as { account?: { login: string } };
  if (v.organisation && inst.account?.login && inst.account.login.toLowerCase() !== v.organisation.toLowerCase()) return ziel('falsche_organisation');
  tokenCacheLeeren();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE github_verbindung SET status = 'installiert', installation_id = ?, installiert_am = COALESCE(installiert_am, ?) WHERE id = 1`).bind(id, jetzt()),
    auditStatement(c.env.DB, null, { aktion: 'github.installiert', objektTyp: 'github', details: { installation: id, konto: inst.account?.login } }),
  ]);
  try {
    await abgleichen(c.env);
  } catch {
    /* Fehler steht in letzter_fehler */
  }
  return ziel('installiert');
});

github.post('/abgleich', async (c) => {
  gfPflicht(c);
  try {
    return c.json({ ok: true, ...(await abgleichen(c.env)) });
  } catch (e) {
    throw new ApiFehler(502, 'github_fehler', (e as Error).message);
  }
});

github.post('/trennen', async (c) => {
  const s = stepUpPflicht(c);
  const v = await verbindungLaden(c.env);
  tokenCacheLeeren();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE github_verbindung SET status = 'getrennt', app_id = NULL, app_slug = NULL, pem_verschluesselt = NULL, webhook_verschluesselt = NULL,
         installation_id = NULL, state = NULL, state_ablauf = NULL, letzter_fehler = NULL WHERE id = 1`,
    ),
    c.env.DB.prepare('DELETE FROM github_repos'),
    auditStatement(c.env.DB, s, { aktion: 'github.getrennt', objektTyp: 'github', details: { app: v.app_slug } }),
  ]);
  // Die App selbst löscht/deinstalliert die Geschäftsführung auf GitHub (Link in der Oberfläche)
  return c.json({ ok: true, app_url: v.app_url });
});

github.patch('/repos/:owner/:name', async (c) => {
  const s = gfPflicht(c);
  const repo = `${c.req.param('owner')}/${c.req.param('name')}`;
  const { projekt_slug } = await body(c, z.object({ projekt_slug: z.string().max(40).nullable() }));
  const r = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE github_repos SET projekt_slug = (SELECT slug FROM projekte WHERE slug = ?) WHERE full_name = ?').bind(projekt_slug, repo),
    auditStatement(c.env.DB, s, { aktion: 'github.repo_zugeordnet', objektTyp: 'github', objektId: repo, projektSlug: projekt_slug }),
  ]);
  if ((r[0]?.meta.changes ?? 0) === 0) throw new ApiFehler(404, 'nicht_gefunden', 'Repository nicht gefunden.');
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Webhook (ohne Sitzung, signiert)

github.post('/webhook', async (c) => {
  const v = await verbindungLaden(c.env);
  if (!v.webhook_verschluesselt) return c.json({ ok: false }, 404);
  const roh = await c.req.text();
  if (roh.length > 2_000_000) return c.json({ ok: false }, 413);
  const geheimnis = await entschluesseln(c.env, v.webhook_verschluesselt);
  if (!(await webhookPruefen(geheimnis, roh, c.req.header('x-hub-signature-256')))) return c.json({ ok: false }, 401);
  const ereignis = c.req.header('x-github-event') ?? '';
  const d = JSON.parse(roh) as Record<string, any>;
  const db = c.env.DB;
  const repo: string | undefined = d.repository?.full_name;
  const bekannt = repo ? await db.prepare('SELECT 1 FROM github_repos WHERE full_name = ?').bind(repo).first() : null;

  if (ereignis === 'ping') return c.json({ ok: true });
  if (ereignis === 'installation' && d.action === 'deleted') {
    await db.batch([
      db.prepare(`UPDATE github_verbindung SET status = 'eingerichtet', installation_id = NULL WHERE id = 1`),
      db.prepare('DELETE FROM github_repos'),
      auditStatement(db, null, { aktion: 'github.deinstalliert', objektTyp: 'github' }),
    ]);
    tokenCacheLeeren();
    return c.json({ ok: true });
  }
  if (ereignis === 'pull_request' && repo && bekannt) {
    await prStatement(db, repo, d.pull_request).run();
    if (['opened', 'synchronize', 'reopened', 'ready_for_review'].includes(d.action) && v.status === 'installiert') {
      // Dateiliste nachladen – im Hintergrund, damit GitHub schnell eine Antwort bekommt
      const arbeit = installationsToken(c.env, v).then((t) => prDateienLaden(c.env, t, repo, d.pull_request.number)).catch(() => undefined);
      try {
        c.executionCtx.waitUntil(arbeit);
      } catch {
        await arbeit;
      }
    }
    return c.json({ ok: true });
  }
  if (ereignis === 'check_suite' && repo && bekannt && d.action === 'completed') {
    const fazit = d.check_suite?.conclusion === 'success' ? 'erfolgreich' : d.check_suite?.conclusion ? 'fehlgeschlagen' : 'laeuft';
    await db.prepare('UPDATE github_prs SET checks = ? WHERE repo = ? AND head_sha = ?').bind(fazit, repo, d.check_suite?.head_sha ?? '').run();
    return c.json({ ok: true });
  }
  if (ereignis === 'check_suite' && repo && bekannt && (d.action === 'requested' || d.action === 'rerequested')) {
    await db.prepare(`UPDATE github_prs SET checks = 'laeuft' WHERE repo = ? AND head_sha = ?`).bind(repo, d.check_suite?.head_sha ?? '').run();
    return c.json({ ok: true });
  }
  return c.json({ ok: true, ignoriert: ereignis });
});

export default github;
