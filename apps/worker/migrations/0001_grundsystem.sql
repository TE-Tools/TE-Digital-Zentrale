-- TE-Digital Zentrale – Grundsystem (Phase 2)
-- Zeitstempel: ISO-8601 in UTC als TEXT. IDs: lesbare Texte, wo sinnvoll.

-- ---------- Menschen & Anmeldung ----------
CREATE TABLE benutzer (
  id            TEXT PRIMARY KEY,                      -- zufällig, base64url
  name          TEXT NOT NULL,
  rolle         TEXT NOT NULL CHECK (rolle IN ('gf', 'leser')),
  erstellt_am   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE passkeys (
  id            TEXT PRIMARY KEY,                      -- Credential-ID (base64url)
  benutzer_id   TEXT NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL,                         -- base64url (COSE)
  zaehler       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,                                  -- JSON-Array
  geraet        TEXT,                                  -- frei wählbarer Name
  erstellt_am   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  zuletzt_am    TEXT
);
CREATE INDEX idx_passkeys_benutzer ON passkeys(benutzer_id);

CREATE TABLE wiederherstellungscodes (
  hash          TEXT PRIMARY KEY,                      -- SHA-256 hex
  benutzer_id   TEXT NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  verwendet_am  TEXT
);

CREATE TABLE auth_challenges (
  id            TEXT PRIMARY KEY,
  zweck         TEXT NOT NULL CHECK (zweck IN ('einrichtung', 'anmeldung', 'passkey')),
  challenge     TEXT NOT NULL,
  benutzer_id   TEXT,
  daten         TEXT,                                  -- JSON (z. B. Name bei Einrichtung)
  ablauf_am     TEXT NOT NULL
);

CREATE TABLE sitzungen (
  token_hash    TEXT PRIMARY KEY,                      -- SHA-256 hex des Cookie-Tokens
  benutzer_id   TEXT NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  erstellt_am   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ablauf_am     TEXT NOT NULL,
  bestaetigt_am TEXT,                                  -- letzte Passkey-Bestätigung (Step-up für Stufe 3)
  geraet        TEXT
);
CREATE INDEX idx_sitzungen_benutzer ON sitzungen(benutzer_id);

-- ---------- Projekte ----------
CREATE TABLE projekte (
  slug            TEXT PRIMARY KEY CHECK (slug GLOB '[a-z0-9]*' AND length(slug) BETWEEN 2 AND 40),
  name            TEXT NOT NULL,
  kurz            TEXT NOT NULL DEFAULT '',
  beschreibung    TEXT NOT NULL DEFAULT '',
  ziele           TEXT NOT NULL DEFAULT '',
  repo_url        TEXT,
  website_url     TEXT,
  hosting         TEXT NOT NULL DEFAULT '',
  stack           TEXT NOT NULL DEFAULT '',
  farbe           TEXT NOT NULL DEFAULT '#C8912A' CHECK (length(farbe) = 7 AND substr(farbe, 1, 1) = '#'),  -- Hex-Prüfung zusätzlich in der API
  status          TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'geplant', 'pausiert', 'archiviert')),
  sortierung      INTEGER NOT NULL DEFAULT 100,
  erstellt_am     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  aktualisiert_am TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  version         INTEGER NOT NULL DEFAULT 1
);

-- ---------- KI-Mitarbeiter ----------
CREATE TABLE mitarbeiter (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  rolle               TEXT NOT NULL,
  anbieter            TEXT NOT NULL CHECK (anbieter IN ('chatgpt', 'claude', 'gemini', 'grok', 'flexibel')),
  zugang              TEXT NOT NULL CHECK (zugang IN ('abo', 'kostenlos', 'flexibel')),
  arbeitsweg          TEXT NOT NULL CHECK (arbeitsweg IN ('mcp', 'paket', 'github', 'flexibel')),
  status              TEXT NOT NULL DEFAULT 'unbekannt'
                      CHECK (status IN ('unbekannt', 'verfuegbar', 'arbeitet', 'wartend_limit', 'pausiert')),
  status_bestaetigt_am TEXT,
  limit_bis           TEXT,
  farbe               TEXT NOT NULL DEFAULT '#6E737C',
  sortierung          INTEGER NOT NULL DEFAULT 100,
  aktiv               INTEGER NOT NULL DEFAULT 1
);

-- ---------- Aufgaben (Grundlage, Ausbau in Phase 3) ----------
CREATE TABLE aufgaben (
  id              TEXT PRIMARY KEY,                    -- TD-0001
  projekt_slug    TEXT NOT NULL REFERENCES projekte(slug),
  titel           TEXT NOT NULL,
  beschreibung    TEXT NOT NULL DEFAULT '',
  zustaendig_id   TEXT REFERENCES mitarbeiter(id),
  prioritaet      TEXT NOT NULL DEFAULT 'normal' CHECK (prioritaet IN ('niedrig', 'normal', 'hoch', 'kritisch')),
  status          TEXT NOT NULL DEFAULT 'neu' CHECK (status IN (
                    'neu', 'geplant', 'wartend', 'zugewiesen', 'in_bearbeitung', 'pruefung',
                    'freigabe_erforderlich', 'blockiert', 'abgeschlossen', 'abgebrochen')),
  pruefstatus     TEXT NOT NULL DEFAULT 'offen' CHECK (pruefstatus IN ('offen', 'bestanden', 'abgelehnt', 'nicht_noetig')),
  ergebnis        TEXT NOT NULL DEFAULT '',
  branch          TEXT,
  pr_url          TEXT,
  erstellt_am     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  aktualisiert_am TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  abgeschlossen_am TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_aufgaben_status ON aufgaben(status);
CREATE INDEX idx_aufgaben_projekt ON aufgaben(projekt_slug, status);
CREATE INDEX idx_aufgaben_zustaendig ON aufgaben(zustaendig_id, status);

-- ---------- Freigaben & Entscheidungen (Grundlage, Ausbau in Phase 3) ----------
CREATE TABLE freigaben (
  id              TEXT PRIMARY KEY,
  typ             TEXT NOT NULL CHECK (typ IN ('kosten', 'veroeffentlichung', 'produktiv', 'loeschung', 'sicherheit', 'vertrag', 'sonstiges')),
  titel           TEXT NOT NULL,
  begruendung     TEXT NOT NULL DEFAULT '',
  projekt_slug    TEXT REFERENCES projekte(slug),
  aufgabe_id      TEXT REFERENCES aufgaben(id),
  angefragt_von   TEXT,
  status          TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'erteilt', 'abgelehnt', 'zurueckgezogen')),
  dringend        INTEGER NOT NULL DEFAULT 0,
  angefragt_am    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  entschieden_am  TEXT,
  entschieden_von TEXT,
  kommentar       TEXT
);
CREATE INDEX idx_freigaben_status ON freigaben(status);

CREATE TABLE entscheidungen (
  id              TEXT PRIMARY KEY,
  stufe           INTEGER NOT NULL CHECK (stufe IN (1, 2, 3)),
  titel           TEXT NOT NULL,
  begruendung     TEXT NOT NULL DEFAULT '',
  projekt_slug    TEXT REFERENCES projekte(slug),
  aufgabe_id      TEXT REFERENCES aufgaben(id),
  von             TEXT NOT NULL,
  zeit            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------- Audit-Protokoll (nur anhängen) ----------
CREATE TABLE aktivitaeten (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zeit          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  akteur_typ    TEXT NOT NULL CHECK (akteur_typ IN ('benutzer', 'mitarbeiter', 'system')),
  akteur_id     TEXT,
  akteur_name   TEXT,
  aktion        TEXT NOT NULL,
  objekt_typ    TEXT,
  objekt_id     TEXT,
  projekt_slug  TEXT,
  details       TEXT                                    -- JSON
);
CREATE INDEX idx_aktivitaeten_zeit ON aktivitaeten(zeit DESC);
CREATE INDEX idx_aktivitaeten_projekt ON aktivitaeten(projekt_slug, zeit DESC);

CREATE TRIGGER aktivitaeten_unveraenderlich_update BEFORE UPDATE ON aktivitaeten
BEGIN SELECT RAISE(ABORT, 'Audit-Protokoll ist unveränderlich'); END;
CREATE TRIGGER aktivitaeten_unveraenderlich_delete BEFORE DELETE ON aktivitaeten
BEGIN SELECT RAISE(ABORT, 'Audit-Protokoll ist unveränderlich'); END;
