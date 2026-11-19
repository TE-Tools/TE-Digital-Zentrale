export type Rolle = 'gf' | 'leser';
export interface Benutzer { id: string; name: string; rolle: Rolle }

export interface AuthStatus {
  eingerichtet: boolean;
  angemeldet: boolean;
  benutzer: Benutzer | null;
  bestaetigtAm: string | null;
  devLogin: boolean;
}

export type MitarbeiterStatus = 'unbekannt' | 'verfuegbar' | 'arbeitet' | 'wartend_limit' | 'pausiert';

export interface Mitarbeiter {
  id: string;
  name: string;
  rolle: string;
  anbieter: 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'flexibel';
  zugang: 'abo' | 'kostenlos' | 'flexibel';
  arbeitsweg: 'mcp' | 'paket' | 'github' | 'flexibel';
  status: MitarbeiterStatus;
  status_bestaetigt_am: string | null;
  limit_bis: string | null;
  farbe: string;
  aktuelle_aufgabe?: string | null;
}

export type ProjektStatus = 'aktiv' | 'geplant' | 'pausiert' | 'archiviert';

export interface Projekt {
  slug: string;
  name: string;
  kurz: string;
  beschreibung: string;
  ziele: string;
  repo_url: string | null;
  website_url: string | null;
  hosting: string;
  stack: string;
  farbe: string;
  status: ProjektStatus;
  sortierung: number;
  erstellt_am: string;
  aktualisiert_am: string;
  version: number;
  offene_aufgaben: number;
  blockiert: number;
  abgeschlossen: number;
  offene_freigaben: number;
}

export interface Aktivitaet {
  id: number;
  zeit: string;
  akteur_typ: 'benutzer' | 'mitarbeiter' | 'system';
  akteur_name: string | null;
  aktion: string;
  objekt_typ: string | null;
  objekt_id: string | null;
  projekt_slug?: string | null;
  details: string | null;
}

export interface Freigabe {
  id: string;
  typ: string;
  titel: string;
  projekt_slug: string | null;
  dringend: number;
  angefragt_am: string;
  angefragt_von: string | null;
}

export interface Dashboard {
  stand: string;
  status: 'ok' | 'warnung' | 'kritisch';
  zahlen: {
    in_arbeit: number;
    wartend: number;
    blockiert: number;
    heute_abgeschlossen: number;
    abgeschlossen: number;
    offene_freigaben: number;
    dringende_freigaben: number;
    in_pruefung: number;
    ungelesen: number;
    meldungen_ungelesen: number;
  };
  mitarbeiter: Mitarbeiter[];
  projekte: { slug: string; name: string; kurz: string; farbe: string; status: ProjektStatus; offen: number; fertig: number; blockiert: number }[];
  freigaben: Freigabe[];
  aktivitaeten: Aktivitaet[];
  fortsetzbar: { id: string; titel: string; projekt_slug: string; mitarbeiter: string; limit_bis: string }[];
  rueckfragen: { id: number; von: string; aufgabe_id: string | null; inhalt: string; zeit: string; aufgabe_titel: string | null }[];
}

// ---------------------------------------------------------------- Phase 3

export type AufgabenStatus =
  | 'neu' | 'geplant' | 'wartend' | 'zugewiesen' | 'in_bearbeitung' | 'pruefung'
  | 'freigabe_erforderlich' | 'blockiert' | 'abgeschlossen' | 'abgebrochen';
export type Prioritaet = 'niedrig' | 'normal' | 'hoch' | 'kritisch';
export type Pruefstatus = 'offen' | 'bestanden' | 'abgelehnt' | 'nicht_noetig';

export interface AufgabeKurz {
  id: string;
  titel: string;
  projekt_slug: string;
  projekt_name: string;
  projekt_farbe: string;
  zustaendig_id: string | null;
  zustaendig_name: string | null;
  zustaendig_rolle: string | null;
  prioritaet: Prioritaet;
  status: AufgabenStatus;
  pruefstatus: Pruefstatus;
  erstellt_am: string;
  aktualisiert_am: string;
  offene_abhaengigkeiten: number;
}

export interface Uebergabe {
  ziel: string;
  ausgangslage: string;
  dateien: string;
  ergebnis_soll: string;
  einschraenkungen: string;
  akzeptanzkriterien: string;
  freigaben: string;
}

export interface Checkpoint {
  id: number;
  mitarbeiter_id: string | null;
  zusammenfassung: string;
  naechste_schritte: string;
  grund: 'zwischenstand' | 'limit' | 'abschluss' | 'uebergabe';
  zeit: string;
}

export type NachrichtenArt =
  | 'aufgabenuebergabe' | 'rueckfrage' | 'ergebnisbericht' | 'technische_empfehlung' | 'warnung'
  | 'entscheidungsvorschlag' | 'pruefbericht' | 'eskalation' | 'information' | 'notiz';

export interface Nachricht {
  id: number;
  art: NachrichtenArt;
  von: string;
  an: string | null;
  projekt_slug: string | null;
  aufgabe_id: string | null;
  inhalt: string;
  zeit: string;
  gelesen_am: string | null;
  aufgabe_titel?: string | null;
  projekt_name?: string | null;
  projekt_farbe?: string | null;
}

export interface FreigabeVoll extends Freigabe {
  begruendung: string;
  status: 'offen' | 'erteilt' | 'abgelehnt' | 'zurueckgezogen';
  aufgabe_id: string | null;
  entschieden_am: string | null;
  kommentar: string | null;
  projekt_name?: string | null;
  projekt_farbe?: string | null;
  aufgabe_titel?: string | null;
}

export interface Entscheidung {
  id: string;
  stufe: 1 | 2 | 3;
  titel: string;
  begruendung: string;
  alternativen: string;
  projekt_slug: string | null;
  aufgabe_id: string | null;
  von: string;
  zeit: string;
  freigabe_id: string | null;
  projekt_name?: string | null;
  projekt_farbe?: string | null;
}

export interface AufgabeDetailDaten {
  aufgabe: AufgabeKurz & {
    beschreibung: string;
    ergebnis: string;
    branch: string | null;
    pr_url: string | null;
    version: number;
    abgeschlossen_am: string | null;
    zustaendig_status: string | null;
    zustaendig_limit_bis: string | null;
  };
  uebergabe: Uebergabe | null;
  abhaengig_von: { id: string; titel: string; status: AufgabenStatus }[];
  blockiert_fuer: { id: string; titel: string; status: AufgabenStatus }[];
  checkpoints: Checkpoint[];
  nachrichten: Nachricht[];
  freigaben: FreigabeVoll[];
  entscheidungen: Entscheidung[];
  pull_requests: import('./entwicklung').PullRequest[];
  sperren: import('./entwicklung').Sperre[];
}

export interface Paket {
  modus: 'voll' | 'fortsetzung';
  text: string;
  zeichen: number;
  warnungen: string[];
}
