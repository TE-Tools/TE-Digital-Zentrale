-- Phase 5: Entwicklungsintegration – GitHub-App, Repos, PRs/Branches, Sperren, KI-Zugänge (MCP)

-- Genau eine GitHub-App-Verbindung (von der Geschäftsführung selbst eingerichtet, Kap. 8.4)
CREATE TABLE github_verbindung (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  status             TEXT NOT NULL DEFAULT 'getrennt' CHECK (status IN ('getrennt', 'eingerichtet', 'installiert')),
  state              TEXT,                 -- einmaliges Token für den Manifest-Ablauf
  state_ablauf       TEXT,
  organisation       TEXT,
  app_id             INTEGER,
  app_slug           TEXT,
  app_url            TEXT,
  pem_verschluesselt TEXT,                 -- AES-GCM, Schlüssel nur als Worker-Secret
  webhook_verschluesselt TEXT,
  installation_id    INTEGER,
  eingerichtet_am    TEXT,
  installiert_am     TEXT,
  letzter_abgleich   TEXT,
  letzter_fehler     TEXT
);
INSERT INTO github_verbindung (id, status) VALUES (1, 'getrennt');

CREATE TABLE github_repos (
  full_name       TEXT PRIMARY KEY,                -- TE-Tools/orchester-orga
  privat          INTEGER NOT NULL DEFAULT 1,
  standard_branch TEXT NOT NULL DEFAULT 'main',
  url             TEXT NOT NULL,
  projekt_slug    TEXT REFERENCES projekte(slug) ON DELETE SET NULL,
  aktualisiert_am TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Pull Requests (aus Webhooks und Abgleich)
CREATE TABLE github_prs (
  repo           TEXT NOT NULL REFERENCES github_repos(full_name) ON DELETE CASCADE,
  nummer         INTEGER NOT NULL,
  titel          TEXT NOT NULL,
  zustand        TEXT NOT NULL CHECK (zustand IN ('offen', 'entwurf', 'gemerged', 'geschlossen')),
  branch         TEXT NOT NULL,
  ziel_branch    TEXT NOT NULL,
  autor          TEXT,
  url            TEXT NOT NULL,
  checks         TEXT NOT NULL DEFAULT 'unbekannt' CHECK (checks IN ('unbekannt', 'laeuft', 'erfolgreich', 'fehlgeschlagen')),
  head_sha       TEXT,
  dateien        TEXT,                           -- JSON-Liste geänderter Pfade (für Konflikterkennung)
  aufgabe_id     TEXT REFERENCES aufgaben(id) ON DELETE SET NULL,
  aktualisiert_am TEXT NOT NULL,
  PRIMARY KEY (repo, nummer)
);
CREATE INDEX idx_prs_aufgabe ON github_prs(aufgabe_id);
CREATE INDEX idx_prs_offen ON github_prs(zustand, repo);

-- Exklusive Sperren für konfliktträchtige Änderungen (Pflichtenheft 7.1)
CREATE TABLE repo_sperren (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repo         TEXT NOT NULL,
  pfade        TEXT NOT NULL,                   -- JSON-Liste von Pfadmustern, z. B. ["worker/src/**"]
  aufgabe_id   TEXT NOT NULL REFERENCES aufgaben(id) ON DELETE CASCADE,
  inhaber_id   TEXT NOT NULL,                   -- Mitarbeiter-ID oder 'gf'
  grund        TEXT NOT NULL DEFAULT '',
  seit         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  freigegeben_am TEXT
);
CREATE INDEX idx_sperren_aktiv ON repo_sperren(repo) WHERE freigegeben_am IS NULL;

-- Zugangstoken für KI-Mitarbeiter (MCP). Nur Hash gespeichert, Klartext wird einmal angezeigt.
CREATE TABLE ki_zugaenge (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mitarbeiter_id  TEXT NOT NULL REFERENCES mitarbeiter(id),
  bezeichnung     TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  token_anfang    TEXT NOT NULL,                 -- erste Zeichen zur Wiedererkennung
  projekte        TEXT,                          -- JSON-Liste erlaubter Projekt-Slugs, NULL = alle
  erstellt_am     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  erstellt_von    TEXT NOT NULL,
  zuletzt_am      TEXT,
  widerrufen_am   TEXT
);
