# TE-Digital AI Company – Bestandsaufnahme und Implementierungsplan

**Stand:** 19.11.2026 · **Bezug:** Pflichtenheft v1.0, Abschnitt 19 · **Status:** ✅ **Freigegeben durch die Geschäftsführung am 19.11.2026**, mit zwei Vorgaben:
1. Designgrundlage ist te-alltagshelfer.org (Kapitel 3).
2. **Nur Claude Code ist ein bezahltes Abo.** ChatGPT, Gemini und Grok werden ausschließlich über ihre **kostenlosen Web-Zugänge mit Login** genutzt. Ist das kostenlose Kontingent aufgebraucht, wird pausiert (Kapitel 6.1).

Dieses Dokument erfüllt die Pflichtschritte 1–10 aus Abschnitt 19 des Pflichtenhefts. Es wurde noch kein Code geschrieben und keine Infrastruktur angelegt.

---

## 0. Zusammenfassung für die Geschäftsführung

1. **Die Plattform passt.** Cloudflare (Workers, D1, R2, Cron) wird bereits in drei TE-Projekten produktiv genutzt. Ein Großteil lässt sich wiederverwenden: Web Push, Sitzungsverwaltung, D1-Backups und die Deploy-Workflows aus *orchester-orga*. Das System lässt sich vollständig im **kostenlosen Workers-Tarif** betreiben.
2. **Eine Pflichtenheft-Annahme ist ohne KI-API nicht erfüllbar:** Eine *selbstständig im Hintergrund laufende* KI-Organisation, in der ChatGPT von sich aus Gemini, Grok und Claude koordiniert, ist mit Web-Zugängen nicht zulässig umsetzbar. Weder die kostenlosen Zugänge noch das Claude-Abo liefern eine Schnittstelle, über die unsere Software die Modelle unbeaufsichtigt ansteuern darf.
3. **Der realistische Weg:** Die PWA wird die **zentrale Akte und Leitstelle**. Die KI-Mitarbeiter arbeiten in ihren eigenen, regulär angemeldeten Web-Oberflächen. Die Anbindung erfolgt auf drei unterstützten Wegen:
   - **(a) Übergabepakete** zum Kopieren und Teilen – der Standardweg für **ChatGPT, Gemini und Grok (kostenlos)**. Auf Android geht das Ergebnis per Teilen-Menü direkt in die PWA zurück.
   - **(b) Ein eigener MCP-Server** auf Cloudflare, den **Claude Code und Claude.ai (Abo)** als Konnektor einbinden. Damit lesen und schreiben sie Aufgaben, Checkpoints und Ergebnisse selbst, ausgelöst durch eine Sitzung, die Sie starten.
   - **(c) GitHub als Drehscheibe** für Claude Code (Issues → Branches → Pull Requests).
   - Weil die kostenlosen Zugänge knappe Kontingente haben, sind **kompakte Übergabepakete und Checkpoints** zentral. Jede Unterbrechung durch ein Limit ist ohne Verlust fortsetzbar.
4. **Dringende Entscheidungen:** Domain, Anmeldeverfahren und die Freigabe des MVP-Umfangs (Kapitel 12).

---

## 1. Bestandsaufnahme GitHub-Repositories (Schritt 1)

Alle untersuchten Repos liegen in der GitHub-Organisation **TE-Tools**.

| Projekt | Repo | Zustand / Besonderheiten |
|---|---|---|
| Familienplaner / TE-Alltagshelfer | `TE-Tools/te-alltagstools-website` | Produktiv, v4.64. Fünf Worker, Firebase (Firestore + Auth), umfangreiche DSGVO-Unterlagen. Offener Punkt: Build-Schritt fehlt. |
| Orchester Orga | `TE-Tools/orchester-orga` | Produktiv. Worker + D1 + R2, eigener Web-Push, Android-TWA. Gemeinsamer Zahlungsdienst `te-payments`. |
| TE-Mini-Games | `TE-Tools/TE-Mini-Games` | React 19/Vite/TS, Supabase (Auth, Postgres, Realtime), Capacitor-Android, beste Testabdeckung (Vitest + Playwright). |
| DragonGuildMaster (Website) | `TE-Tools/DragonGuildMaster-Website` | Hono-Worker + D1 (16 Migrationen) + R2, Battle.net-OAuth. Kein CI, manuelles Deploy. |
| DragonGuildMaster / DragonSkill (Addon) | `TE-Tools/DrgonGuildMaster` (Tippfehler im Repo-Namen) | WoW-Lua-Addon v3.1.3. Der Ordner `website/` ist eine veraltete, ignorierte Kopie der DGM-Website. |
| Gemeinsame Arbeitsregeln | `TE-Tools/te-plattform` | **Nur referenziert, nicht lokal vorhanden** (`REGELN.md`, `ARBEITSSTAND.md`) |
| TE-Vereinsleben | `TE-Tools/vereinsleben` | **Nur referenziert, nicht lokal vorhanden** |
| TE-Digital Hauptwebsite | in `te-alltagstools-website/website-deploy/public/portfolio.html` | Kein eigenes Repo |

**Nicht prüfbar:** Die vollständige Repo-Liste der Organisation TE-Tools. Die GitHub-CLI ist hier nicht installiert, und private Repos sind ohne Anmeldung nicht sichtbar. → Die Geschäftsführung richtet die GitHub-Verbindung selbst in der PWA ein (E7, Kapitel 8.4). Danach erscheinen die freigegebenen Repos automatisch in der Projektverwaltung.

**Konventionen, die übernommen werden:** Dokumentation, Kommentare und Workflows auf Deutsch. Keine KI-APIs in der Produktlogik (`TE-Mini-Games/AGENTS.md`). Secrets nur als Cloudflare- bzw. GitHub-Secrets. Kleine PRs, Merge auf `main` deployt.

## 2. Bestehende technische Infrastruktur (Schritt 2)

| Dienst | Genutzt in | Bemerkung |
|---|---|---|
| Cloudflare Workers | 8 Worker in 3 Projekten | Konto-Subdomain `*.thomaselsen84.workers.dev` |
| Cloudflare D1 | DGM, orchester-orga, te-payments | Laut Geschäftsführung bei der Anlage in der EU erstellt. Das ist aus den `wrangler.toml`-Dateien nicht ersichtlich, aber auch nicht nötig. Für die Zentrale gilt dasselbe. |
| Cloudflare R2 | DGM, orchester-orga | Anhänge, Galerie |
| Cloudflare Pages | DGM-Web, orchester-orga, Mini-Games | Familienplaner nutzt bereits *Workers Static Assets* |
| Cloudflare KV, Workers AI, Rate Limiting | Familienplaner | – |
| Durable Objects, Queues | **nirgends** | Für die Zentrale neu |
| Firebase (Firestore, Auth, FCM) | nur Familienplaner | Wird für die Zentrale **nicht** benötigt |
| Supabase | nur Mini-Games | Wird für die Zentrale **nicht** benötigt |
| Web Push (VAPID) | Familienplaner (über Firestore), orchester-orga (abhängigkeitsfrei, D1) | Die orchester-Variante ist die Vorlage |
| Anmeldung | Firebase Auth, Supabase Auth, eigene PBKDF2-Sitzungen, Battle.net/Google-OAuth | Passkeys bisher nirgends als Login |
| CI/CD | GitHub Actions mit `wrangler-action`, Secrets `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | Vorlage: pfadgefilterte `deploy-*.yml` + Smoke-Test |
| Domains | `te-alltagshelfer.org` (+ `www`, `familienplaner.`, `verein.`) | **Keine** te-digital-Domain gefunden |

**Bestätigt durch die Geschäftsführung:** Das Cloudflare-Konto nutzt den Tarif **Workers Free**. Nicht geprüft wurden die tatsächliche Auslastung, die Custom Domains und die Firebase-Konsole.

## 3. TE-Digital-Designressourcen (Schritt 3)

**Vorgabe der Geschäftsführung (19.11.2026):** Die Website **te-alltagshelfer.org** ist die Gestaltungsgrundlage. Die Zentrale übernimmt ihre Handschrift, wirkt aber moderner und eindeutig als **Firmen-Dashboard**, nicht als Marketingseite.

**Quelle:** Laut `website-deploy/wrangler.toml` und `src/index.js` liefert der Worker `te-alltag` auf `te-alltagshelfer.org` die Datei `te-alltagstools-website/website-deploy/public/portfolio.html` aus. Ihr Stylesheet (Zeilen 157–457) ist damit die verbindliche Referenz.

**Befund Logo:** Es gibt **keine Logo-Datei** der Dachmarke TE-Digital. Das Zeichen existiert nur als Inline-SVG in `portfolio.html` (Zeilen 474–478 und 567–569): ein „Ebenen-Stapel“-Symbol in `#221a04` auf einer goldenen Kachel `#C8912A` (32 px, Radius 9 px), Wortmarke „TE-Digital“ in Space Grotesk 700.

**Farb- und Formbasis** – 1:1 aus `portfolio.html` übernommen:

| Token | Hell | Verwendung |
|---|---|---|
| `--paper` / `--paper-2` | `#FBFAF7` / `#F4F2EC` | Hintergrund |
| `--surface` | `#FFFFFF` | Karten |
| `--ink` / `--ink-2` | `#14161A` / `#2B2F36` | Text, Überschriften |
| `--body` / `--body-soft` | `#4A4F58` / `#6E737C` | Fließtext |
| `--line` / `--line-2` | `#E6E2D8` / `#D6D1C2` | Linien |
| `--gold` / `--gold-text` / `--gold-wash` | `#C8912A` / `#8A6512` / `#FBF4E2` | Markenakzent |
| Projektfarben | Familienplaner `#047857` · Vereinsleben `#1B4D3E` · Orchester `#6B1F2A` · Mini-Games `#5A3CE0` | Eigene Gestaltung der Projektbereiche |

### 3.1 Was von der Website übernommen wird

| Element der Website | Fundstelle in `portfolio.html` | Verwendung in der Zentrale |
|---|---|---|
| Warmes Papier statt Weiß/Grau, Gold nur als Akzent | `:root`, Kommentar Z. 158–168 | Grundstimmung. Gold für Logo, aktive Navigation, Fokusring und Freigabe-Hervorhebungen. Keine Goldverläufe. |
| Schriften Space Grotesk (Überschriften, `letter-spacing -0.015em`) und Inter (Text) | Z. 196, 202 | Unverändert, aber **selbst gehostet** statt Google Fonts |
| Marken-Kachel + Wortmarke | `.brand`, `.brand-mark` | Kopf der Seitenleiste bzw. der mobilen Kopfzeile |
| Sticky-Kopfzeile mit Blur und Haarlinie | `.site-head` | Mobile Kopfzeile mit Seitentitel und Schnellaktion |
| Karten: weiße Fläche, 1-px-Linie `--line`, Radius 14–16 px, `--shadow` | `.app-card`, `.trust-item` | Alle Dashboard-Karten |
| **3-px-Farbleiste oben in Projektfarbe** (`--accent`) | `.app-card::before` | Projektkarten und Projektkopf – jedes Projekt bleibt an seiner Hausfarbe erkennbar |
| Icon-Kachel mit getönter Fläche (z. B. `#E7F3EE` + `#047857`) | `.app-ic`, `.p-ic` | Projekt- und Mitarbeitersymbole |
| Pill-Tags in `--paper-2` bzw. Gold-Variante | `.app-tag`, `.app-tag.hl` | Status, Priorität, Stufe-3-Kennzeichnung |
| Kicker (Großbuchstaben, Gold, `letter-spacing .1em`) | `.kicker` | Bereichsüberschriften im Dashboard |
| Hinweisbox mit farbiger Linkskante | `.app-note` | Warnungen, Eskalationen, Checkpoint-Hinweise |
| Dunkles Band `--ink` mit transparenten Kacheln | `.cta-band`, `.start-card` | Vorlage für den **Dunkelmodus** und den Kopfbereich „Unternehmensstatus“ |
| Buttons: Primär `--ink` (dunkel), Ghost mit Linie, Mindesthöhe 44–48 px | `.btn` | Unverändert, gut für Touch |
| Fokusring Gold 3 px, `prefers-reduced-motion` | Z. 205, 452–456 | Unverändert übernehmen (Barrierefreiheit) |
| Dezente Einblendung, Anheben beim Hover um 2–3 px | `.reveal`, `:hover` | Sparsam: nur Karten, keine Dauer-Animationen |

### 3.2 Was modernisiert wird – vom Schaufenster zum Firmen-Dashboard

| Website (Marketing) | Zentrale (Arbeitsoberfläche) |
|---|---|
| Lange Scrollseite, Hero mit großer Überschrift (bis 54 px) | **App-Rahmen:** feste Seitenleiste am Desktop (Logo, 10 Bereiche, Projektliste mit Farbpunkten), **untere Navigation** mit 5 Einträgen am Handy (Dashboard, Aufgaben, + Auftrag, Freigaben, Mehr) mit Safe-Area |
| Max. Breite 1120 px, viel Weißraum | Volle Breite mit **12-Spalten-Raster aus Kacheln**. Kompaktere Abstände (Abschnitte 24–32 px statt 72 px). Überschriften 20–28 px. |
| Werbeaussagen, Fließtext | **Kennzahlen-Kacheln** (Zahl in Space Grotesk 32–40 px, tabellarische Ziffern), Statusleisten, Listen mit klarer Zeilenhöhe |
| Keine Statusfarben | **Statussystem** aus den Werten der Apps: Erfolg `#0f7a52`, Warnung `#a8620a`, Kritisch `#c02b48`, Info `#1d4ed8`, Wartend `--body-soft`. Jeder Status zusätzlich mit Symbol und Text, nie nur Farbe. |
| Keine Diagramme | Ruhige Diagramme: Linien und Balken in `--ink` und Projektfarben, Gitter in `--line`, keine 3D- oder Verlaufseffekte |
| Statische Inhalte | **Live-Signale:** pulsierender Punkt bei aktiven Mitarbeitern, „zuletzt bestätigt vor 3 Std.“ in `--body-soft`, Badge-Zähler an Freigaben |
| Nur hell (Dunkelversion wurde bewusst aufgegeben) | **Hell als Standard** wie die Website. Dunkelmodus abgeleitet aus dem `.cta-band`: Grund `#14161A`, Karten `#1C1F24`, Linien `rgba(255,255,255,.10)`, Text `#ECEAE4`, Gold `#C8912A`. Umschaltbar, folgt sonst dem System. |
| Klick führt auf Unterseiten | **Befehlsleiste** (Strg+K bzw. Suchfeld oben) für „Auftrag anlegen“, „Projekt öffnen“, „Freigabe prüfen“ und das Mikrofon für Diktat |

### 3.3 Dashboard-Startseite (Aufbau)

1. **Statusband** im `--ink`-Stil der Website: „Guten Morgen“, Unternehmensstatus (alles ok / Warnungen / kritisch), Datum, Schnellaktion „+ Auftrag“.
2. **Kennzahlen-Reihe:** offene Freigaben (Gold hervorgehoben), Aufgaben in Bearbeitung, blockiert, heute abgeschlossen.
3. **„Wartet auf Sie“** – Freigaben und Eskalationen als Hinweisboxen mit farbiger Linkskante, direkt bestätigen oder ablehnen.
4. **KI-Mitarbeiter** – fünf kompakte Karten mit Rolle, Anbieter, Status, letzter Bestätigung und aktueller Aufgabe.
5. **Projekte** – Karten mit 3-px-Leiste in der Hausfarbe, Fortschritt, offene Aufgaben, Risiken.
6. **Letzte Aktivitäten** – Zeitleiste. Daneben **Tagesbericht** und **Infrastruktur/Kosten** (Auslastung der Freigrenzen als Balken).

Am Handy sind dieselben Blöcke einspaltig gestapelt, in der Reihenfolge 1 → 3 → 2 → 4 → 5 → 6. Was auf Sie wartet, steht also immer oben.

### 3.4 Weitere Punkte

- **Logo:** Das Inline-SVG wird als eigenständige Dateien extrahiert (Kachel, Monochrom, App-Icon 192/512, maskable, Favicon) und im neuen Repo unter `marke/` abgelegt.
- **Projektfarben:** Familienplaner `#047857`, Vereinsleben `#1B4D3E`, Orchester-Orga `#6B1F2A`, Mini-Games `#5A3CE0` mit ihren Kachel-Tönen aus der Website. Für die Dragon-Projekte und die Hauptwebsite werden passende Farben ergänzt: Dragon `#9b1c1f` aus der eigenen Gildenmarke, Website `--gold`.
- **Vor Phase 2:** Ein klickbarer Gestaltungsentwurf (Dashboard hell/dunkel, Handy und Desktop) wird zur Freigabe vorgelegt.

## 4. Technische Machbarkeit der Architektur (Schritt 4)

| Komponente laut Pflichtenheft | Bewertung | Entscheidung |
|---|---|---|
| Cloudflare Pages | Machbar. Cloudflare empfiehlt für neue Projekte inzwischen Workers mit Static Assets. | **Abweichung:** *ein* Worker liefert PWA und API aus (wie beim Familienplaner) – ein Deploy, keine CORS-Probleme |
| Workers | Machbar | TypeScript + Hono (bewährt in DGM) |
| D1 | Machbar | **Mit `jurisdiction = "eu"` anlegen** – nur bei der Erstellung möglich |
| Durable Objects | Machbar, im Free-Tarif nur SQLite-basiert | *Ein* DO „Zentrale“ für Echtzeit per WebSocket (Hibernation), Namespace `jurisdiction("eu")`. Rückfall auf Polling, falls die Verbindung fehlt. |
| R2 | Machbar | EU-Jurisdiktion, für Dokumente und Anhänge |
| Web Push | Machbar | Port von `orchester-orga/worker/src/webpush.js`. **iOS: Push nur, wenn die PWA zum Home-Bildschirm hinzugefügt ist (ab iOS 16.4).** |
| Sprachsteuerung | Eingeschränkt | Siehe Kapitel 6 |
| GitHub-Anbindung | Machbar | Eigene GitHub App mit minimalen Rechten und Webhooks |
| Cron (Tagesbericht, Kostenwächter) | Machbar | Workers Cron Triggers |

### Tarifgrenzen Workers Free (geprüft am 19.11.2026)

| Ressource | Kostenlos | Erwarteter Bedarf |
|---|---|---|
| Worker-Anfragen | 100.000 / Tag, 10 ms CPU / Anfrage | Wenige Tausend / Tag |
| D1 | 5 Mio. Zeilen gelesen / Tag, 100.000 geschrieben / Tag, 500 MB je DB, 5 GB gesamt, 50 Abfragen je Anfrage | Weit darunter (Indizes sauber setzen) |
| Durable Objects | 100.000 Anfragen / Tag, nur SQLite, 5 GB | Ein Objekt, geringe Last |
| R2 | 10 GB Speicher (laut Preisliste, vor Start erneut prüfen) | Gering |

Wichtig für die Kostenkontrolle: Im Free-Tarif **entstehen beim Überschreiten keine Kosten**, die Anfragen schlagen fehl. Das Kostenrisiko liegt erst beim Wechsel auf Workers Paid (5 USD/Monat) – Stufe-3-Freigabe.

### 4.1 Folgen des Free-Tarifs für die Umsetzung (E8)

- **Gemeinsames Konto:** Die Tageskontingente gelten pro Konto, nicht pro Projekt. Familienplaner, Orchester Orga, DGM und die Zentrale teilen sich also 100.000 Anfragen pro Tag und die D1-Kontingente. Der Kostenwächter (Kapitel 11) zeigt deshalb die **Gesamtauslastung des Kontos** und den Anteil der Zentrale.
- **Selbstbeschränkung:** Die Zentrale darf die produktiven Apps nicht ausbremsen. Ab 70 % der Konto-Tagesgrenze schaltet sie Echtzeit auf sparsames Polling um und verschiebt nicht dringende Cron-Arbeiten.
- **10 ms CPU pro Anfrage:**
  - Keine Passwort-Hashes. Passkeys sind nur eine Signaturprüfung.
  - Push-Verschlüsselung erfolgt einzeln pro Nachricht im Cron, nicht gebündelt in einer Anfrage.
  - Der Tagesbericht wird aus vorbereiteten Zählwerten gebaut, nicht durch große Abfragen.
- **D1:**
  - Höchstens 50 Abfragen pro Anfrage, deshalb Sammelabfragen per `batch()`.
  - Indizes auf allen Filterspalten, weil gelesene Zeilen zählen.
  - Die Zentrale bekommt eine eigene Datenbank (Free erlaubt bis zu 10).
- **Durable Objects:** nur SQLite-basiert, im Free-Tarif verfügbar. Ein einziges Objekt für die ganze Zentrale.
- **Keine Paid-Funktionen vorausgesetzt:** keine Queues und kein Logpush. Logs nur über die kostenlose Workers-Observability bzw. eine Tabelle `aktivitaeten`.

## 5. Kostenlose und kostenpflichtige Komponenten (Schritt 5)

| Komponente | Kosten | Hinweis |
|---|---|---|
| Workers, D1, DO, R2, Cron (Free) | 0 € | Innerhalb der oben genannten Grenzen |
| Workers Paid | 5 USD/Monat | Nur nach Freigabe, z. B. bei CPU-Grenzen |
| GitHub (Organisation, Actions für private Repos) | 0 € bis zum Free-Kontingent (Actions-Minuten begrenzt) | Verbrauch im Kostenbereich anzeigen |
| GitHub App, Webhooks | 0 € | – |
| Web Push (Browser-Push-Dienste) | 0 € | – |
| Domain | ca. 10–40 €/Jahr, falls eine neue Domain gewünscht ist | Alternative: Subdomain von `te-alltagshelfer.org` (0 €) |
| Claude-Code-Abo | bestehend | Einziges bezahltes KI-Abo. Kein Bestandteil der Anwendungskosten. |
| ChatGPT, Gemini, Grok | 0 € (kostenlose Web-Zugänge) | Kein Upgrade ohne Stufe-3-Freigabe |
| KI-APIs | **ausgeschlossen** | Auch Workers AI wird **nicht** verwendet |
| Cloudflare Access (optional) | 0 € bis 50 Nutzer | Siehe Kapitel 8 |

## 6. Kennzeichnung der KI-Integrationen (Schritt 6)

Legende: ✅ unterstützt · ⚠️ unterstützt mit Einschränkungen bzw. vor Umsetzung am aktuellen Abo zu prüfen · ❌ nicht zulässig oder nicht möglich

| Vorhaben | Status | Begründung / Umsetzung |
|---|---|---|
| Übergabepaket erzeugen, kopieren, in beliebiges KI-Tool einfügen | ✅ | Funktioniert mit jedem Anbieter, rein manuell |
| Ergebnis aus der ChatGPT-, Gemini- oder Grok-App per „Teilen“ in die PWA übernehmen | ✅ Android / ⚠️ iOS | Web Share Target API. iOS unterstützt sie für PWAs nicht – dort per Kopieren und Einfügen. |
| Claude Code lokal oder in der Cloud über das Abo nutzen | ✅ | Reguläre Anmeldung. Aufgaben kommen über GitHub-Issues bzw. den MCP-Server. |
| Claude Code / Claude.ai lesen und schreiben über einen eigenen **MCP-Server** in der Zentrale | ✅ | Remote-MCP-Server auf Cloudflare Workers mit OAuth. Die KI-Arbeit wird über das Abo abgerechnet, unser Server liefert nur die Daten. |
| ChatGPT (kostenlos) mit eigenem MCP-Konnektor | ❌ | Eigene Konnektoren setzen ein bezahltes ChatGPT-Abo voraus. ChatGPT arbeitet über Übergabepakete. |
| Gemini (kostenlos) mit eigenem MCP-Server | ⚠️ | Die Gemini-Web-App: nein → Übergabepakete. Option: **Gemini CLI** unterstützt MCP und hat bei Anmeldung mit einem privaten Google-Konto ein kostenloses Kontingent. In Phase 5 am Konto prüfen, sonst bleibt es beim Übergabepaket. |
| Grok (kostenlos) mit eigenen Werkzeugen | ❌ | Ohne API keine unterstützte Anbindung. Grok arbeitet über Übergabepakete. |
| PWA steuert ChatGPT, Gemini oder Grok **unbeaufsichtigt im Hintergrund** | ❌ | Erfordert API-Zugang oder Browser-Automatisierung der Verbraucheroberflächen – Letzteres verstößt gegen die Anbieterbedingungen |
| KI-Mitarbeiter kommunizieren **ohne menschlichen Anstoß** untereinander | ❌ | Folge der vorigen Zeile. Nachrichten werden zentral abgelegt und beim nächsten Sitzungsstart vom Empfänger abgerufen (Postfach-Prinzip). |
| Kontingente automatisch auslesen | ❌ | Kein Anbieter bietet das für kostenlose Zugänge oder Abos. Erfassung über die Schaltfläche „Limit erreicht“ samt Zeitpunkt der Freigabe (Kapitel 6.1). |
| Exakter Tokenverbrauch | ❌ | Nicht messbar. Angezeigt wird nur die Größe der Übergabepakete in Zeichen, ausdrücklich als Schätzung. |
| Spracheingabe | ✅ | Diktierfunktion der Handy-Tastatur funktioniert immer. Optional Web Speech API: unter Chrome/Android werden die Daten an Google übertragen (DSGVO-Hinweis), ohne Kosten. |
| Sprachausgabe | ✅ | `speechSynthesis` des Geräts, lokal und kostenlos |
| „Mit der Projektleitung sprechen“ | ⚠️ | Die PWA ist kein Chat mit ChatGPT. Ablauf: diktierter Auftrag → Übergabepaket → in ChatGPT (Web, kostenlos) einfügen → Antwort per Teilen bzw. Einfügen zurück in die Zentrale. |

### 6.1 Arbeitsweise mit kostenlosen Web-Zugängen und Limit-Pausen

| Mitarbeiter | Zugang | Anbindung | Limit-Erkennung |
|---|---|---|---|
| Projektleitung – ChatGPT | chatgpt.com, kostenlos, eigener Login | Übergabepaket ↔ Ergebnis zurück | Meldung im Chat („Limit erreicht, wieder verfügbar um …“) → Sie tippen in der PWA auf **„Limit erreicht“** und übernehmen die Uhrzeit |
| Technische Leitung – Claude Code | Abo (lokal und Cloud) | MCP-Server + GitHub | Claude Code schreibt bei Limit selbst einen Checkpoint und setzt den Status über MCP auf *Wartend* |
| Marketing – Gemini | gemini.google.com, kostenlos | Übergabepaket (optional Gemini CLI, s. o.) | wie ChatGPT |
| QS & Sicherheit – Grok | grok.com, kostenlos | Übergabepaket | wie ChatGPT |

**Ablauf bei aufgebrauchtem Kontingent** (Pflichtenheft Kapitel 10):
1. Die Zentrale markiert die Aufgabe als *Wartend (Limit)* und speichert `limit_bis`. Ist die Uhrzeit unbekannt, gilt eine Standardpause von 3 Stunden (einstellbar).
2. Vor jeder Pause verlangt die Zentrale einen **Checkpoint**. Bei Web-Zugängen ist das die letzte Antwort, per Einfügen übernommen. Die Übergabepakete enthalten dafür immer die Bitte: „Beende jede Antwort mit einem Abschnitt ZWISCHENSTAND.“
3. Nach Ablauf von `limit_bis` kommt eine Push-Nachricht „Gemini wieder verfügbar – Aufgabe TD-0042 fortsetzen“. Das Fortsetzungspaket enthält nur Checkpoint, Aufgabe und Rolle, nicht den alten Verlauf.
4. Optional: Eine dringende Aufgabe kann bei einem Limit an einen anderen verfügbaren Mitarbeiter umgeleitet werden. Das ist eine Stufe-2-Entscheidung mit Informationspflicht.

**Kompakte Pakete:** Kostenlose Zugänge haben kleinere Kontingente und Kontextfenster. Übergabepakete werden deshalb auf Kürze optimiert (Ziel unter ca. 8.000 Zeichen). Die PWA zeigt die Zeichenzahl an und warnt bei Überschreitung.

**Datenschutz bei kostenlosen Zugängen:** Inhalte können dort standardmäßig zum Training genutzt und von Menschen geprüft werden. Deshalb gilt:
- Das Training in den Kontoeinstellungen deaktivieren, wo möglich.
- Keine personenbezogenen Daten von Kunden oder Nutzern und keine Zugangsdaten in Übergabepaketen. Die PWA prüft das vor dem Kopieren (Kapitel 10).

**Option ohne zusätzliche Kosten:** Claude.ai gehört zum Claude-Abo und kann den MCP-Server direkt nutzen. Falls die Projektleitung über ChatGPT (kostenlos) wegen der Limits zu oft pausiert, kann Claude die Rolle übergangsweise übernehmen. Die Geschäftsführung entscheidet das nach der ersten Betriebswoche.

**Konsequenz für die Organisation:** Die Rollen aus Kapitel 2 des Pflichtenhefts bleiben bestehen. Die *Projektleitung* ist jedoch ein Arbeitsmodus, den Sie auslösen: Morgens öffnen Sie z. B. ChatGPT, und die Projektleitung liest über MCP oder ein Übergabepaket den Stand, verteilt Aufgaben und schreibt sie zurück. Sie ist kein Dauerprozess. Die PWA übernimmt alles Deterministische selbst: Status, Fristen, Erinnerungen, Abhängigkeiten, Konfliktsperren, Tagesbericht aus Datenbankdaten.

## 7. Konkrete technische Architektur (Schritt 7)

```
 Smartphone / Tablet / PC (PWA, installierbar)
        │  HTTPS, WebSocket, Web Push
        ▼
┌──────────────────────── Cloudflare (EU-Jurisdiktion für Daten) ───────────────────────┐
│  Worker „te-zentrale“                                                                   │
│   ├─ Static Assets: PWA (Vite + Preact/React, TypeScript, Service Worker)                │
│   ├─ /api/*      REST-API (Hono), Sitzungen, Rechteprüfung, Audit                         │
│   ├─ /mcp        MCP-Server für KI-Werkzeuge (OAuth, projektbezogene Scopes)              │
│   ├─ /github/*   Webhook-Empfang der GitHub App (Signaturprüfung)                         │
│   └─ Cron        Tagesbericht, Erinnerungen, Kostenwächter, Backup → R2                   │
│  D1 „te-zentrale-db“ (eu)      ← Single Source of Truth für Betriebsdaten                │
│  Durable Object „Zentrale“ (eu) ← Echtzeit-Fan-out an verbundene Geräte                   │
│  R2 „te-zentrale-dateien“ (eu) ← Dokumente, Anhänge, D1-Sicherungen                        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ Webhooks / REST (GitHub App)              ▲ MCP / Übergabepakete
   GitHub TE-Tools (Code, Doku, Rollen, ADRs)    Claude Code · Claude.ai · ChatGPT · Gemini · Grok
```

- **Neues Repo:** `TE-Tools/te-digital-zentrale` (Vorschlag), privat. Die Struktur `apps/web`, `apps/worker`, `packages/shared` (Typen, Zod-Schemas), `docs/`, `docs/adr/` und `firma/` (Rollen, Arbeitsanweisungen, Übergabevorlagen als Markdown – die GitHub-Seite aus Kapitel 8 des Pflichtenhefts).
- **Frontend:** Vite + TypeScript + `vite-plugin-pwa` (bewährt in Mini-Games). Design-Tokens aus Kapitel 3, selbst gehostete Schriften, hell und dunkel.
- **Echtzeit:** Jede schreibende API-Anfrage schreibt in D1, danach sendet das DO „Zentrale“ ein schlankes Ereignis (`aufgabe.geaendert`, ID). Die Clients laden nur das Geänderte nach. Offline zeigt die PWA den letzten Stand mit Zeitstempel.
- **Agentenstatus:** Jeder Statuswert trägt `bestaetigt_am`. Ist eine Meldung älter als ein Schwellwert, erscheint „zuletzt bestätigt vor …“ (Anforderung 4.2).
- **Wiederverwendung:** `webpush.js`, `sicherung.js` (D1-Backup) und die Rate-Limit- und Sicherheits-Header-Tests aus den bestehenden Projekten werden nach TypeScript portiert.

## 8. Datenbankmodell und Berechtigungskonzept (Schritt 8)

### 8.1 Tabellen (D1, Auszug)

| Tabelle | Wichtigste Felder |
|---|---|
| `benutzer` | id, name, rolle (`gf`, `leser`), erstellt |
| `passkeys`, `sitzungen` | WebAuthn-Credentials, Sitzungstoken (gehasht), Ablauf, Gerät |
| `mitarbeiter` | id, name, rolle, anbieter (`chatgpt`, `claude`, `gemini`, `grok`, `mensch`), arbeitsweg (`mcp`, `paket`, `github`), status, status_bestaetigt_am, limit_bis, aktiv |
| `projekte` | id, slug, name, beschreibung, ziele, repo, website, hosting, stack, farbe, status |
| `projekt_rechte` | projekt_id, mitarbeiter_id, recht (`lesen`, `schreiben`, `aufgaben_annehmen`) |
| `aufgaben` | id (`TD-0001`), projekt_id, titel, beschreibung, zustaendig_id, prioritaet, status (10 Werte laut Pflichtenheft 6.1), pruefstatus, ergebnis, branch, pr_url, erstellt, aktualisiert, version (optimistisches Sperren) |
| `aufgaben_abhaengigkeiten` | aufgabe_id, haengt_ab_von |
| `uebergaben` | aufgabe_id, ziel, ausgangslage, dateien, ergebnis_soll, einschraenkungen, akzeptanzkriterien, zustaendigkeit, freigaben, kontext_zeichen |
| `checkpoints` | aufgabe_id, mitarbeiter_id, zusammenfassung, naechste_schritte, grund (`zwischenstand`, `limit`, `abschluss`), zeit |
| `nachrichten` | id, art (8 Arten laut Pflichtenheft 6.2), von, an, projekt_id, aufgabe_id, inhalt, gelesen_am, zeit |
| `entscheidungen` | id, stufe (1–3), titel, begruendung, alternativen, projekt_id, aufgabe_id, von, status, entschieden_von, entschieden_am |
| `freigaben` | id, typ (`kosten`, `veroeffentlichung`, `produktiv`, `loeschung`, `sicherheit`, `vertrag`), bezug, status, angefragt_von, entschieden_am, kommentar |
| `repo_sperren` | repo, pfad_muster, aufgabe_id, inhaber_id, seit, bis |
| `github_objekte` | repo, art (`branch`, `pr`, `check`), nummer/name, status, aufgabe_id, aktualisiert |
| `wissen` | id, projekt_id (NULL = Unternehmen), titel, inhalt, quelle_github_pfad, tags, aktualisiert |
| `berichte` | id, typ (`tag`, `projekt`), datum, projekt_id, inhalt |
| `benachrichtigungen`, `push_abos`, `benachrichtigungs_regeln` | Kategorie (kritisch, wichtig, tagesbericht), Häufigkeit, Ruhezeiten |
| `aktivitaeten` | Audit-Protokoll, nur anhängend: wer, was, Objekt, vorher/nachher-Hash, zeit, IP-Kürzel |
| `kosten_messwerte` | dienst, metrik, wert, freigrenze, datum |

### 8.2 Berechtigungen

- **Menschen:** Die Geschäftsführung sieht und darf alles. Optionale Rolle `leser`. Anmeldung per **Passkey** (Face ID, Fingerabdruck, Windows Hello). Das ist von Haus aus phishing-resistent und mehrfaktorig, ohne Passwortspeicher und ohne teures Hashing. Dazu Wiederherstellungscodes. **Stufe-3-Freigaben verlangen eine erneute Passkey-Bestätigung.**
- **KI-Mitarbeiter:** Kein Benutzerkonto, sondern ein **Zugriffstoken pro Mitarbeiter** (MCP/OAuth). Es ist auf die Projekte aus `projekt_rechte` beschränkt. Erlaubt: Kontext lesen, eigene Aufgaben annehmen und aktualisieren, Nachrichten, Checkpoints und Ergebnisse schreiben, Entscheidungen der Stufe 1–2 dokumentieren, Freigaben *beantragen*. **Technisch ausgeschlossen:** Freigaben erteilen, Rechte ändern, Projekte oder Daten löschen.
- **Datensparsamkeit beim Kontext:** Der MCP-Server liefert pro Aufgabe ein zugeschnittenes Kontextpaket: Rolle, Aufgabe, Übergabe, letzter Checkpoint, verlinkte Entscheidungen, relevante Wissensartikel. Komplette Verläufe werden nie ausgeliefert.
- **Audit:** Jede schreibende Aktion landet in `aktivitaeten`. Entscheidungen und Freigaben sind unveränderlich, Korrekturen erfolgen als neuer Eintrag.

### 8.3 Git-Konfliktschutz

1. Jede Entwicklungsaufgabe bekommt den Branch `aufgabe/TD-0001-kurztitel`.
2. Die Zentrale legt bei Übernahme eine Sperre an (Repo + Pfadmuster). Eine überlappende Sperre einer anderen Aufgabe führt zu einer Warnung und dem Status *Blockiert*.
3. Über Webhooks erkennt die Zentrale offene PRs, die dieselben Dateien ändern, und zeigt sie als Konfliktwarnung an.
4. Branch-Schutz auf `main`: PR und grüne Checks sind Pflicht, der Merge erfolgt nur nach Freigabe in der Zentrale. Die GitHub App erhält **kein** Merge- oder Push-Recht auf `main`.

### 8.4 GitHub-Verbindung – Einrichtung durch die Geschäftsführung (E7)

Die Verbindung wird **nicht** von der Entwicklung vorkonfiguriert. Die Geschäftsführung legt sie selbst im Administrationsbereich der PWA an und gibt sie frei:

1. **Verwaltung → GitHub → „Verbindung einrichten“.** Die PWA startet den offiziellen *GitHub-App-Manifest-Ablauf*. Auf github.com bestätigen Sie den App-Namen (z. B. „TE-Zentrale“) und die vorgeschlagenen, minimalen Rechte:
   - Metadaten, Pull Requests, Checks, Issues: lesen
   - Issues und Kommentare: schreiben
   - kein Schreibrecht auf Code
2. **Installation:** Sie installieren die App in der Organisation TE-Tools und wählen auf GitHub **selbst die freigegebenen Repos** aus. Das ist die eigentliche Freigabe, und Sie können sie dort jederzeit ändern.
3. **Speicherung:** GitHub übergibt der Zentrale App-ID, privaten Schlüssel und Webhook-Geheimnis. Diese Daten werden **verschlüsselt** in D1 abgelegt (AES-GCM). Der Schlüssel dazu liegt ausschließlich als Worker-Secret vor. Angezeigt wird danach nur noch „verbunden seit …, n Repos“.
4. **Jede Änderung ist Stufe 3:** Verbinden, Rechte erweitern und Trennen verlangen eine erneute Passkey-Bestätigung und werden im Audit-Protokoll vermerkt.
5. **Trennen:** Die Schaltfläche löscht die gespeicherten Schlüssel. Zusätzlich verlinkt sie auf die GitHub-Seite, auf der Sie die App deinstallieren.

Bis zur Einrichtung zeigt der Projektbereich GitHub-Felder nur als manuell gepflegte Angaben (Repo-URL, Branch). Die Phasen 2–4 hängen nicht davon ab.

## 9. Entwicklungsphasen und Abhängigkeiten (Schritt 9)

| Phase | Inhalt | Abhängig von | Ergebnis / Abnahme |
|---|---|---|---|
| **P1 Bestandsaufnahme** | Dieses Dokument; fehlende Repos sichten; Cloudflare-Tarif prüfen; Logo-SVG extrahieren | – | Freigabe dieses Plans |
| **P2 Grundsystem** | Repo, CI/CD, Worker + Static Assets, D1 (eu), Passkey-Login, Design-System hell/dunkel, Dashboard (Grundgerüst), Projektverwaltung mit Import der 7 Projekte | P1 | PWA installierbar auf Android, iOS und Windows; Projekte sichtbar; Tests grün |
| **P3 Agentenverwaltung** | Mitarbeiter, Aufgaben (Status, Abhängigkeiten), Übergabepakete, Nachrichten, Entscheidungen, Freigaben mit Step-up, Audit | P2 | Auftrag mobil anlegen → Übergabe kopieren → Ergebnis zurückführen → freigeben |
| **P4 Mobil & Push** | Durable Object Echtzeit, Web Push (3 Kategorien, Einstellungen), Share Target, Spracheingabe, Offline-Anzeige | P3 | Zwei Geräte sehen Änderungen live; Push auf Android + iOS (Home-Bildschirm) |
| **P5 Entwicklungsintegration** | GitHub App, Branch- und PR-Übersicht, Sperren, Konflikterkennung; **MCP-Server** für Claude Code und Claude.ai; Claude-Code-Ablauf lokal und in der Cloud; Test Gemini CLI (kostenlos) | P3 (P4 parallel möglich) | Claude Code holt TD-Aufgabe per MCP, arbeitet im Branch, PR erscheint in der Zentrale |
| **P6 Wissen & Berichte** | Wissensbereich (GitHub-`firma/` und Projektdoku synchronisiert), Checkpoints, Kontextpakete, Tagesbericht per Cron + Push, Kostenwächter | P3, P5 | Tagesbericht morgens auf dem Handy; Fortsetzung nach Limit ab Checkpoint |
| **P7 QS & Produktiv** | E2E (Playwright, mobile Viewports), Rechte- und Sicherheitstests, Backup-Wiederherstellungstest, DSGVO-Unterlagen, Leistungsmessung | alle | Abnahmekriterien 1–15 abgehakt, Freigabe durch die GF |

**MVP-Vorschlag** – erster nutzbarer Stand: P2 + P3 + Push aus P4. Damit sind Abnahmekriterien 1–8 und 10–11 erfüllbar. Der MCP-Server (P5) bringt danach den größten Nutzen.

Jede Phase endet mit Tests, aktualisierter Doku, einem Changelog-Eintrag und einer Vorführung auf dem Smartphone.

## 10. Sicherheit und Datenschutz

- **HTTPS** und HSTS. Eine strenge CSP ohne externe Skripte und Schriften (Vorlage: `_headers` plus Header-Test aus dem Familienplaner). Native Rate Limits auf Login und MCP.
- **Secrets** (VAPID, GitHub-App-Key, Webhook-Secret) nur als Worker-Secrets. **Keine Zugangsdaten zu KI-Anbietern** werden gespeichert – die Anmeldung erfolgt immer im jeweiligen Anbieter.
- **Backups:** täglicher D1-Export nach R2 (Vorlage `sicherung.js`), Aufbewahrung 30 Tage, dazu D1 Time Travel. In P7 wird die Wiederherstellung getestet.
- **DSGVO:** Daten liegen per Jurisdiktion in der EU. Cloudflare ist dennoch ein US-Anbieter (Data Privacy Framework; AVV über das Cloudflare-Self-Serve-Abkommen). Die Unterlagen aus `alltagstools-DSGVO/` werden als Vorlage für Verzeichnis, TOM und Löschkonzept genutzt.
- **Inhalte, die Sie in ChatGPT, Gemini oder Grok einfügen, verlassen die Zentrale.** Empfehlung: In den kostenlosen Konten die Nutzung zum Modelltraining deaktivieren und keine personenbezogenen Kundendaten in Übergabepakete aufnehmen. Die PWA warnt bei erkennbaren E-Mail-Adressen und Telefonnummern.

## 11. Kostenkontrolle

- Ein Cron-Job liest täglich die Nutzungswerte über die Cloudflare GraphQL Analytics API (kostenlos, Token nur mit Leserecht) und speichert sie in `kosten_messwerte`.
- Ab **80 %** einer Freigrenze erzeugt er die Push-Kategorie *Wichtig*, ab **95 %** *Kritisch* – jeweils mit Ursache (welcher Dienst, welche Metrik).
- Ein Wechsel auf einen kostenpflichtigen Tarif ist immer eine Stufe-3-Freigabe. Die Anwendung selbst kann keine Tarife ändern, da das API-Token keine Abrechnungsrechte hat.

## 12. Offene Entscheidungen der Geschäftsführung

| # | Frage | Empfehlung |
|---|---|---|
| E1 | Adresse der Zentrale | `zentrale.te-alltagshelfer.org` (0 €). Alternativ eine eigene te-digital-Domain. |
| E2 | Anmeldung | Passkeys + Wiederherstellungscodes. Optional zusätzlich Cloudflare Access (kostenlos) als äußerer Schutz. |
| E3 | Abweichung „Worker mit Static Assets statt Pages“ | Zustimmen |
| E4 | Repo-Name und Anlage | `TE-Tools/te-digital-zentrale`, privat. Die Anlage erfolgt durch Sie oder nach Ihrer Freigabe. |
| E5 | MVP-Umfang | P2 + P3 + Push zuerst |
| E6 | Projektleitung | **Entschieden:** ChatGPT (kostenlos) per Übergabepaket. Nach der ersten Betriebswoche prüfen, ob Claude.ai (Abo, MCP) besser passt (Kapitel 6.1). |
| E7 | GitHub-Zugriff | **Entschieden:** Die Geschäftsführung hinterlegt und gibt die GitHub-Verbindung selbst in der PWA frei (Kapitel 8.4). Die Repos `te-plattform` und `vereinsleben` werden erst danach über diese Verbindung gesichtet. |
| E8 | Cloudflare-Tarif | **Entschieden:** Workers **Free**. Folgen für die Umsetzung siehe Kapitel 4.1. |
| ~~E9~~ | ~~Designgrundlage~~ | **Entschieden 19.11.2026:** te-alltagshelfer.org, modernisiert als Firmen-Dashboard (Kapitel 3) |

---

### Quellen (Tarife und Datenstandort, abgerufen am 19.11.2026)
- [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 Limits](https://developers.cloudflare.com/d1/platform/limits) · [D1 Data location](https://developers.cloudflare.com/d1/configuration/data-location/)
- [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing) · [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits) · [Durable Objects Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)
- [Cloudflare Zero Trust Pläne](https://www.cloudflare.com/plans/sase-zero-trust.md)
