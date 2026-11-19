/**
 * Zerlegt eine eingefügte KI-Antwort in die vereinbarten Abschnitte
 * ERGEBNIS · OFFENE FRAGEN · FREIGABEANTRÄGE · ZWISCHENSTAND.
 * Überschriften dürfen mit #, *, ** oder Ziffern beginnen und mit „:“ enden.
 */
export interface Antwort {
  ergebnis: string;
  offeneFragen: string;
  freigabeantraege: string;
  zwischenstand: string;
  /** true, wenn mindestens eine der vereinbarten Überschriften gefunden wurde */
  strukturiert: boolean;
}

const ABSCHNITTE: [keyof Omit<Antwort, 'strukturiert'>, string][] = [
  ['ergebnis', 'ergebnis(?:se)?'],
  ['offeneFragen', 'offene\\s+fragen'],
  ['freigabeantraege', 'freigabe(?:antr(?:ä|ae)ge?|antrag)'],
  ['zwischenstand', 'zwischenstand'],
];

// Überschrift = Name allein auf der Zeile oder Name gefolgt von „:“ (sonst ist es normaler Fließtext)
const MUSTER = ABSCHNITTE.map(
  ([schluessel, name]) => [schluessel, new RegExp(`^(?:${name})\\s*(?:\\*{1,2})?\\s*(?::\\s*(?:\\*{1,2})?\\s*(.*)|$)`, 'iu')] as const,
);

function ueberschrift(zeile: string): { schluessel: keyof Omit<Antwort, 'strukturiert'>; rest: string } | null {
  const s = zeile.replace(/^\s*(?:#{1,6}\s*|\d+[.)]\s*)?\**\s*/, '').trimEnd();
  for (const [schluessel, re] of MUSTER) {
    const m = s.match(re);
    if (m) return { schluessel, rest: (m[1] ?? '').replace(/\*+$/, '').trim() };
  }
  return null;
}

export function zerlegeAntwort(text: string): Antwort {
  const out: Antwort = { ergebnis: '', offeneFragen: '', freigabeantraege: '', zwischenstand: '', strukturiert: false };
  const teile: Record<string, string[]> = { ergebnis: [], offeneFragen: [], freigabeantraege: [], zwischenstand: [] };
  let aktuell: keyof typeof teile = 'ergebnis';
  for (const zeile of text.replace(/\r\n/g, '\n').split('\n')) {
    const u = ueberschrift(zeile);
    if (u) {
      aktuell = u.schluessel;
      out.strukturiert = true;
      if (u.rest) teile[aktuell]!.push(u.rest);
    } else {
      teile[aktuell]!.push(zeile);
    }
  }
  for (const k of Object.keys(teile) as (keyof typeof teile)[]) {
    (out as unknown as Record<string, string>)[k] = teile[k]!.join('\n').trim();
  }
  return out;
}

/** „keine“, „-“, „nein“, „n/a“ usw. zählen nicht als Inhalt. */
export function hatInhalt(abschnitt: string): boolean {
  const t = abschnitt.trim().replace(/^[-*•\s]+/, '').toLowerCase();
  return t.length > 0 && !/^(keine?|nein|n\/a|–|-|entfällt|nicht erforderlich)\.?$/.test(t);
}
