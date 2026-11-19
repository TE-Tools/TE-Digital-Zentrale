/**
 * Pfadmuster für Sperren und Konflikterkennung.
 * Unterstützt: exakte Datei ("web/index.html"), Ordner ("worker/src/" oder "worker/src/**"),
 * Platzhalter am Ende ("web/*.css"). Alles ab dem ersten * wird als Präfix behandelt – bewusst
 * grob: Im Zweifel lieber eine Überschneidung zu viel melden als eine übersehen.
 */

function normal(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\.?\//, '');
}

export function istMuster(p: string): boolean {
  const n = normal(p);
  return n.includes('*') || n.endsWith('/') || n === '';
}

export function praefix(p: string): string {
  const n = normal(p);
  const stern = n.indexOf('*');
  return stern === -1 ? n : n.slice(0, stern);
}

/** Überschneiden sich zwei Muster (oder Dateien)? */
export function ueberschneiden(a: string, b: string): boolean {
  const na = normal(a);
  const nb = normal(b);
  if (!istMuster(na) && !istMuster(nb)) return na === nb;
  const pa = praefix(na);
  const pb = praefix(nb);
  if (!istMuster(na)) return na.startsWith(pb);
  if (!istMuster(nb)) return nb.startsWith(pa);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

export function listenUeberschneidung(a: string[], b: string[]): string[] {
  const treffer = new Set<string>();
  for (const x of a) for (const y of b) if (ueberschneiden(x, y)) treffer.add(istMuster(x) ? y : x);
  return [...treffer];
}

/** Branch-Konvention: aufgabe/td-0007-kurztitel → TD-0007 */
export function aufgabeAusBranch(branch: string): string | null {
  const m = branch.match(/td-?(\d{4,})/i);
  return m ? `TD-${m[1]}` : null;
}

export function branchVorschlag(id: string, titel: string): string {
  const kurz = titel
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `aufgabe/${id.toLowerCase()}${kurz ? '-' + kurz : ''}`;
}
