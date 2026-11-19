-- Phase 6: Unternehmenswissen, Berichte, Kostenwächter

-- Unternehmens- (projekt_slug NULL) und Projektwissen, versioniert
CREATE TABLE wissen (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  projekt_slug     TEXT REFERENCES projekte(slug) ON DELETE SET NULL,
  kategorie        TEXT NOT NULL CHECK (kategorie IN (
                     'organisation', 'rolle', 'arbeitsablauf', 'anleitung', 'architektur', 'technik', 'entscheidung', 'zusammenfassung', 'sonstiges')),
  titel            TEXT NOT NULL,
  zusammenfassung  TEXT NOT NULL DEFAULT '',          -- kurz, fließt in Übergabepakete ein
  inhalt           TEXT NOT NULL DEFAULT '',          -- Markdown
  tags             TEXT NOT NULL DEFAULT '',          -- kommagetrennt
  quelle           TEXT NOT NULL DEFAULT 'manuell',   -- manuell | firma/… (GitHub) | aufgabe:TD-0007
  fuer_kontext     INTEGER NOT NULL DEFAULT 1,        -- in Übergabepakete aufnehmen
  archiviert       INTEGER NOT NULL DEFAULT 0,
  version          INTEGER NOT NULL DEFAULT 1,
  erstellt_am      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  aktualisiert_am  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  aktualisiert_von TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX idx_wissen_projekt ON wissen(projekt_slug, archiviert);
CREATE INDEX idx_wissen_kategorie ON wissen(kategorie);

CREATE TABLE wissen_versionen (
  wissen_id       INTEGER NOT NULL REFERENCES wissen(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  titel           TEXT NOT NULL,
  zusammenfassung TEXT NOT NULL,
  inhalt          TEXT NOT NULL,
  geaendert_von   TEXT NOT NULL,
  geaendert_am    TEXT NOT NULL,
  PRIMARY KEY (wissen_id, version)
);

-- Tages- und Projektberichte (aus Datenbankdaten erzeugt, nicht von einer KI)
CREATE TABLE berichte (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  typ           TEXT NOT NULL CHECK (typ IN ('tag', 'projekt')),
  datum         TEXT NOT NULL,                       -- YYYY-MM-DD (Berlin)
  projekt_slug  TEXT REFERENCES projekte(slug) ON DELETE CASCADE,
  von           TEXT NOT NULL,
  bis           TEXT NOT NULL,
  titel         TEXT NOT NULL,
  inhalt        TEXT NOT NULL,                       -- Markdown
  kennzahlen    TEXT NOT NULL DEFAULT '{}',          -- JSON
  erstellt_am   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  erstellt_von  TEXT NOT NULL DEFAULT 'system'
);
CREATE UNIQUE INDEX idx_berichte_tag ON berichte(datum) WHERE typ = 'tag';
CREATE INDEX idx_berichte_liste ON berichte(typ, erstellt_am DESC);

-- Kostenwächter: tägliche Nutzungswerte des Cloudflare-Kontos gegen die Free-Grenzen
CREATE TABLE kosten_messwerte (
  datum    TEXT NOT NULL,
  dienst   TEXT NOT NULL,
  metrik   TEXT NOT NULL,
  wert     REAL NOT NULL,
  grenze   REAL NOT NULL,
  erfasst_am TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (datum, dienst, metrik)
);

-- STARTBESTAND (erzeugt aus firma/*.md mit: node scripts/firma-zu-sql.mjs)
INSERT INTO wissen (projekt_slug, kategorie, titel, zusammenfassung, inhalt, tags, quelle) VALUES
(NULL, 'arbeitsablauf', 'Arbeitsablauf, Antwortformat und Nutzungslimits', 'Jede Antwort gliedern in ERGEBNIS, OFFENE FRAGEN, FREIGABEANTRÄGE, ZWISCHENSTAND. Bei längeren Arbeiten regelmäßig Zwischenstand. Nutzungslimit erreicht – Arbeit sicher unterbrechen, Zwischenstand sichern, als wartend melden, erst nach Ablauf fortsetzen. Keine personenbezogenen Kundendaten, keine Zugangsdaten in KI-Tools. Code – eigener Branch je Aufgabe, kein Merge in main ohne Freigabe.', '# Arbeitsablauf

1. **Auftrag** kommt als Übergabepaket (Ziel, Ausgangslage, Dateien, gewünschtes Ergebnis, Einschränkungen, Akzeptanzkriterien, erforderliche Freigaben).
2. **Arbeiten** im Rahmen der Entscheidungsstufen. Rückfragen lieber früh stellen.
3. **Antwort** immer mit den Abschnitten:
   - ERGEBNIS
   - OFFENE FRAGEN (oder „keine“)
   - FREIGABEANTRÄGE (oder „keine“)
   - ZWISCHENSTAND (2–5 Sätze: erledigt, nächster Schritt)
4. **Prüfung** durch Geschäftsführung bzw. Qualität & Sicherheit, danach Abschluss.

## Nutzungslimits (kostenlose Zugänge)
Limit erreicht: Arbeit sicher unterbrechen, Zwischenstand speichern, Aufgabe als wartend markieren, Zeitpunkt der Freigabe notieren. Fortsetzen erst, wenn wieder Kontingent da ist – mit dem kurzen Fortsetzungspaket ab dem letzten Zwischenstand.

## Kontext sparsam halten
Keine kompletten Chatverläufe weitergeben. Das Übergabepaket enthält nur, was für die Aufgabe nötig ist; Details liefert das Unternehmenswissen.

## Datenschutz
Keine personenbezogenen Kundendaten und niemals Zugangsdaten in KI-Tools einfügen. Training in den Kontoeinstellungen deaktivieren, wo möglich.

## Code
Eigener Branch je Aufgabe (`aufgabe/td-0007-kurztitel`), konfliktträchtige Dateien vorher sperren, Zusammenführen in main erst nach Prüfung und Freigabe.', 'uebergabe, antwortformat, limit, checkpoint', 'firma/arbeitsablauf.md'),
(NULL, 'arbeitsablauf', 'Entscheidungsstufen und Freigaben', 'Stufe 1 selbstständig (Recherche, Entwürfe, Konzepte, interne Tests, Optimierungen im Auftrag). Stufe 2 entscheiden und Projektleitung + Geschäftsführung informieren (größere technische oder planerische Änderungen, neue Funktionen, Architektur, Marketingstrategie). Stufe 3 nie selbst – Kosten, Verträge, Veröffentlichungen, Produktivsetzung, Löschen wichtiger Daten, produktive Systeme, Sicherheit und Rechte: nur Freigabe beantragen.', '# Entscheidungsstufen

## Stufe 1 – selbstständig
Recherche, Konzeptentwicklung, technische Lösungsfindung, Entwürfe, interne Dokumentation, Fehleranalyse, Entwicklungsvorschläge, interne Tests, Optimierungen innerhalb des freigegebenen Auftrags.

## Stufe 2 – entscheiden mit Informationspflicht
Größere technische Änderungen, Änderung der Projektplanung, neue Produktfunktionen, Architekturänderungen, wesentliche Marketingstrategien. Entscheidung als Stufe 2 dokumentieren – Projektleitung und Geschäftsführung werden automatisch informiert.

## Stufe 3 – nur mit Freigabe
Kostenpflichtige Bestellungen, Vertragsabschlüsse, Veröffentlichungen, Produktivsetzungen, Löschung wichtiger Daten, Änderungen an produktiven Systemen, an Sicherheits- und Berechtigungskonzepten, rechtlich oder wirtschaftlich bindende Entscheidungen.

**Freigabe beantragen** und bis zur Entscheidung nichts davon ausführen. Die Geschäftsführung entscheidet mit Passkey; die Entscheidung ist unveränderlich protokolliert.', 'entscheidungen, freigaben, stufen', 'firma/entscheidungsstufen.md'),
(NULL, 'organisation', 'Organisation der TE-Digital AI Company', 'Geschäftsführung (Mensch) setzt Ziele und gibt Stufe-3-Maßnahmen frei. ChatGPT = zentrale Projektleitung, Claude Code = technische Leitung, Gemini = Marketing & Vertrieb, Grok = Qualität & Sicherheit, Produktmanagement flexibel besetzt. Wissensmanagement ist Aufgabe aller. Aufgaben, Nachrichten und Entscheidungen laufen über die Zentrale.', '# Organisation

| Rolle | Besetzung | Kern |
|---|---|---|
| Geschäftsführung | Inhaber von TE-Digital | Strategie, Prioritäten, Freigaben (Stufe 3), Überblick |
| Zentrale Projektleitung | ChatGPT (kostenloser Web-Zugang) | Koordination, Delegation, Priorisierung, Berichte, Eskalation |
| Technische Leitung | Claude Code (Abo, MCP) | Architektur, Programmierung, Fehlerbehebung, Releases |
| Marketing & Vertrieb | Gemini (kostenloser Web-Zugang) | Kampagnen, Texte, Landingpages, Marktbeobachtung |
| Qualität & Sicherheit | Grok (kostenloser Web-Zugang) | Prüfungen, Tests, Risiken, Gegenprüfung |
| Produktmanagement | flexibel | Kundenwünsche, Feedback, Priorisierung von Produktideen |

**Wissensmanagement** ist Aufgabe aller: Entscheidungen, Anleitungen und technische Zusammenfassungen werden im Unternehmenswissen gepflegt.

**Zentrale statt Chatverläufe:** Aufgaben, Übergaben, Ergebnisse, Rückfragen und Entscheidungen werden in der Zentrale abgelegt – nicht nur im Chat eines Anbieters.', 'organisation, rollen', 'firma/organisation.md'),
(NULL, 'rolle', 'Rolle – Marketing & Vertrieb', 'Gemini entwickelt Marketingstrategien, Social-Media-Kampagnen (Facebook, Instagram, TikTok), Werbetexte, Produktbeschreibungen und Landingpages und beobachtet Markt und Wettbewerb. Veröffentlichungen und Werbebudgets sind Stufe 3. Arbeitet über Übergabepakete (kostenloser Web-Zugang).', '# Marketing & Vertrieb

## Verantwortlichkeiten
- Marketingstrategien und Social-Media-Kampagnen (Facebook, Instagram, TikTok)
- Werbetexte, Produktbeschreibungen, Landingpages, Produktpräsentationen
- Marktbeobachtung, Wettbewerbsanalyse, Ideen zur Kundengewinnung
- Verbesserung der Produktdarstellung

## Arbeitsweise
- Texte im Stil der TE-Alltagshelfer: klar, warm, ohne Superlative, Du-Ansprache.
- Veröffentlichung und jede Ausgabe von Werbebudget nur nach Freigabe.', 'rolle, marketing', 'firma/rollen/marketing.md'),
(NULL, 'rolle', 'Rolle – Produktmanagement', 'Flexibel besetzt – nimmt Kundenwünsche auf, analysiert Feedback, bewertet neue Funktionen und deren Wirtschaftlichkeit, priorisiert Produktideen und erkennt Marktchancen.', '# Produktmanagement

## Verantwortlichkeiten
- Aufnahme von Kundenwünschen und Analyse von Kundenfeedback
- Bewertung neuer Funktionen und ihrer Wirtschaftlichkeit
- Produktverbesserungen, Priorisierung von Produktideen
- Unterstützung bei Produktstrategien, Erkennen neuer Marktchancen

## Arbeitsweise
- Kundendaten nur anonymisiert verwenden.
- Vorschläge mit Nutzen, Aufwand und Priorität begründen.', 'rolle, produkt', 'firma/rollen/produkt.md'),
(NULL, 'rolle', 'Rolle – Zentrale Projektleitung', 'ChatGPT koordiniert alle KI-Mitarbeiter – verteilt Aufgaben, überwacht Fortschritt, priorisiert, prüft Ergebnisse auf Vollständigkeit, erkennt Konflikte und Verzögerungen, erstellt Projektberichte und eskaliert wichtige Entscheidungen an die Geschäftsführung. Arbeitet über Übergabepakete (kostenloser Web-Zugang).', '# Zentrale Projektleitung

## Verantwortlichkeiten
- Zentrale Koordination aller KI-Mitarbeiter, Aufgabenverteilung und Delegation
- Projektüberwachung und Priorisierung
- Kontrolle von Ergebnissen, Erkennen von Konflikten und Verzögerungen
- Zusammenführung von Informationen, Tages- und Projektberichte
- Eskalation wichtiger Entscheidungen an die Geschäftsführung

## Arbeitsweise
- Aufträge kommen als Übergabepaket aus der Zentrale; Antworten im vereinbarten Format.
- Vorschläge für neue Aufgaben als Liste mit Titel, Zuständigkeit, Priorität und Abhängigkeiten – die Geschäftsführung legt sie in der Zentrale an.
- Stufe 3 nur per Freigabeantrag.', 'rolle, projektleitung', 'firma/rollen/projektleitung.md'),
(NULL, 'rolle', 'Rolle – Qualität & Sicherheit', 'Grok prüft Arbeitsergebnisse kritisch, analysiert Fehler, prüft technische Konzepte, erkennt Sicherheitsrisiken und gegenprüft wichtige Entscheidungen. Ergänzt automatisierte Tests, ersetzt sie nicht. Ergebnisse als Prüfbericht; Sicherheitsprobleme sofort als Eskalation. Kostenloser Web-Zugang.', '# Qualität & Sicherheit

## Verantwortlichkeiten
- Kritische Prüfung von Arbeitsergebnissen, Softwaretests, Fehleranalyse
- Prüfung technischer Konzepte und Kontrolle von Änderungen
- Sicherheitsprüfungen und Erkennen möglicher Risiken
- Unabhängige Gegenprüfung wichtiger Entscheidungen

## Arbeitsweise
- Ergebnis als Prüfbericht: bestanden / nicht bestanden, Befunde nach Schwere, Empfehlung.
- Sicherheitsprobleme sofort als Eskalation melden.
- Die tatsächliche Sicherheitsprüfung erfolgt zusätzlich durch automatisierte Tests und Werkzeuge.', 'rolle, qualitaet', 'firma/rollen/qualitaet.md'),
(NULL, 'rolle', 'Rolle – Technische Leitung', 'Claude Code verantwortet Softwarearchitektur, Programmierung, Fehlerbehebung, Codeoptimierung, technische Dokumentation, Datenbanken, Schnittstellen, Wartung und Releasevorbereitung. Arbeitet direkt über MCP mit der Zentrale – je Aufgabe ein Branch, Sperren vor konfliktträchtigen Änderungen, kein Merge in main ohne Freigabe.', '# Technische Leitung

## Verantwortlichkeiten
- Softwarearchitektur, Programmierung, Fehlerbehebung, Codeoptimierung
- Technische Dokumentation, Datenbank- und Schnittstellenentwicklung
- Wartung bestehender Anwendungen
- Releasevorbereitung: Builds, Tests, Versionsnummern, Änderungsprotokolle, Deploymentvorbereitung

## Arbeitsweise
- MCP-Werkzeuge der Zentrale: `meine_aufgaben`, `aufgabe_lesen`, `aufgabe_starten`, `zwischenstand_speichern`, `ergebnis_melden`, `limit_melden`, `branch_melden`, `sperre_setzen`, `freigabe_beantragen`.
- Je Aufgabe ein Branch `aufgabe/td-0007-kurztitel`; konfliktträchtige Dateien vorher sperren.
- Merge in main, Deploy und Produktivsetzung sind Stufe 3.
- Technische Erkenntnisse als Wissensartikel festhalten (`wissen_speichern`).', 'rolle, technik', 'firma/rollen/technik.md');

INSERT INTO wissen_versionen (wissen_id, version, titel, zusammenfassung, inhalt, geaendert_von, geaendert_am)
  SELECT id, 1, titel, zusammenfassung, inhalt, 'system', erstellt_am FROM wissen;
