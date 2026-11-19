export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  RP_NAME: string;
  /** WebAuthn Relying-Party-ID, z. B. "zentrale.te-alltagshelfer.org" bzw. lokal "localhost" */
  RP_ID: string;
  /** Kommagetrennte Liste erlaubter Origins für WebAuthn und Schreibzugriffe */
  ERLAUBTE_ORIGINS: string;
  /** Secret: einmaliger Code für die Ersteinrichtung */
  EINRICHTUNGSCODE?: string;
  /** Nur lokal: "1" erlaubt Anmeldung ohne Passkey auf localhost */
  DEV_LOGIN?: string;
}

export interface Benutzer {
  id: string;
  name: string;
  rolle: 'gf' | 'leser';
}

export interface SitzungsInfo {
  tokenHash: string;
  benutzer: Benutzer;
  bestaetigtAm: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    sitzung: SitzungsInfo | null;
  };
};
