# Abnahmeprotokoll – TE-Digital Zentrale (Pflichtenheft Kap. 18)

Stand: 19.11.2026 · Phase 7 · erstellt von Claude Code (technische Leitung) zur Prüfung durch die Geschäftsführung.

Legende: ✅ erfüllt und automatisiert geprüft · 🟡 umgesetzt, Bestätigung erst nach Produktivsetzung bzw. auf echtem Gerät möglich · ⬜ offen

| # | Kriterium | Status | Nachweis |
|---|---|---|---|
| 1 | PWA funktioniert auf Smartphone, Tablet und PC | ✅ / 🟡 | E2E-Tests Desktop (1366×860) und Handy (Pixel 7), kein waagerechtes Scrollen auf 11 Hauptseiten, Offline-Start. Auf echtem iPhone/Android nach Produktivsetzung bestätigen |
| 2 | Alle Geräte sehen denselben Datenbestand | ✅ | Eine D1-Datenbank (EU); Echtzeit-Verteilung per Durable Object (`push.test.ts` „verteilt Änderungen“); Versionsprüfung gegen Überschreiben |
| 3 | Aufträge können mobil erstellt werden | ✅ | E2E „Kompletter Auftrag“ auf Handy-Größe über das „+“ der unteren Navigation; Diktat; Teilen-Ziel (Android) |
| 4 | Aufgaben und Ergebnisse werden zentral gespeichert | ✅ | Aufgaben, Übergaben, Checkpoints, Ergebnisse, Nachrichten in D1; Rückführung per Einfügen, Teilen oder MCP |
| 5 | KI-Mitarbeiter und Zuständigkeiten verwaltbar | ✅ | Mitarbeiterseite mit Status/Limit; Zuständigkeit je Aufgabe; Rollen im Unternehmenswissen; KI-Zugänge |
| 6 | Projekte voneinander getrennt | ✅ | Projektbereiche; KI-Zugänge projektbeschränkt (`entwicklung.test.ts`, `wissen.test.ts`) |
| 7 | Statusmeldungen zentral angezeigt | ✅ | Dashboard, Mitarbeiterstatus mit „zuletzt bestätigt“, Push, Posteingang |
| 8 | Entscheidungen und Freigaben nachvollziehbar | ✅ | Unveränderliches Entscheidungsprotokoll und Audit; Stufe 3 nur mit Passkey (`agenten.test.ts`, `sicherheit.test.ts`) |
| 9 | Push auf unterstützten Geräten | ✅ / 🟡 | Verschlüsselung per Browser-Entschlüsselung getestet; Zustellung auf echtem Gerät nach Produktivsetzung bestätigen (iOS: nur als Home-Bildschirm-App) |
| 10 | Erreichbar bei ausgeschaltetem Heim-PC | 🟡 | Betrieb vollständig auf Cloudflare; mit der Produktivsetzung erfüllt |
| 11 | Keine kostenpflichtigen KI-API-Aufrufe | ✅ | Kein KI-SDK und kein KI-API-Endpunkt im Code; nur Claude-Abo (MCP) und kostenlose Web-Zugänge per Übergabepaket |
| 12 | Entwicklungsaufträge an Claude Code (Cloud/lokal) übergeben | ✅ / 🟡 | MCP-Server mit 18 Werkzeugen, Ablauf getestet; Claude-Code-Übergabe in der Aufgabe; Anbindung echter Claude-Code-Sitzung nach Produktivsetzung bestätigen |
| 13 | Git-Konflikte erkannt und kontrolliert | ✅ | Branch je Aufgabe, exklusive Sperren, Erkennung überlappender PRs, kein Merge-Recht der App (`entwicklung.test.ts`) – GitHub-Verbindung selbst nach Produktivsetzung einrichten |
| 14 | TE-Digital-Branding erkennbar | ✅ | Gestaltung nach te-alltagshelfer.org (Gold, Papier, Space Grotesk/Inter, Projektfarben), Logo als App-Icon |
| 15 | Datenschutz und Sicherheit dokumentiert und geprüft | ✅ / ⬜ | `docs/datenschutz/` (Verzeichnis, TOM, Löschkonzept, Auftragsverarbeiter); Sicherheitstests; **offen:** Checkliste Auftragsverarbeiter abhaken (Geschäftsführung) |

## Prüfergebnisse (19.11.2026, lokal)

| Prüfung | Ergebnis |
|---|---|
| Worker-Tests (workerd) | 89/89 bestanden |
| Web-Tests | 13/13 bestanden |
| E2E Desktop + Handy (Playwright) | 13/13 bestanden (1 Test nur Handy) |
| Typprüfung Worker, Web, Service Worker | fehlerfrei |
| Performance-Budget | JS 56 KB, CSS 7 KB (gzip), Offline-Paket 437 KB – innerhalb des Budgets |
| `npm audit` (Produktionsabhängigkeiten) | 0 Schwachstellen; 4 „moderat“ nur in Build-Werkzeugen (workbox-build → glob/minimatch), nicht ausgeliefert |
| Wiederherstellungstest | Sicherung in leere Datenbank eingespielt, alle Kerntabellen vollständig, Audit-Schutz aktiv |
| Sicherheitstests | Rollen/Rechte, KI-Whitelist, Cookie-Flags, CSRF, Fehlermeldungen, Drosselung, Header/CSP |

## Bekannte Einschränkungen

- **Claude.ai (Web/App) als MCP-Konnektor** erfordert OAuth – noch nicht umgesetzt; Claude Code funktioniert per Token.
- **Echte Passkey-, Push- und GitHub-Abläufe** sind nur ohne echtes Gerät bzw. ohne öffentliche Adresse getestet (Unit-/Integrationstests, Entwicklungszugang).
- **Kostenwächter:** Abfrage gegen eine Beispielantwort getestet; gegen die Cloudflare-API nach der Einrichtung prüfen.
- **ChatGPT, Gemini, Grok** arbeiten mangels API bewusst über Übergabepakete (Kap. 6 des Plans).

## Freigabe

Die Produktivsetzung ist eine Stufe-3-Entscheidung der Geschäftsführung. Ablauf: `docs/Betrieb.md` → „Erstmalige Produktivsetzung“.

☐ Freigegeben durch die Geschäftsführung am ____________
