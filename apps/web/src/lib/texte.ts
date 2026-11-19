import type { AufgabenStatus, NachrichtenArt, Prioritaet, Pruefstatus } from './typen';

type Ton = 'ok' | 'warn' | 'krit' | 'info' | 'gold' | '';

export const AUFGABEN_STATUS: Record<AufgabenStatus, { text: string; ton: Ton }> = {
  neu: { text: 'Neu', ton: '' },
  geplant: { text: 'Geplant', ton: '' },
  wartend: { text: 'Wartend', ton: 'warn' },
  zugewiesen: { text: 'Zugewiesen', ton: 'info' },
  in_bearbeitung: { text: 'In Bearbeitung', ton: 'info' },
  pruefung: { text: 'Prüfung', ton: 'gold' },
  freigabe_erforderlich: { text: 'Freigabe erforderlich', ton: 'gold' },
  blockiert: { text: 'Blockiert', ton: 'krit' },
  abgeschlossen: { text: 'Abgeschlossen', ton: 'ok' },
  abgebrochen: { text: 'Abgebrochen', ton: '' },
};

/** Spiegelt die Regeln des Servers (apps/worker/src/lib/status.ts) für die Bedienung. */
export const UEBERGAENGE: Record<AufgabenStatus, AufgabenStatus[]> = {
  neu: ['geplant', 'zugewiesen', 'wartend', 'in_bearbeitung', 'abgebrochen'],
  geplant: ['zugewiesen', 'wartend', 'in_bearbeitung', 'abgebrochen'],
  wartend: ['geplant', 'zugewiesen', 'in_bearbeitung', 'blockiert', 'abgebrochen'],
  zugewiesen: ['in_bearbeitung', 'wartend', 'blockiert', 'abgebrochen'],
  in_bearbeitung: ['pruefung', 'wartend', 'blockiert', 'abgeschlossen', 'abgebrochen'],
  pruefung: ['in_bearbeitung', 'abgeschlossen', 'blockiert', 'abgebrochen'],
  freigabe_erforderlich: ['abgebrochen'],
  blockiert: ['in_bearbeitung', 'wartend', 'zugewiesen', 'abgebrochen'],
  abgeschlossen: ['in_bearbeitung'],
  abgebrochen: ['neu'],
};

export const PRIORITAET: Record<Prioritaet, { text: string; ton: Ton }> = {
  niedrig: { text: 'Niedrig', ton: '' },
  normal: { text: 'Normal', ton: '' },
  hoch: { text: 'Hoch', ton: 'warn' },
  kritisch: { text: 'Kritisch', ton: 'krit' },
};

export const PRUEFSTATUS: Record<Pruefstatus, { text: string; ton: Ton }> = {
  offen: { text: 'Prüfung offen', ton: '' },
  bestanden: { text: 'Prüfung bestanden', ton: 'ok' },
  abgelehnt: { text: 'Prüfung abgelehnt', ton: 'krit' },
  nicht_noetig: { text: 'Keine Prüfung nötig', ton: '' },
};

export const NACHRICHTEN_ART: Record<NachrichtenArt, { text: string; ton: Ton }> = {
  aufgabenuebergabe: { text: 'Aufgabenübergabe', ton: 'info' },
  rueckfrage: { text: 'Rückfrage', ton: 'warn' },
  ergebnisbericht: { text: 'Ergebnisbericht', ton: 'ok' },
  technische_empfehlung: { text: 'Technische Empfehlung', ton: 'info' },
  warnung: { text: 'Warnung', ton: 'krit' },
  entscheidungsvorschlag: { text: 'Entscheidungsvorschlag', ton: 'gold' },
  pruefbericht: { text: 'Prüfbericht', ton: 'info' },
  eskalation: { text: 'Eskalation', ton: 'krit' },
  information: { text: 'Information', ton: '' },
  notiz: { text: 'Notiz', ton: '' },
};

export const FREIGABE_TYP: Record<string, string> = {
  kosten: 'Kosten',
  veroeffentlichung: 'Veröffentlichung',
  produktiv: 'Produktivsetzung',
  loeschung: 'Löschung',
  sicherheit: 'Sicherheit & Rechte',
  vertrag: 'Vertrag',
  sonstiges: 'Sonstiges',
};

/** Anzeigename für 'gf' oder eine Mitarbeiter-ID. */
export function teilnehmerName(id: string | null | undefined, mitarbeiter: { id: string; rolle: string; name: string }[] = []): string {
  if (!id) return 'Alle';
  if (id === 'gf') return 'Geschäftsführung';
  const m = mitarbeiter.find((x) => x.id === id);
  return m ? `${m.rolle} (${m.name})` : id;
}

/** Wandelt ISO in den Wert eines datetime-local-Feldes (lokale Zeit). */
export function zuLokalFeld(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
