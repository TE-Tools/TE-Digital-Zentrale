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
  };
  mitarbeiter: Mitarbeiter[];
  projekte: { slug: string; name: string; kurz: string; farbe: string; status: ProjektStatus; offen: number; fertig: number; blockiert: number }[];
  freigaben: Freigabe[];
  aktivitaeten: Aktivitaet[];
}
