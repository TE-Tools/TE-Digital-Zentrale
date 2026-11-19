# Technische und organisatorische Maßnahmen (Art. 32 DSGVO) – TE-Digital Zentrale

Stand: 19.11.2026. Jede Maßnahme ist im Code bzw. in Tests belegt (Spalte „Nachweis“).

| Bereich | Maßnahme | Nachweis |
|---|---|---|
| Zugangskontrolle | Anmeldung nur per **Passkey** (WebAuthn, Benutzerverifikation Pflicht) – phishing-resistent, mehrfaktorig, kein Passwort | `routes/auth.ts`, Tests `api.test.ts` |
| | Ersteinrichtung nur mit Einrichtungscode (Secret) und nur solange kein Benutzer existiert | `api.test.ts` „Ersteinrichtung“ |
| | 8 Wiederherstellungscodes, nur als SHA-256 gespeichert, je einmal nutzbar | `api.test.ts`, `sicherheit.test.ts` |
| | Drosselung: 10 Anmeldeversuche/Minute je Anschluss, MCP 120/Minute, Schreibzugriffe 120/Minute je Benutzer | `lib/drossel.ts`, `sicherheit.test.ts` „Drosselung“ |
| Sitzungen | Zufallstoken 256 Bit, nur Hash in der Datenbank; Cookie `__Host-`, HttpOnly, Secure, SameSite=Strict; 30 Tage; Abmelden entwertet serverseitig; abgelaufene werden stündlich gelöscht | `lib/sitzung.ts`, `sicherheit.test.ts` |
| Zugriffskontrolle | Rollen: Geschäftsführung (alles), Lesezugang (nur lesen), KI-Mitarbeiter (nur eigene Aufgaben in freigegebenen Projekten, über Routen-Whitelist **und** Prüfung je Route) | `lib/agent.ts`, `index.ts` (AGENT_WEGE), `sicherheit.test.ts` |
| | Stufe-3-Aktionen (Freigaben, KI-Zugänge anlegen, GitHub verbinden/trennen) nur mit frischer Passkey-Bestätigung (≤ 5 Min.) | `stepUpPflicht`, `agenten.test.ts`, `entwicklung.test.ts` |
| Weitergabekontrolle | HTTPS/HSTS; strenge CSP ohne fremde Quellen; Schriften selbst gehostet; CSRF-Schutz (Header + Origin + SameSite) | `public/_headers`, `web/src/sicherheit.test.ts`, `sicherheit.test.ts` |
| | Web Push Ende-zu-Ende verschlüsselt (RFC 8291), Klick öffnet nur eigene Adressen | `lib/webpush.ts`, `push.test.ts` |
| | GitHub-App ohne Schreibrecht auf Code; Schlüssel AES-GCM-verschlüsselt, Schlüssel nur als Worker-Secret; Webhooks HMAC-signiert | `lib/github.ts`, `entwicklung.test.ts` |
| | Warnung vor E-Mail-Adressen, Telefonnummern und Zugangsdaten in Übergabepaketen | `lib/paket.ts`, `logik.test.ts` |
| Eingabekontrolle | Unveränderliches Audit-Protokoll (Datenbank-Trigger) für alle Änderungen; Entscheidungen ebenfalls unveränderlich; Wissen versioniert | Migrationen 0001/0003/0006, Tests |
| | Optimistisches Sperren: keine stille Überschreibung von Änderungen anderer Geräte | `projekte.ts`, `aufgaben.ts`, `wissen.ts`, Tests |
| Verfügbarkeit | Nächtliche, verschlüsselte Sicherung (AES-256) mit automatischem Wiederherstellungstest; Sicherung vor jeder Produktivsetzung; D1 Time Travel | `.github/workflows/sicherung.yml`, `deploy.yml`, `scripts/wiederherstellung-testen.mjs` |
| | Kostenwächter verhindert unbemerktes Erreichen der Free-Grenzen | `lib/kosten.ts` |
| Trennungskontrolle | Projekte getrennt; KI-Zugänge auf Projekte beschränkbar | `pruefeProjekt`, Tests |
| Datensparsamkeit | Keine IP-Adressen im Audit; Löschfristen automatisch (Löschkonzept) | `cron.ts` (aufraeumen), `push.test.ts` |
| Organisatorisch | Produktivsetzung nur manuell mit Bestätigung und Pflicht-Freigabe in der GitHub-Umgebung „produktion“; Abhängigkeiten in CI geprüft (`npm audit`) | `deploy.yml`, `pruefen.yml` |
