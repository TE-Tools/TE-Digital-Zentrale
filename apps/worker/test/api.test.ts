import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/lib/krypto';
import { anfrage, devAnmelden } from './hilfe';

describe('Grundfunktionen & Sicherheit', () => {
  it('liefert Gesundheitsstatus mit Sicherheits-Headern', async () => {
    const r = await anfrage('/api/gesundheit');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, dienst: 'te-zentrale', takt: true });
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('verweigert geschützte Daten ohne Anmeldung', async () => {
    expect((await anfrage('/api/dashboard')).status).toBe(401);
    expect((await anfrage('/api/projekte')).status).toBe(401);
  });

  it('blockt schreibende Anfragen ohne CSRF-Header', async () => {
    const r = await anfrage('/api/auth/abmelden', { body: {}, ohneCsrf: true });
    expect(r.status).toBe(403);
    expect(r.body.fehler.code).toBe('csrf');
  });

  it('blockt schreibende Anfragen von fremder Origin', async () => {
    const r = await anfrage('/api/auth/abmelden', { body: {}, origin: 'https://boese.example' });
    expect(r.status).toBe(403);
  });

  it('liefert 404 für unbekannte API-Pfade', async () => {
    expect((await anfrage('/api/gibtsnicht')).status).toBe(404);
  });

  it('erlaubt den Dev-Zugang nur auf localhost', async () => {
    const r = await anfrage('/api/auth/dev-anmeldung', { body: {}, basis: 'http://zentrale.example' });
    expect(r.status).toBe(404);
  });
});

describe('Ersteinrichtung', () => {
  it('lehnt einen falschen Einrichtungscode ab', async () => {
    const r = await anfrage('/api/auth/einrichtung/optionen', { body: { name: 'Thomas', einrichtungscode: 'falscher-code' } });
    expect(r.status).toBe(403);
  });

  it('liefert Passkey-Optionen mit richtigem Code', async () => {
    const r = await anfrage('/api/auth/einrichtung/optionen', {
      body: { name: 'Geschäftsführung', einrichtungscode: 'test-einrichtungscode' },
    });
    expect(r.status).toBe(200);
    expect(r.body.challengeId).toBeTruthy();
    expect(r.body.optionen.rp.id).toBe('localhost');
    expect(r.body.optionen.authenticatorSelection.userVerification).toBe('required');
  });

  it('ist gesperrt, sobald ein Benutzer existiert', async () => {
    await devAnmelden();
    const r = await anfrage('/api/auth/einrichtung/optionen', {
      body: { name: 'Zweiter', einrichtungscode: 'test-einrichtungscode' },
    });
    expect(r.status).toBe(409);
  });

  it('lehnt eine abgelaufene oder unbekannte Challenge ab', async () => {
    const r = await anfrage('/api/auth/einrichtung/abschluss', { body: { challengeId: 'x'.repeat(22), antwort: {} } });
    expect(r.status).toBe(400);
    expect(r.body.fehler.code).toBe('challenge_ungueltig');
  });
});

describe('Sitzung', () => {
  it('meldet Status, Abmeldung entwertet die Sitzung', async () => {
    const cookie = await devAnmelden();
    const s = await anfrage('/api/auth/status', { cookie });
    expect(s.body.angemeldet).toBe(true);
    expect(s.body.benutzer.rolle).toBe('gf');

    expect((await anfrage('/api/auth/abmelden', { body: {}, cookie })).status).toBe(200);
    expect((await anfrage('/api/dashboard', { cookie })).status).toBe(401);
  });

  it('Wiederherstellungscode funktioniert genau einmal und ohne Step-up', async () => {
    await devAnmelden();
    const b = await env.DB.prepare('SELECT id FROM benutzer LIMIT 1').first<{ id: string }>();
    await env.DB.prepare('INSERT INTO wiederherstellungscodes (hash, benutzer_id) VALUES (?, ?)')
      .bind(await sha256Hex('ABCD-EFGH-JKLM'), b!.id)
      .run();

    const r1 = await anfrage('/api/auth/wiederherstellung', { body: { code: 'abcd efgh jklm' } });
    expect(r1.status).toBe(200);
    const cookie = (r1.headers.get('set-cookie') ?? '').split(';')[0]!;
    const s = await anfrage('/api/auth/status', { cookie });
    expect(s.body.angemeldet).toBe(true);
    expect(s.body.bestaetigtAm).toBeNull();

    const r2 = await anfrage('/api/auth/wiederherstellung', { body: { code: 'ABCD-EFGH-JKLM' } });
    expect(r2.status).toBe(401);
  });
});

describe('Dashboard', () => {
  it('liefert Stammdaten und Status', async () => {
    const cookie = await devAnmelden();
    const r = await anfrage('/api/dashboard', { cookie });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.body.projekte).toHaveLength(8);
    expect(r.body.mitarbeiter.map((m: { id: string }) => m.id)).toEqual([
      'projektleitung',
      'technik',
      'marketing',
      'qualitaet',
      'produkt',
    ]);
    expect(r.body.zahlen.offene_freigaben).toBe(0);
  });

  it('meldet kritisch bei dringender Freigabe', async () => {
    const cookie = await devAnmelden();
    await env.DB.prepare("INSERT INTO freigaben (id, typ, titel, dringend) VALUES ('F-1', 'produktiv', 'Release', 1)").run();
    const r = await anfrage('/api/dashboard', { cookie });
    expect(r.body.status).toBe('kritisch');
    expect(r.body.freigaben).toHaveLength(1);
  });
});

describe('Projekte', () => {
  it('legt an, verhindert Dubletten und protokolliert', async () => {
    const cookie = await devAnmelden();
    const neu = { slug: 'testprojekt', name: 'Testprojekt', farbe: '#123456', repo_url: 'https://github.com/TE-Tools/x' };
    expect((await anfrage('/api/projekte', { body: neu, cookie })).status).toBe(201);
    expect((await anfrage('/api/projekte', { body: neu, cookie })).status).toBe(409);

    const d = await anfrage('/api/projekte/testprojekt', { cookie });
    expect(d.body.projekt.name).toBe('Testprojekt');
    expect(d.body.aktivitaeten[0].aktion).toBe('projekt.angelegt');
  });

  it('validiert Eingaben', async () => {
    const cookie = await devAnmelden();
    const r = await anfrage('/api/projekte', { body: { slug: 'X Y', name: 'a', repo_url: 'http://unsicher' }, cookie });
    expect(r.status).toBe(400);
    const felder = r.body.fehler.details.map((d: { feld: string }) => d.feld);
    expect(felder).toEqual(expect.arrayContaining(['slug', 'name', 'repo_url']));
  });

  it('ändert mit Versionsprüfung (kein Überschreiben fremder Änderungen)', async () => {
    const cookie = await devAnmelden();
    const p = await anfrage('/api/projekte/orchester', { cookie });
    const v = p.body.projekt.version;

    const ok = await anfrage('/api/projekte/orchester', { methode: 'PATCH', body: { kurz: 'Neu', version: v }, cookie });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(v + 1);

    const alt = await anfrage('/api/projekte/orchester', { methode: 'PATCH', body: { kurz: 'Alt', version: v }, cookie });
    expect(alt.status).toBe(409);
    expect(alt.body.fehler.code).toBe('veraltet');
  });

  it('Teil-Änderung lässt nicht mitgeschickte Felder unverändert (Regression Zod-Standardwerte)', async () => {
    const cookie = await devAnmelden();
    const vorher = (await anfrage('/api/projekte/familienplaner', { cookie })).body.projekt;
    expect(vorher.beschreibung.length).toBeGreaterThan(10);
    await anfrage('/api/projekte/familienplaner', { methode: 'PATCH', cookie, body: { kurz: 'Nur Kurztext', version: vorher.version } });
    const nachher = (await anfrage('/api/projekte/familienplaner', { cookie })).body.projekt;
    expect(nachher).toMatchObject({
      kurz: 'Nur Kurztext',
      beschreibung: vorher.beschreibung,
      repo_url: vorher.repo_url,
      farbe: vorher.farbe,
      status: vorher.status,
      sortierung: vorher.sortierung,
    });
  });

  it('Audit-Protokoll ist unveränderlich', async () => {
    await expect(env.DB.prepare('DELETE FROM aktivitaeten').run()).rejects.toThrow(/unveränderlich/);
    await expect(env.DB.prepare("UPDATE aktivitaeten SET aktion = 'x'").run()).rejects.toThrow(/unveränderlich/);
  });
});
