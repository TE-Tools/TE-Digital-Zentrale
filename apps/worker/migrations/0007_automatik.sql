-- Automatik: KI-Mitarbeiter arbeiten Aufträge selbstständig ab (ohne Kopieren)
--   workers_ai    → Cloudflare Workers AI im eigenen Konto (Gratis-Kontingent, danach Pause)
--   github_claude → Claude Code per GitHub Actions mit dem Claude-Abo (OAuth-Token, keine API-Kosten)

ALTER TABLE mitarbeiter ADD COLUMN automatik TEXT CHECK (automatik IN ('workers_ai', 'github_claude'));

UPDATE mitarbeiter SET automatik = 'github_claude' WHERE id = 'technik';

INSERT OR IGNORE INTO mitarbeiter (id, name, rolle, anbieter, zugang, arbeitsweg, farbe, sortierung, automatik, status)
VALUES ('assistent', 'Assistent', 'Assistenz: Entwürfe, Zusammenfassungen, Recherche-Vorbereitung', 'flexibel', 'kostenlos', 'paket',
        '#F38020', 45, 'workers_ai', 'verfuegbar');

-- Jeder automatische Durchlauf einer Aufgabe – Grundlage der Live-Anzeige „was passiert gerade“
CREATE TABLE ki_laeufe (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  aufgabe_id      TEXT NOT NULL REFERENCES aufgaben(id) ON DELETE CASCADE,
  mitarbeiter_id  TEXT NOT NULL REFERENCES mitarbeiter(id),
  art             TEXT NOT NULL CHECK (art IN ('workers_ai', 'github_claude')),
  modus           TEXT NOT NULL DEFAULT 'voll' CHECK (modus IN ('voll', 'fortsetzung')),
  status          TEXT NOT NULL DEFAULT 'wartet'
                  CHECK (status IN ('wartet', 'laeuft', 'fertig', 'fehler', 'limit', 'abgebrochen')),
  meldung         TEXT NOT NULL DEFAULT '',
  repo            TEXT,
  extern_url      TEXT,
  erstellt_am     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  gestartet_am    TEXT,
  aktualisiert_am TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  beendet_am      TEXT
);
CREATE INDEX idx_ki_laeufe_status ON ki_laeufe(status);
CREATE INDEX idx_ki_laeufe_aufgabe ON ki_laeufe(aufgabe_id, id DESC);
