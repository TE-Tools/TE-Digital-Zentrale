// Erzeugt App-Icons und Favicon aus den Marken-SVGs in /marke.
// Aufruf: npm run icons
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const pfad = (p) => fileURLToPath(new URL(p, import.meta.url));
const ziel = pfad('../apps/web/public/icons/');
mkdirSync(ziel, { recursive: true });

const kachel = readFileSync(pfad('../marke/logo-kachel.svg'));
const maskable = readFileSync(pfad('../marke/logo-maskable.svg'));

const auftraege = [
  [kachel, 'icon-192.png', 192],
  [kachel, 'icon-512.png', 512],
  [maskable, 'icon-maskable-512.png', 512],
  [maskable, 'apple-touch-icon.png', 180], // iOS rundet selbst ab -> vollflächige Variante
];

for (const [svg, name, groesse] of auftraege) {
  await sharp(svg, { density: 384 }).resize(groesse, groesse).png({ compressionLevel: 9 }).toFile(ziel + name);
  console.log('erzeugt', name);
}
// Monochromes Badge für die Statusleiste (Android): weißes Zeichen auf transparent
const badge = Buffer.from(readFileSync(pfad('../marke/logo-mono.svg'), 'utf8').replace(/currentColor/g, '#ffffff'));
await sharp(badge, { density: 384 }).resize(96, 96).png().toFile(ziel + 'badge-96.png');
console.log('erzeugt badge-96.png');
copyFileSync(pfad('../marke/logo-kachel.svg'), pfad('../apps/web/public/favicon.svg'));
console.log('erzeugt favicon.svg');
