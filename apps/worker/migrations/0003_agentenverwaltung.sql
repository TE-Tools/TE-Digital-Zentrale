-- Phase 3: Agentenverwaltung – Übergaben, Checkpoints, Kommunikation, Abhängigkeiten, laufende Nummern

CREATE TABLE zaehler (
  name  TEXT PRIMARY KEY,
  wert  INTEGER NOT NULL
);
INSERT INTO zaehler (name, wert) VALUES ('aufgabe', 0), ('freigabe', 0), ('entscheidung', 0);

-- Standardisiertes Übergabepaket (Pflichtenheft 6.3), 1:1 zur Aufgabe
CREATE TABLE uebergaben (
  aufgabe_id          TEXT PRIMARY KEY REFERENCES aufgaben(id) ON DELETE CASCADE,
  ziel                TEXT NOT NULL DEFAULT '',
  ausgangslage        TEXT NOT NULL DEFAULT '',
  dateien             TEXT NOT NULL DEFAULT '',
  ergebnis_soll       TEXT NOT NULL DEFAULT '',
  einschraenkungen    TEXT NOT NULL DEFAULT '',
  akzeptanzkriterien  TEXT NOT NULL DEFAULT '',
  freigaben           TEXT NOT NULL DEFAULT '',
  aktualisiert_am     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE aufgaben_abhaengigkeiten (
  aufgabe_id     TEXT NOT NULL REFERENCES aufgaben(id) ON DELETE CASCADE,
  haengt_ab_von  TEXT NOT NULL REFERENCES aufgaben(id) ON DELETE CASCADE,
  PRIMARY KEY (aufgabe_id, haengt_ab_von),
  CHECK (aufgabe_id <> haengt_ab_von)
);
CREATE INDEX idx_abh_von ON aufgaben_abhaengigkeiten(haengt_ab_von);

-- Zwischenstände: Grundlage für Fortsetzung nach Limit/Unterbrechung (Pflichtenheft 10, 11)
CREATE TABLE checkpoints (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  aufgabe_id         TEXT NOT NULL REFERENCES aufgaben(id) ON DELETE CASCADE,
  mitarbeiter_id     TEXT REFERENCES mitarbeiter(id),
  zusammenfassung    TEXT NOT NULL,
  naechste_schritte  TEXT NOT NULL DEFAULT '',
  grund              TEXT NOT NULL CHECK (grund IN ('zwischenstand', 'limit', 'abschluss', 'uebergabe')),
  zeit               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_checkpoints_aufgabe ON checkpoints(aufgabe_id, zeit DESC);

-- Zentrale Kommunikation (Pflichtenheft 6.2). von/an: Mitarbeiter-ID oder 'gf' (Geschäftsführung)
CREATE TABLE nachrichten (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  art           TEXT NOT NULL CHECK (art IN (
                  'aufgabenuebergabe', 'rueckfrage', 'ergebnisbericht', 'technische_empfehlung', 'warnung',
                  'entscheidungsvorschlag', 'pruefbericht', 'eskalation', 'information', 'notiz')),
  von           TEXT NOT NULL,
  an            TEXT,
  projekt_slug  TEXT REFERENCES projekte(slug),
  aufgabe_id    TEXT REFERENCES aufgaben(id) ON DELETE SET NULL,
  inhalt        TEXT NOT NULL,
  zeit          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  gelesen_am    TEXT
);
CREATE INDEX idx_nachrichten_zeit ON nachrichten(zeit DESC);
CREATE INDEX idx_nachrichten_aufgabe ON nachrichten(aufgabe_id, zeit);
CREATE INDEX idx_nachrichten_an ON nachrichten(an, gelesen_am);

ALTER TABLE entscheidungen ADD COLUMN alternativen TEXT NOT NULL DEFAULT '';
ALTER TABLE entscheidungen ADD COLUMN freigabe_id TEXT REFERENCES freigaben(id);
CREATE INDEX idx_entscheidungen_zeit ON entscheidungen(zeit DESC);
CREATE INDEX idx_freigaben_aufgabe ON freigaben(aufgabe_id);

-- Entscheidungen sind Protokoll: unveränderlich (Korrektur = neuer Eintrag)
CREATE TRIGGER entscheidungen_unveraenderlich_update BEFORE UPDATE ON entscheidungen
BEGIN SELECT RAISE(ABORT, 'Entscheidungen sind unveränderlich'); END;
CREATE TRIGGER entscheidungen_unveraenderlich_delete BEFORE DELETE ON entscheidungen
BEGIN SELECT RAISE(ABORT, 'Entscheidungen sind unveränderlich'); END;
