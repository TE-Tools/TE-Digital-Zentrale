# TE-Digital Zentrale

Zentrale Unternehmenssteuerung von TE-Digital als PWA: KI-Mitarbeiter, Projekte, Aufgaben, Freigaben und Unternehmenswissen. Grundlage sind das Pflichtenheft v1.0 und der freigegebene Plan in [docs/Bestandsaufnahme-und-Implementierungsplan.md](docs/Bestandsaufnahme-und-Implementierungsplan.md).

**Stand:** Phase 6 (Wissen & Berichte) – lokal lauffähig, noch nicht in Cloudflare angelegt. Repository: https://github.com/TE-Tools/TE-Digital-Zentrale

## Aufbau

| Pfad | Inhalt |
|---|---|
| `apps/worker` | Cloudflare Worker (Hono, TypeScript): API, Passkey-Anmeldung, D1-Migrationen, Tests (laufen in workerd) |
| `apps/web` | PWA (Preact, Vite, `vite-plugin-pwa`): Dashboard, Aufgaben, Kommunikation, Freigaben, Projekte, Mitarbeiter, Einstellungen |
| `marke/` | TE-Digital-Logo als SVG (Kachel, maskable, monochrom) – Quelle für alle Icons |
| `scripts/icons.mjs` | Erzeugt App-Icons aus `marke/` (`npm run icons`) |
| `docs/` | Bestandsaufnahme, Plan, Entscheidungen |

Ein Worker liefert PWA (Static Assets) und API (`/api/*`) aus. Datenbank: D1 (EU). Tarif: **Workers Free** – keine Paid-Funktionen verwenden.

## Lokal starten

```powershell
npm install
copy apps\worker\.dev.vars.example apps\worker\.dev.vars   # Code anpassen
npm run db:migrate:lokal
npm run dev                                                 # baut die PWA und startet http://localhost:8787
```

Für schnelle Oberflächenarbeit zusätzlich `npm run dev:web` (Vite auf :5173, leitet `/api` an :8787 weiter).

**Lokale Anmeldung:** Mit `DEV_LOGIN=1` in `.dev.vars` erscheint auf `localhost` die Schaltfläche „Lokal anmelden (nur Entwicklung)“. Der Worker lehnt diesen Weg auf jeder anderen Adresse ab. In Produktion wird `DEV_LOGIN` nie gesetzt.

## Prüfen

```powershell
npm run pruefen    # Typprüfung, Tests (Worker + Web), Produktions-Build
```

## Arbeitsablauf (Phase 3)

1. **Auftrag erteilen** (`/aufgaben/neu`): Titel, Projekt, Zuständigkeit, Priorität und das Übergabepaket nach Pflichtenheft 6.3 (Ziel, Ausgangslage, Dateien, Ergebnis, Einschränkungen, Akzeptanzkriterien, Freigaben). Abhängigkeiten sind optional. Laufende Nummern: TD-0001, FG-0001, EN-0001.
2. **Übergabepaket kopieren oder teilen** und im KI-Tool einfügen: ChatGPT, Gemini, Grok kostenlos im Web, Claude per Abo. Das Paket enthält Rolle, Stufenregel, Kontext und ein festes Antwortformat. Vor dem Kopieren warnt es bei E-Mail-Adressen, Telefonnummern, Zugangsdaten und Überlänge.
3. **Antwort zurückführen:** Die Antwort einfügen. Die Abschnitte ERGEBNIS, OFFENE FRAGEN, FREIGABEANTRÄGE und ZWISCHENSTAND werden erkannt. Daraus entstehen ein Ergebnis (Status *Prüfung*), ein Checkpoint, eine Rückfrage an die GF und, falls nötig, automatisch eine Freigabe (Status *Freigabe erforderlich*).
4. **Limit erreicht:** Mitarbeiter und Aufgabe werden pausiert und ein Checkpoint wird gespeichert. Nach Ablauf erscheint die Aufgabe auf dem Dashboard unter „Wartet auf Sie“. *Fortsetzen* erzeugt ein kurzes Paket ab dem letzten Zwischenstand.
5. **Freigaben (Stufe 3):** Freigeben oder Ablehnen verlangt eine frische Passkey-Bestätigung. Erteilt → die Aufgabe läuft weiter. Abgelehnt → die Aufgabe ist blockiert. Jede Entscheidung landet unveränderlich im Entscheidungsprotokoll.
6. **Statusregeln:** Eine Aufgabe startet erst, wenn ihre Abhängigkeiten erledigt sind. Abschließen geht nur mit bestandener (oder nicht nötiger) Prüfung und ohne offene Freigabe. Den Status *Freigabe erforderlich* setzt nur ein Freigabeantrag.

Alle Nachrichten (Übergaben, Ergebnisberichte, Rückfragen, Warnungen …) liegen zentral unter *Kommunikation*. Eine Stufe-2-Entscheidung benachrichtigt Projektleitung und Geschäftsführung automatisch.

## Benachrichtigungen, Echtzeit & Mobil (Phase 4)

- **Web Push** ohne fremden Dienst (RFC 8291/8292, aus orchester-orga übernommen). Die Geräte meldet man unter *Benachrichtigungen* an. **iPhone:** Push erst, wenn die Zentrale zum Home-Bildschirm hinzugefügt ist (iOS ab 16.4). VAPID-Schlüssel: optional als Secrets (`node scripts/vapid.mjs` erzeugt ein Paar). Sonst erzeugt der Worker sie einmalig in D1.
- **Kategorien:**
  - *kritisch*: sofort, auch in der Ruhezeit
  - *wichtig*: sofort, stündlich gebündelt oder aus
  - *Tagesbericht*: zur eingestellten Uhrzeit
- **Ruhezeit:** Wichtige Meldungen warten bis zu ihrem Ende.
- Für eigene Aktionen gibt es keinen Push, nur einen gelesenen Eintrag im Posteingang.
- **Cron** alle 15 Minuten: abgelaufene Limit-Pausen („wieder verfügbar, fortsetzen“), zurückgestellte und gebündelte Meldungen, Tagesbericht.
- **Echtzeit:** ein SQLite-Durable-Object (`ZentraleLive`, EU-Jurisdiktion) verteilt per WebSocket (Hibernation) nur das Signal „geändert“. Die Geräte laden dann über die API nach. Ohne Live-Verbindung wird jede Minute neu geladen.
- **Teilen-Ziel (Android):** In ChatGPT, Gemini oder Grok „Teilen → TE-Zentrale“ wählen. Der Service Worker nimmt den Text an, ohne ihn in die URL zu schreiben. Danach lässt er sich als Antwort zu einer Aufgabe übernehmen, als neuer Auftrag anlegen oder als Notiz ablegen.
- **Sprache:**
  - Diktat-Knopf über die Web Speech API (Chrome/Edge über Google, Safari über Apple, kostenlos, mit einmaligem Datenschutzhinweis). Das Tastatur-Mikrofon geht immer.
  - „Vorlesen“ des Unternehmensstatus über die Gerätestimme.
- **Offline:** Die App-Hülle ist vorgehalten. Das Dashboard zeigt den letzten Stand mit Uhrzeit, dazu einen Offline-Hinweis.

## Entwicklungsintegration (Phase 5)

### Claude Code über MCP

Der Worker stellt unter `/mcp` einen MCP-Server bereit (Streamable HTTP, zustandslos). Darüber arbeitet Claude Code mit Ihrem Claude-Abo direkt mit der Zentrale, ohne kostenpflichtige API.

1. **Zugang anlegen:** *Einstellungen → KI-Zugänge → Zugang erstellen*. Das ist eine Stufe-3-Aktion mit Passkey. Optional beschränken Sie den Zugang auf einzelne Projekte. Das Token wird nur einmal angezeigt. Gespeichert wird nur sein Hash, und es lässt sich jederzeit widerrufen.
2. **Lokal einrichten:**
   ```powershell
   claude mcp add --transport http --scope user te-zentrale https://zentrale.te-alltagshelfer.org/mcp --header "Authorization: Bearer <TOKEN>"
   ```
3. **Claude Code in der Cloud:** In der Cloud-Umgebung die Variable `TE_ZENTRALE_TOKEN` setzen und im Projekt-Repository eine `.mcp.json` einchecken. Sie enthält kein Geheimnis:
   ```json
   { "mcpServers": { "te-zentrale": { "type": "http", "url": "https://zentrale.te-alltagshelfer.org/mcp", "headers": { "Authorization": "Bearer ${TE_ZENTRALE_TOKEN}" } } } }
   ```
4. **Auftrag übergeben:** In der Aufgabe unter *Entwicklung → Auftrag an Claude Code übergeben* den Text kopieren und in Claude Code einfügen.

**Werkzeuge:**
- Lesen: `meine_aufgaben`, `aufgabe_lesen`, `projekt_kontext`, `nachrichten_lesen`
- Aufgabe bearbeiten: `aufgabe_starten`, `status_melden`, `zwischenstand_speichern`, `ergebnis_melden`, `limit_melden`, `branch_melden`
- Sperren: `sperre_setzen`, `sperre_freigeben`
- Kommunikation und Entscheidungen: `nachricht_senden`, `freigabe_beantragen`, `entscheidung_dokumentieren`

**Grenzen:** KI-Zugänge arbeiten nur an eigenen Aufgaben in freigegebenen Projekten. Sie können keine Freigaben erteilen, keine Aufgaben abschließen, keine Rechte ändern und keine Stufe-3-Entscheidungen treffen. Das sichern zwei Schichten ab: eine Routen-Whitelist und die Prüfungen in jeder Route. Im Audit-Protokoll stehen ihre Aktionen als `mitarbeiter`. Ergebnisse von KI-Mitarbeitern lösen Push-Meldungen aus.

**Noch nicht enthalten:** Claude.ai (Web/App) als Konnektor. Er verlangt OAuth, das folgt als eigener Schritt. ChatGPT, Gemini und Grok können MCP mit kostenlosen Zugängen nicht nutzen und arbeiten weiter mit Übergabepaketen.

### GitHub-App (von der Geschäftsführung selbst eingerichtet)

*Einstellungen → GitHub-Verbindung → Verbindung einrichten (Passkey)* durchläuft drei Schritte:

1. Die Zentrale übergibt ein App-Manifest an github.com. Auf GitHub bestätigen Sie nur noch den Namen.
2. GitHub leitet zurück. Privater App-Schlüssel und Webhook-Geheimnis werden mit AES-GCM verschlüsselt in D1 gespeichert. Den Schlüssel dazu gibt es nur als Secret `ZENTRALE_SCHLUESSEL`.
3. Sie installieren die App in TE-Tools und **wählen auf GitHub selbst die Repositories aus**.

**Rechte:** Metadaten, Pull Requests und Checks nur lesen, Issues lesen und schreiben. **Kein Schreibrecht auf Code.** Zusammengeführt wird nur auf GitHub, nach Prüfung und Freigabe.

**Daten:** Webhooks (`pull_request`, `check_suite`, `push`) und ein stündlicher Abgleich im Cron. Im Free-Tarif ist der Abgleich auf höchstens 45 GitHub-Aufrufe begrenzt.

**Voraussetzung:** Die Zentrale muss öffentlich per HTTPS erreichbar sein. GitHub kann weder `localhost` zurückrufen noch Webhooks dorthin schicken. Die Einrichtung funktioniert deshalb erst nach der Produktivsetzung.

### Git-Konfliktschutz (Pflichtenheft 7.1)

- **Branches:** Jede Entwicklungsaufgabe bekommt einen eigenen Branch `aufgabe/td-0007-kurztitel`. PRs werden über den Branch-Namen automatisch ihrer Aufgabe zugeordnet.
- **Sperren:** Sperren gelten exklusiv für Pfade oder Muster in einem Repository. Eine überlappende Sperre wird abgelehnt, und nichts wird automatisch übernommen. Endet eine Aufgabe (abgeschlossen oder abgebrochen), wird ihre Sperre frei.
- **Konflikterkennung** unter *Entwicklung*: Sie meldet offene PRs, die dieselben Dateien ändern, und PRs, die Dateien einer fremden Sperre berühren.

## Wissen, Kontext & Berichte (Phase 6)

**Unternehmenswissen**
- Wissen gibt es unternehmensweit und je Projekt, in Kategorien wie Organisation, Rolle, Arbeitsablauf, Anleitung, Architektur, Technik, Entscheidung und Zusammenfassung.
- Inhalte sind Markdown. Jede Änderung wird als neue Version gespeichert. Ältere Versionen lassen sich ansehen. Statt zu löschen, wird archiviert.
- **Startbestand** aus [`firma/`](firma/): Organisation, Entscheidungsstufen, Arbeitsablauf und 5 Rollen. Die Migration 0006 übernimmt ihn, erzeugt mit `node scripts/firma-zu-sql.mjs`.
- **„Als Wissen speichern“** übernimmt das Ergebnis einer Aufgabe als Zusammenfassung ins Projektwissen.
- **Rechte:** Firmenregeln, Rollen und Arbeitsabläufe ändert nur die Geschäftsführung. KI-Mitarbeiter pflegen per MCP (`wissen_suchen`, `wissen_lesen`, `wissen_speichern`) nur Fach- und Projektwissen in ihren freigegebenen Projekten.

**Kontext- und Tokenmanagement (Pflichtenheft 11)**
- Übergabepakete enthalten nur die **Kurzfassungen** der relevanten Artikel: die eigene Rolle, Projektwissen und übergreifendes Fachwissen. Das Budget liegt bei rund 1.800 Zeichen. Die Details holt sich der KI-Mitarbeiter bei Bedarf per `wissen_lesen`.
- Fortsetzungspakete enthalten nur den letzten Zwischenstand, keine alten Verläufe.

**Berichte**
- **Tagesbericht:** wird automatisch aus den Daten der Zentrale erstellt, ohne KI. Er enthält, was auf die Geschäftsführung wartet, Erledigtes, Neues, Blockiertes, Wartendes und Limit-Pausen, Freigaben, Entscheidungen, Pull Requests, Projekte und KI-Mitarbeiter. Er wird einmal am Tag gespeichert und kommt zur eingestellten Uhrzeit als Push mit Link.
- **Projektbericht:** auf Knopfdruck für 7, 30 oder 90 Tage.
- **Aktivitätsprotokoll:** das komplette, unveränderliche Audit, gefiltert nach Bereich und Akteur.

**Kostenwächter (Pflichtenheft 13)**
- Misst stündlich die Tagesnutzung des **gesamten** Cloudflare-Kontos (alle TE-Apps) gegen die Free-Grenzen: Worker-Anfragen, D1 gelesene und geschriebene Zeilen, Durable Objects.
- Warnt ab 80 % (wichtig) und ab 95 % (kritisch).
- Ab 70 % Worker-Anfragen gilt der Sparmodus: Der GitHub-Abgleich setzt aus.
- **Einrichtung:** `CF_ACCOUNT_ID` als Variable oder Secret, dazu `CF_ANALYTICS_TOKEN` als Secret mit einem API-Token, das nur „Account Analytics: Lesen“ darf. Ohne diese Angaben zeigt die Seite „nicht eingerichtet“.
- Die Abfrage an Cloudflare (GraphQL) ist gegen eine Beispielantwort getestet. Gegen die echte API muss sie nach der Produktivsetzung einmal geprüft werden.

## Sicherheit (Phase 2)

- Anmeldung nur per **Passkey** (WebAuthn, Benutzerverifikation Pflicht). Dazu 8 einmalige Wiederherstellungscodes, gespeichert als SHA-256.
- Ersteinrichtung nur mit `EINRICHTUNGSCODE` (Worker-Secret) und nur, solange noch kein Benutzer existiert.
- Sitzung: HttpOnly-Cookie (`__Host-` unter HTTPS, SameSite=Strict), Token in D1 nur gehasht, Gültigkeit 30 Tage.
- CSRF: Schreibende Anfragen brauchen `X-TE-Anfrage: 1` und eine erlaubte Origin.
- Stufe-3-Aktionen verlangen eine Passkey-Bestätigung, die höchstens 5 Minuten alt ist (`stepUpPflicht`). Eine Anmeldung per Wiederherstellungscode erfüllt das nicht.
- Das Audit-Protokoll `aktivitaeten` ist per Trigger unveränderlich.
- Änderungen an Projekten nutzen optimistisches Sperren (`version`), damit kein Gerät die Änderungen eines anderen überschreibt.
- CSP und Sicherheits-Header für die PWA liegen in `apps/web/public/_headers`, für die API im Worker.

## Produktivsetzung (Stufe 3 – nur nach Freigabe der Geschäftsführung)

1. `npx wrangler d1 create te-zentrale-db --jurisdiction eu` und die ID in `wrangler.jsonc` → `env.produktion` eintragen.
2. `npx wrangler d1 migrations apply te-zentrale-db --remote --env produktion`
3. Secrets setzen: `EINRICHTUNGSCODE`, `ZENTRALE_SCHLUESSEL` (32 zufällige Byte, base64url – Befehl in `apps/worker/.dev.vars.example`), optional `CF_ACCOUNT_ID` + `CF_ANALYTICS_TOKEN` (Kostenwächter), je mit `npx wrangler secret put <NAME> --env produktion`
4. `npm run build` und danach `npx wrangler deploy --env produktion` im Ordner `apps/worker`. Die Custom Domain `zentrale.te-alltagshelfer.org` wird dabei angelegt.
5. Die Zentrale öffnen, mit dem Einrichtungscode den Passkey anlegen und die Wiederherstellungscodes sichern.
