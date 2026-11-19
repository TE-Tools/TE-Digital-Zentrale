// Performance-Budget (Phase 7): prüft die Größe des Produktions-Builds (gzip), damit die PWA
// auch im Mobilfunknetz schnell lädt. Aufruf nach `npm run build`: node scripts/budget.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
const assets = join(dist, 'assets');

const BUDGET_KB = {
  'JavaScript (Start, gzip)': 75,
  'CSS (gzip)': 15,
  'Vorab gespeichert gesamt (roh)': 600,
};

const gz = (datei) => gzipSync(readFileSync(datei)).length / 1024;
const dateien = readdirSync(assets).map((n) => join(assets, n));
const startJs = dateien.filter((d) => /index-[\w-]+\.js$/.test(d));
const css = dateien.filter((d) => d.endsWith('.css'));

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
const precache = [...sw.matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]);
const precacheKb = precache.reduce((n, u) => {
  try {
    return n + statSync(join(dist, u)).size / 1024;
  } catch {
    return n;
  }
}, 0);

const werte = {
  'JavaScript (Start, gzip)': startJs.reduce((n, d) => n + gz(d), 0),
  'CSS (gzip)': css.reduce((n, d) => n + gz(d), 0),
  'Vorab gespeichert gesamt (roh)': precacheKb,
};

let ok = true;
for (const [name, grenze] of Object.entries(BUDGET_KB)) {
  const wert = werte[name];
  const gut = wert <= grenze;
  ok &&= gut;
  console.log(`${gut ? '✓' : '✗'} ${name}: ${wert.toFixed(1)} KB (Budget ${grenze} KB)`);
}
if (!html.includes('/assets/index-')) {
  console.log('✗ index.html verweist nicht auf das Start-Bundle');
  ok = false;
}
process.exit(ok ? 0 : 1);
