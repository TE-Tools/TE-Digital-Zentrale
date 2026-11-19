// Erzeugt den Startbestand des Unternehmenswissens aus firma/**/*.md und schreibt ihn
// an das Ende von apps/worker/migrations/0006_wissen_berichte.sql (ab der Markierung STARTBESTAND).
// Nur vor dem ersten Einspielen der Migration verwenden – Migrationen werden danach nicht mehr geändert.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = fileURLToPath(new URL('..', import.meta.url));
const firma = join(wurzel, 'firma');
const migration = join(wurzel, 'apps/worker/migrations/0006_wissen_berichte.sql');

function dateien(ordner) {
  return readdirSync(ordner).flatMap((n) => {
    const p = join(ordner, n);
    return statSync(p).isDirectory() ? dateien(p) : n.endsWith('.md') && n !== 'README.md' ? [p] : [];
  });
}

const sql = (t) => `'${String(t).replace(/'/g, "''")}'`;

const zeilen = dateien(firma)
  .sort()
  .map((pfad) => {
    const roh = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n');
    const m = roh.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) throw new Error(`Kopfbereich fehlt: ${pfad}`);
    const kopf = Object.fromEntries(
      m[1].split('\n').map((z) => {
        const i = z.indexOf(':');
        return [z.slice(0, i).trim(), z.slice(i + 1).trim()];
      }),
    );
    const quelle = relative(wurzel, pfad).replace(/\\/g, '/');
    return `(NULL, ${sql(kopf.kategorie)}, ${sql(kopf.titel)}, ${sql(kopf.zusammenfassung)}, ${sql(m[2].trim())}, ${sql(kopf.tags ?? '')}, ${sql(quelle)})`;
  });

const marke = '-- STARTBESTAND';
const alt = readFileSync(migration, 'utf8');
const kopfteil = alt.slice(0, alt.indexOf(marke));
const neu =
  kopfteil +
  `${marke} (erzeugt aus firma/*.md mit: node scripts/firma-zu-sql.mjs)\n` +
  `INSERT INTO wissen (projekt_slug, kategorie, titel, zusammenfassung, inhalt, tags, quelle) VALUES\n${zeilen.join(',\n')};\n\n` +
  `INSERT INTO wissen_versionen (wissen_id, version, titel, zusammenfassung, inhalt, geaendert_von, geaendert_am)\n` +
  `  SELECT id, 1, titel, zusammenfassung, inhalt, 'system', erstellt_am FROM wissen;\n`;
writeFileSync(migration, neu);
console.log(`${zeilen.length} Wissensartikel in ${relative(wurzel, migration)} geschrieben`);
