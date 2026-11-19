// Wiederherstellungstest (Phase 7): spielt eine D1-Sicherung (SQL-Export) in eine frische, lokale
// Datenbank ein und prüft, ob alle Kerntabellen vollständig und lesbar sind.
// Aufruf: node scripts/wiederherstellung-testen.mjs <sicherung.sql>
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const datei = process.argv[2] && resolve(process.argv[2]);
if (!datei || !existsSync(datei)) {
  console.error('Aufruf: node scripts/wiederherstellung-testen.mjs <sicherung.sql>');
  process.exit(2);
}
const worker = fileURLToPath(new URL('../apps/worker/', import.meta.url));
const ziel = mkdtempSync(join(tmpdir(), 'te-zentrale-wiederherstellung-'));
// wrangler direkt über Node starten (ohne Shell – sonst zerlegt Windows den SQL-Befehl)
const wranglerBin = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');

function wrangler(args) {
  const r = spawnSync(process.execPath, [wranglerBin, ...args, '--local', '--persist-to', ziel], {
    cwd: worker,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`wrangler ${args.join(' ')} fehlgeschlagen:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

const PFLICHT = ['benutzer', 'projekte', 'mitarbeiter', 'aufgaben', 'freigaben', 'entscheidungen', 'aktivitaeten', 'nachrichten', 'wissen', 'berichte', 'd1_migrations'];

try {
  console.log(`Spiele ${datei} in eine leere Datenbank ein …`);
  wrangler(['d1', 'execute', 'te-zentrale-db', '--file', datei, '--yes']);
  const abfrage = `SELECT ${PFLICHT.map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(', ')}`;
  const roh = wrangler(['d1', 'execute', 'te-zentrale-db', '--command', abfrage, '--json']);
  const json = JSON.parse(roh.slice(roh.indexOf('[')));
  const zeilen = Object.entries(json[0].results[0]).map(([tabelle, anzahl]) => ({ tabelle, zeilen: Number(anzahl) }));
  let ok = true;
  for (const z of zeilen) console.log(`  ${z.tabelle.padEnd(16)} ${String(z.zeilen).padStart(6)} Zeilen`);
  for (const t of ['projekte', 'mitarbeiter', 'd1_migrations']) {
    if (!zeilen.find((z) => z.tabelle === t && z.zeilen > 0)) {
      console.error(`✗ Tabelle ${t} ist leer`);
      ok = false;
    }
  }
  // Unveränderlichkeit des Protokolls muss auch nach der Wiederherstellung greifen
  try {
    wrangler(['d1', 'execute', 'te-zentrale-db', '--command', 'DELETE FROM aktivitaeten']);
    console.error('✗ Audit-Schutz (Trigger) fehlt nach Wiederherstellung');
    ok = false;
  } catch {
    console.log('  Audit-Schutz aktiv (Löschen abgewiesen)');
  }
  console.log(ok ? '✓ Wiederherstellung erfolgreich geprüft' : '✗ Wiederherstellung unvollständig');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error(String(e.message ?? e));
  process.exitCode = 1;
} finally {
  rmSync(ziel, { recursive: true, force: true });
}
