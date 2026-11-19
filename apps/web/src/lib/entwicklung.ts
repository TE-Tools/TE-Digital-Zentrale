/** Gleiche Branch-Konvention wie im Worker (apps/worker/src/lib/pfade.ts) */
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

export const CHECKS = {
  unbekannt: { text: 'Checks ?', ton: '' },
  laeuft: { text: 'Checks laufen', ton: 'info' },
  erfolgreich: { text: 'Checks grün', ton: 'ok' },
  fehlgeschlagen: { text: 'Checks rot', ton: 'krit' },
} as const;

export const PR_ZUSTAND = {
  offen: { text: 'Offen', ton: 'info' },
  entwurf: { text: 'Entwurf', ton: '' },
  gemerged: { text: 'Gemerged', ton: 'ok' },
  geschlossen: { text: 'Geschlossen', ton: '' },
} as const;

export interface PullRequest {
  repo: string;
  nummer: number;
  titel: string;
  zustand: keyof typeof PR_ZUSTAND;
  branch: string;
  url: string;
  checks: keyof typeof CHECKS;
  aktualisiert_am: string;
  aufgabe_id?: string | null;
  aufgabe_titel?: string | null;
  autor?: string | null;
  dateien?: number | null;
  projekt_farbe?: string | null;
}

export interface Sperre {
  id: number;
  repo: string;
  pfade: string[];
  aufgabe_id?: string;
  aufgabe_titel?: string;
  inhaber_id: string;
  grund?: string;
  seit: string;
}
