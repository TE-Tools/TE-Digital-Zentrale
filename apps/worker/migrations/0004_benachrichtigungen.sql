-- Phase 4: Push-Benachrichtigungen (Pflichtenheft 4.5)

-- Ein Eintrag je Gerät (Browser-Push-Abo)
CREATE TABLE push_abos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  benutzer_id  TEXT NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  geraet       TEXT NOT NULL DEFAULT '',
  origin       TEXT NOT NULL,
  erstellt_am  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  zuletzt_ok   TEXT,
  fehler_zahl  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_abos_benutzer ON push_abos(benutzer_id);

-- Einstellungen je Benutzer. Modus: sofort | gebuendelt (stündliche Zusammenfassung) | aus
CREATE TABLE benachrichtigungs_einstellungen (
  benutzer_id       TEXT PRIMARY KEY REFERENCES benutzer(id) ON DELETE CASCADE,
  kritisch          TEXT NOT NULL DEFAULT 'sofort' CHECK (kritisch IN ('sofort', 'aus')),
  wichtig           TEXT NOT NULL DEFAULT 'sofort' CHECK (wichtig IN ('sofort', 'gebuendelt', 'aus')),
  tagesbericht      INTEGER NOT NULL DEFAULT 1,
  tagesbericht_zeit TEXT NOT NULL DEFAULT '07:30',                -- lokale Zeit Europe/Berlin
  ruhe_von          TEXT,                                          -- z. B. '22:00' (kritisch ist ausgenommen)
  ruhe_bis          TEXT,                                          -- z. B. '07:00'
  letzter_tagesbericht TEXT                                        -- Datum (YYYY-MM-DD) des letzten Versands
);

-- Posteingang aller Benachrichtigungen (auch ohne Push sichtbar)
CREATE TABLE benachrichtigungen (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  benutzer_id   TEXT NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  kategorie     TEXT NOT NULL CHECK (kategorie IN ('kritisch', 'wichtig', 'tagesbericht')),
  titel         TEXT NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '/',
  schluessel    TEXT,                                              -- Entdoppelung (z. B. 'limit:TD-0001:2026-11-19T10:00')
  erstellt_am   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  push_status   TEXT NOT NULL DEFAULT 'offen' CHECK (push_status IN ('offen', 'gesendet', 'gebuendelt', 'unterdrueckt', 'kein_geraet')),
  gesendet_am   TEXT,
  gelesen_am    TEXT
);
CREATE INDEX idx_benachrichtigungen_benutzer ON benachrichtigungen(benutzer_id, erstellt_am DESC);
CREATE INDEX idx_benachrichtigungen_offen ON benachrichtigungen(push_status) WHERE push_status = 'offen';
CREATE UNIQUE INDEX idx_benachrichtigungen_schluessel ON benachrichtigungen(benutzer_id, schluessel) WHERE schluessel IS NOT NULL;

-- Selbst erzeugte VAPID-Schlüssel, falls keine Secrets gesetzt sind (einmal erzeugt, nie ersetzt)
CREATE TABLE system_schluessel (
  name   TEXT PRIMARY KEY,
  wert   TEXT NOT NULL,
  erstellt_am TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
