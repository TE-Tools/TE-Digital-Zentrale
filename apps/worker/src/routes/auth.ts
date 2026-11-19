import { Hono } from 'hono';
import { z } from 'zod';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiFehler, validierungsFehler } from '../lib/fehler';
import {
  base64url,
  normalisiereCode,
  sha256Hex,
  sicherGleich,
  vonBase64url,
  wiederherstellungscode,
  zufallsBytes,
  zufallsId,
} from '../lib/krypto';
import { gfPflicht, sitzungBeenden, sitzungErstellen, sitzungPflicht } from '../lib/sitzung';
import { inMinuten, jetzt } from '../lib/zeit';

const auth = new Hono<AppEnv>();

const CHALLENGE_MINUTEN = 5;
const ANZAHL_CODES = 8;

function origins(env: AppEnv['Bindings']): string[] {
  return env.ERLAUBTE_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
}

function parse<T>(schema: z.ZodType<T>, daten: unknown): T {
  const r = schema.safeParse(daten);
  if (!r.success) throw validierungsFehler(r.error);
  return r.data;
}

async function anzahlBenutzer(db: D1Database): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM benutzer').first<{ n: number }>();
  return r?.n ?? 0;
}

/** Holt und löscht eine Challenge (einmalig verwendbar). */
async function challengeVerbrauchen(db: D1Database, id: string, zweck: string) {
  const row = await db
    .prepare('DELETE FROM auth_challenges WHERE id = ? AND zweck = ? RETURNING challenge, benutzer_id, daten, ablauf_am')
    .bind(id, zweck)
    .first<{ challenge: string; benutzer_id: string | null; daten: string | null; ablauf_am: string }>();
  if (!row || Date.parse(row.ablauf_am) <= Date.now()) {
    throw new ApiFehler(400, 'challenge_ungueltig', 'Die Anfrage ist abgelaufen. Bitte erneut versuchen.');
  }
  return row;
}

async function challengeSpeichern(
  db: D1Database,
  zweck: 'einrichtung' | 'anmeldung' | 'passkey',
  challenge: string,
  benutzerId: string | null,
  daten: unknown,
): Promise<string> {
  const id = zufallsId();
  await db.batch([
    db.prepare('DELETE FROM auth_challenges WHERE ablauf_am < ?').bind(jetzt()),
    db
      .prepare('INSERT INTO auth_challenges (id, zweck, challenge, benutzer_id, daten, ablauf_am) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, zweck, challenge, benutzerId, daten ? JSON.stringify(daten) : null, inMinuten(CHALLENGE_MINUTEN)),
  ]);
  return id;
}

function passkeyStatement(
  db: D1Database,
  benutzerId: string,
  cred: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] },
  geraet: string,
): D1PreparedStatement {
  return db
    .prepare('INSERT INTO passkeys (id, benutzer_id, public_key, zaehler, transports, geraet) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(cred.id, benutzerId, base64url(cred.publicKey), cred.counter, JSON.stringify(cred.transports ?? []), geraet);
}

// ---------------------------------------------------------------- Status

auth.get('/status', async (c) => {
  const s = c.get('sitzung');
  const eingerichtet = (await anzahlBenutzer(c.env.DB)) > 0;
  const host = new URL(c.req.url).hostname;
  return c.json({
    eingerichtet,
    angemeldet: !!s,
    benutzer: s?.benutzer ?? null,
    bestaetigtAm: s?.bestaetigtAm ?? null,
    devLogin: c.env.DEV_LOGIN === '1' && (host === 'localhost' || host === '127.0.0.1'),
  });
});

// ---------------------------------------------------------------- Ersteinrichtung

const EinrichtungStart = z.object({
  name: z.string().trim().min(2).max(60),
  einrichtungscode: z.string().min(8).max(200),
});

auth.post('/einrichtung/optionen', async (c) => {
  const { name, einrichtungscode } = parse(EinrichtungStart, await c.req.json());
  if (!c.env.EINRICHTUNGSCODE) {
    throw new ApiFehler(503, 'nicht_konfiguriert', 'Der Einrichtungscode ist auf dem Server nicht gesetzt.');
  }
  if ((await anzahlBenutzer(c.env.DB)) > 0) {
    throw new ApiFehler(409, 'bereits_eingerichtet', 'Die Zentrale ist bereits eingerichtet.');
  }
  if (!(await sicherGleich(einrichtungscode, c.env.EINRICHTUNGSCODE))) {
    throw new ApiFehler(403, 'code_falsch', 'Der Einrichtungscode ist falsch.');
  }
  const benutzerId = base64url(zufallsBytes(16));
  const optionen = await generateRegistrationOptions({
    rpName: c.env.RP_NAME,
    rpID: c.env.RP_ID,
    userName: name,
    userDisplayName: name,
    userID: vonBase64url(benutzerId) as Uint8Array<ArrayBuffer>,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const challengeId = await challengeSpeichern(c.env.DB, 'einrichtung', optionen.challenge, benutzerId, { name });
  return c.json({ challengeId, optionen });
});

const Abschluss = z.object({
  challengeId: z.string().min(10).max(64),
  antwort: z.record(z.string(), z.unknown()),
  geraet: z.string().trim().max(60).optional(),
});

auth.post('/einrichtung/abschluss', async (c) => {
  const { challengeId, antwort, geraet } = parse(Abschluss, await c.req.json());
  const ch = await challengeVerbrauchen(c.env.DB, challengeId, 'einrichtung');
  if ((await anzahlBenutzer(c.env.DB)) > 0) {
    throw new ApiFehler(409, 'bereits_eingerichtet', 'Die Zentrale ist bereits eingerichtet.');
  }
  const v = await verifyRegistrationResponse({
    response: antwort as unknown as RegistrationResponseJSON,
    expectedChallenge: ch.challenge,
    expectedOrigin: origins(c.env),
    expectedRPID: c.env.RP_ID,
    requireUserVerification: true,
  });
  if (!v.verified) throw new ApiFehler(400, 'passkey_ungueltig', 'Der Passkey konnte nicht geprüft werden.');

  const benutzerId = ch.benutzer_id!;
  const name = (JSON.parse(ch.daten ?? '{}') as { name?: string }).name ?? 'Geschäftsführung';
  const codes = Array.from({ length: ANZAHL_CODES }, wiederherstellungscode);
  const codeHashes = await Promise.all(codes.map((k) => sha256Hex(k)));
  const db = c.env.DB;
  const sitzungStmt = await sitzungErstellen(c, benutzerId, true);
  await db.batch([
    db.prepare("INSERT INTO benutzer (id, name, rolle) VALUES (?, ?, 'gf')").bind(benutzerId, name),
    passkeyStatement(db, benutzerId, v.registrationInfo.credential, geraet || 'Erstes Gerät'),
    ...codeHashes.map((h) => db.prepare('INSERT INTO wiederherstellungscodes (hash, benutzer_id) VALUES (?, ?)').bind(h, benutzerId)),
    sitzungStmt,
    auditStatement(db, { tokenHash: '', bestaetigtAm: null, benutzer: { id: benutzerId, name, rolle: 'gf' } }, {
      aktion: 'zugang.eingerichtet',
      objektTyp: 'benutzer',
      objektId: benutzerId,
    }),
  ]);
  return c.json({ ok: true, wiederherstellungscodes: codes });
});

// ---------------------------------------------------------------- Anmeldung

auth.post('/anmelden/optionen', async (c) => {
  const optionen = await generateAuthenticationOptions({
    rpID: c.env.RP_ID,
    userVerification: 'required',
    allowCredentials: [],
  });
  const challengeId = await challengeSpeichern(c.env.DB, 'anmeldung', optionen.challenge, null, null);
  return c.json({ challengeId, optionen });
});

auth.post('/anmelden/abschluss', async (c) => {
  const { challengeId, antwort } = parse(Abschluss, await c.req.json());
  const ch = await challengeVerbrauchen(c.env.DB, challengeId, 'anmeldung');
  const resp = antwort as unknown as AuthenticationResponseJSON;
  if (typeof resp.id !== 'string') throw new ApiFehler(400, 'passkey_ungueltig', 'Unbekannter Passkey.');
  const pk = await c.env.DB.prepare(
    'SELECT p.id, p.benutzer_id, p.public_key, p.zaehler, p.transports, b.name FROM passkeys p JOIN benutzer b ON b.id = p.benutzer_id WHERE p.id = ?',
  )
    .bind(resp.id)
    .first<{ id: string; benutzer_id: string; public_key: string; zaehler: number; transports: string | null; name: string }>();
  if (!pk) throw new ApiFehler(401, 'passkey_unbekannt', 'Dieser Passkey ist hier nicht registriert.');

  const v = await verifyAuthenticationResponse({
    response: resp,
    expectedChallenge: ch.challenge,
    expectedOrigin: origins(c.env),
    expectedRPID: c.env.RP_ID,
    requireUserVerification: true,
    credential: {
      id: pk.id,
      publicKey: vonBase64url(pk.public_key) as Uint8Array<ArrayBuffer>,
      counter: pk.zaehler,
      transports: JSON.parse(pk.transports ?? '[]') as string[],
    },
  });
  if (!v.verified) throw new ApiFehler(401, 'passkey_ungueltig', 'Anmeldung fehlgeschlagen.');

  const db = c.env.DB;
  const bestehend = c.get('sitzung');
  const stmts: D1PreparedStatement[] = [
    db.prepare('UPDATE passkeys SET zaehler = ?, zuletzt_am = ? WHERE id = ?').bind(v.authenticationInfo.newCounter, jetzt(), pk.id),
  ];
  if (bestehend && bestehend.benutzer.id === pk.benutzer_id) {
    // Step-up: bestehende Sitzung bestätigen statt neue anzulegen
    stmts.push(db.prepare('UPDATE sitzungen SET bestaetigt_am = ? WHERE token_hash = ?').bind(jetzt(), bestehend.tokenHash));
  } else {
    stmts.push(await sitzungErstellen(c, pk.benutzer_id, true));
    stmts.push(
      auditStatement(db, { tokenHash: '', bestaetigtAm: null, benutzer: { id: pk.benutzer_id, name: pk.name, rolle: 'gf' } }, {
        aktion: 'anmeldung.passkey',
        objektTyp: 'benutzer',
        objektId: pk.benutzer_id,
      }),
    );
  }
  await db.batch(stmts);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- Wiederherstellung

auth.post('/wiederherstellung', async (c) => {
  const { code } = parse(z.object({ code: z.string().min(12).max(20) }), await c.req.json());
  const hash = await sha256Hex(normalisiereCode(code));
  const row = await c.env.DB.prepare(
    `UPDATE wiederherstellungscodes SET verwendet_am = ? WHERE hash = ? AND verwendet_am IS NULL
     RETURNING benutzer_id`,
  )
    .bind(jetzt(), hash)
    .first<{ benutzer_id: string }>();
  if (!row) throw new ApiFehler(401, 'code_ungueltig', 'Code ungültig oder bereits verwendet.');
  const b = await c.env.DB.prepare('SELECT id, name, rolle FROM benutzer WHERE id = ?').bind(row.benutzer_id).first<{ id: string; name: string; rolle: 'gf' | 'leser' }>();
  const db = c.env.DB;
  // Ohne Passkey-Bestätigung: Stufe-3-Aktionen bleiben gesperrt, bis ein neuer Passkey registriert ist.
  await db.batch([
    await sitzungErstellen(c, row.benutzer_id, false),
    auditStatement(db, { tokenHash: '', bestaetigtAm: null, benutzer: b! }, {
      aktion: 'anmeldung.wiederherstellungscode',
      objektTyp: 'benutzer',
      objektId: row.benutzer_id,
    }),
  ]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- Weitere Passkeys

auth.post('/passkey/optionen', async (c) => {
  const s = gfPflicht(c);
  const vorhandene = await c.env.DB.prepare('SELECT id, transports FROM passkeys WHERE benutzer_id = ?')
    .bind(s.benutzer.id)
    .all<{ id: string; transports: string | null }>();
  const optionen = await generateRegistrationOptions({
    rpName: c.env.RP_NAME,
    rpID: c.env.RP_ID,
    userName: s.benutzer.name,
    userDisplayName: s.benutzer.name,
    userID: vonBase64url(s.benutzer.id) as Uint8Array<ArrayBuffer>,
    attestationType: 'none',
    excludeCredentials: vorhandene.results.map((p) => ({
      id: p.id,
      transports: JSON.parse(p.transports ?? '[]') as string[],
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const challengeId = await challengeSpeichern(c.env.DB, 'passkey', optionen.challenge, s.benutzer.id, null);
  return c.json({ challengeId, optionen });
});

auth.post('/passkey/abschluss', async (c) => {
  const s = gfPflicht(c);
  const { challengeId, antwort, geraet } = parse(Abschluss, await c.req.json());
  const ch = await challengeVerbrauchen(c.env.DB, challengeId, 'passkey');
  if (ch.benutzer_id !== s.benutzer.id) throw new ApiFehler(403, 'keine_berechtigung', 'Falscher Benutzer.');
  const v = await verifyRegistrationResponse({
    response: antwort as unknown as RegistrationResponseJSON,
    expectedChallenge: ch.challenge,
    expectedOrigin: origins(c.env),
    expectedRPID: c.env.RP_ID,
    requireUserVerification: true,
  });
  if (!v.verified) throw new ApiFehler(400, 'passkey_ungueltig', 'Der Passkey konnte nicht geprüft werden.');
  const db = c.env.DB;
  await db.batch([
    passkeyStatement(db, s.benutzer.id, v.registrationInfo.credential, geraet || 'Weiteres Gerät'),
    db.prepare('UPDATE sitzungen SET bestaetigt_am = ? WHERE token_hash = ?').bind(jetzt(), s.tokenHash),
    auditStatement(db, s, { aktion: 'passkey.hinzugefuegt', objektTyp: 'passkey', objektId: v.registrationInfo.credential.id }),
  ]);
  return c.json({ ok: true });
});

auth.get('/passkeys', async (c) => {
  const s = sitzungPflicht(c);
  const r = await c.env.DB.prepare('SELECT id, geraet, erstellt_am, zuletzt_am FROM passkeys WHERE benutzer_id = ? ORDER BY erstellt_am')
    .bind(s.benutzer.id)
    .all();
  const codes = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM wiederherstellungscodes WHERE benutzer_id = ? AND verwendet_am IS NULL')
    .bind(s.benutzer.id)
    .first<{ n: number }>();
  return c.json({ passkeys: r.results, offeneCodes: codes?.n ?? 0 });
});

// ---------------------------------------------------------------- Abmelden

auth.post('/abmelden', async (c) => {
  await sitzungBeenden(c);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- Nur lokal

auth.post('/dev-anmeldung', async (c) => {
  const host = new URL(c.req.url).hostname;
  if (c.env.DEV_LOGIN !== '1' || (host !== 'localhost' && host !== '127.0.0.1')) {
    throw new ApiFehler(404, 'nicht_gefunden', 'Nicht gefunden.');
  }
  const db = c.env.DB;
  let b = await db.prepare("SELECT id, name FROM benutzer WHERE rolle = 'gf' ORDER BY erstellt_am LIMIT 1").first<{ id: string; name: string }>();
  if (!b) {
    b = { id: base64url(zufallsBytes(16)), name: 'Geschäftsführung (lokal)' };
    await db.prepare("INSERT INTO benutzer (id, name, rolle) VALUES (?, ?, 'gf')").bind(b.id, b.name).run();
  }
  // Lokal gilt die Sitzung als bestätigt, damit Stufe-3-Abläufe testbar sind.
  await db.batch([await sitzungErstellen(c, b.id, true)]);
  return c.json({ ok: true });
});

export default auth;
