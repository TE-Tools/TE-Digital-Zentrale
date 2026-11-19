export const AUFGABEN_STATUS = [
  'neu',
  'geplant',
  'wartend',
  'zugewiesen',
  'in_bearbeitung',
  'pruefung',
  'freigabe_erforderlich',
  'blockiert',
  'abgeschlossen',
  'abgebrochen',
] as const;
export type AufgabenStatus = (typeof AUFGABEN_STATUS)[number];

/**
 * Erlaubte manuelle Statuswechsel.
 * „freigabe_erforderlich“ wird nur über die Entscheidung der Freigabe verlassen (oder Abbruch) –
 * Stufe-3-Arbeiten dürfen ohne Freigabe nicht weiterlaufen (Pflichtenheft 3).
 */
export const UEBERGAENGE: Record<AufgabenStatus, AufgabenStatus[]> = {
  neu: ['geplant', 'zugewiesen', 'wartend', 'in_bearbeitung', 'abgebrochen'],
  geplant: ['zugewiesen', 'wartend', 'in_bearbeitung', 'abgebrochen'],
  wartend: ['geplant', 'zugewiesen', 'in_bearbeitung', 'blockiert', 'abgebrochen'],
  zugewiesen: ['in_bearbeitung', 'wartend', 'blockiert', 'abgebrochen'],
  in_bearbeitung: ['pruefung', 'wartend', 'blockiert', 'freigabe_erforderlich', 'abgeschlossen', 'abgebrochen'],
  pruefung: ['in_bearbeitung', 'freigabe_erforderlich', 'abgeschlossen', 'blockiert', 'abgebrochen'],
  freigabe_erforderlich: ['abgebrochen'],
  blockiert: ['in_bearbeitung', 'wartend', 'zugewiesen', 'abgebrochen'],
  abgeschlossen: ['in_bearbeitung'],
  abgebrochen: ['neu'],
};

export function istErlaubt(von: AufgabenStatus, nach: AufgabenStatus): boolean {
  return von === nach || UEBERGAENGE[von].includes(nach);
}

export const OFFEN: AufgabenStatus[] = AUFGABEN_STATUS.filter((s) => s !== 'abgeschlossen' && s !== 'abgebrochen');
