# Betriebshandbuch – TE-Digital Zentrale

## Stand der Einrichtung (19.11.2026)

- ✅ D1-Datenbank `te-zentrale-db` im Dashboard angelegt, Hoheitsgebiet **Europäische Union**, ID in `wrangler.jsonc` eingetragen.
- ✅ Zone `te-alltagshelfer.org` liegt im Konto → `zentrale.te-alltagshelfer.org` wird beim ersten Deploy automatisch angelegt.
- ℹ️ `wrangler login` ist im Firmennetz nicht möglich (TLS-Prüfung des Netzes). Veröffentlicht wird deshalb über **GitHub Actions** (Workflow „Produktivsetzung“); der Workflow setzt die Server-Secrets selbst. Lokal ginge es alternativ außerhalb des Firmennetzes (z. B. Handy-Hotspot).
- ℹ️ Kein Cron-Trigger: Der Free-Tarif erlaubt 5 Cron-Trigger **je Konto**, die sind durch die anderen TE-Apps belegt. Der 15-Minuten-Takt (Limit-Pausen, zurückgestellte Meldungen, Tagesbericht, Kostenwächter) läuft deshalb als Durable-Object-Alarm in `ZentraleLive`. `/api/gesundheit` meldet `"takt": true`, wenn der Alarm geplant ist (wird beim Rauchtest automatisch gestartet).
- ✅ API-Token „TE-Zentrale GitHub-Deploy“ (Konto + Zone `te-alltagshelfer.org`) erstellt.
- ⬜ Geschäftsführung: API-Token erstellen und die Secrets in GitHub eintragen (siehe unten, „Kurzfassung GitHub-Weg“).

### Kurzfassung GitHub-Weg

1. Cloudflare → *Mein Profil → API-Token → Token erstellen → „Eigenes Token“* mit: Konto · **Workers-Skripts: Bearbeiten**, Konto · **D1: Bearbeiten**, Konto · **Kontoeinstellungen: Lesen**, Zone `te-alltagshelfer.org` · **Workers-Routen: Bearbeiten**, Zone · **DNS: Bearbeiten**, Zone · **Zone: Lesen**. Optional zweites Token nur **Konto-Analysen: Lesen** für den Kostenwächter.
2. GitHub → Repository → *Settings → Environments → produktion → Environment secrets*: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (= `562079303f8e0ed15ed58f0d7d50610e`), `SICHERUNG_PASSWORT` (langer Zufallswert, offline aufbewahren), `EINRICHTUNGSCODE` (selbst gewählt, für die Ersteinrichtung), optional `CF_ANALYTICS_TOKEN`. Für die nächtliche Sicherung dieselben drei Cloudflare-/Sicherungswerte zusätzlich als *Repository secrets*.
3. *Actions → Produktivsetzung → Run workflow*: „veröffentlichen“ eingeben, **Erste Veröffentlichung** ankreuzen, in der Umgebung freigeben.
4. `https://zentrale.te-alltagshelfer.org` öffnen → Einrichtungscode → Passkey → Wiederherstellungscodes sichern.

## Automatik einrichten (Aufträge ohne Kopieren)

**Assistent (Workers AI):** Hier ist nichts zu tun. Die Bindung `AI` kommt mit der nächsten Produktivsetzung. Die Grenze ist das Gratis-Kontingent von 10.000 Neurons pro Tag, im Free-Tarif entstehen keine Kosten.

**Claude Code auf GitHub (Claude-Abo):** Die Schritte sind Stufe 3, die Geschäftsführung führt sie selbst aus.

1. **Abo-Token erzeugen:** Auf dem eigenen PC im Terminal ausführen:
   ```powershell
   claude setup-token
   ```
   Die Ausgabe ist der Token. Er gilt etwa 1 Jahr und hängt am persönlichen Abo. Nie weitergeben.
2. **KI-Zugang anlegen:** In der Zentrale unter *Einstellungen → KI-Zugänge → Zugang erstellen* den Mitarbeiter „Claude Code“ wählen. Das Token kopieren, es wird nur einmal angezeigt.
3. **Secrets in GitHub eintragen:** Im Repository `TE-Digital-Zentrale` unter *Settings → Secrets and variables → Actions → New repository secret* anlegen:
   - `CLAUDE_CODE_OAUTH_TOKEN`: der Token aus Schritt 1
   - `TE_ZENTRALE_TOKEN`: das Token aus Schritt 2
4. **GitHub-Verbindung:** Sie wird in der Zentrale unter *Einstellungen → GitHub-Verbindung* eingerichtet. Die App bekommt dabei das Recht **Actions: Read and write**, damit sie den Workflow starten darf.
   - Ist die App schon vorher angelegt worden, gilt Folgendes: Auf GitHub unter *Settings → Developer settings → GitHub Apps → App → Permissions* das Recht *Actions: Read and write* ergänzen. Danach die Änderung in der Installation bestätigen.
5. **Weitere Projekt-Repositories (optional):**
   - `.github/workflows/ki-auftrag.yml` in das jeweilige Repository kopieren und dieselben zwei Secrets anlegen.
   - Das Repository in der Zentrale mit dem Projekt verknüpfen. Ohne verknüpftes Repository arbeitet Claude in `TE-Digital-Zentrale`.
6. **Empfohlen:** Branch-Schutz für `main` setzen (*Settings → Branches*), damit auch versehentlich nichts direkt auf `main` landet.

## Erstmalige Produktivsetzung (Stufe 3 – Geschäftsführung)

Alles, was ein Konto, Kosten oder Veröffentlichung betrifft, führt die Geschäftsführung selbst aus. Claude Code bereitet vor und prüft.

1. **Cloudflare (eigener Rechner):**
   ```powershell
   npx wrangler login
   npx wrangler d1 create te-zentrale-db --jurisdiction eu
   ```
   Die ausgegebene `database_id` in `apps/worker/wrangler.jsonc` unter `env.produktion.d1_databases` eintragen (Commit).
2. **Secrets setzen** (im Ordner `apps/worker`, jeweils `npx wrangler secret put <NAME> --env produktion`):
   - `EINRICHTUNGSCODE` – langer Zufallswert, nur für die Ersteinrichtung
   - `ZENTRALE_SCHLUESSEL` – `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
   - optional `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (`node scripts/vapid.mjs`) – sonst erzeugt der Worker sie selbst
   - optional `CF_ACCOUNT_ID` + `CF_ANALYTICS_TOKEN` (API-Token nur „Account Analytics: Lesen“) – Kostenwächter
3. **GitHub vorbereiten** (Repository → Settings):
   - *Environments → New environment „produktion“*, **Required reviewers: Geschäftsführung**
   - Secrets der Umgebung: `CLOUDFLARE_API_TOKEN` (Rechte: Workers bearbeiten, D1 bearbeiten, Workers Routes/Custom Domains für die Zone), `CLOUDFLARE_ACCOUNT_ID`, `SICHERUNG_PASSWORT` (langer Zufallswert – **zusätzlich offline aufbewahren**, ohne ihn ist keine Sicherung lesbar)
   - Dieselben drei Werte als Repository-Secrets für den Sicherungs-Workflow; Repository-Variable `PRODUKTIV = ja`
4. **Veröffentlichen:** *Actions → Produktivsetzung → Run workflow*, „veröffentlichen“ eingeben, Freigabe in der Umgebung erteilen. Der Ablauf prüft (Typen, Tests, Build, Budget), sichert, migriert, veröffentlicht und macht einen Rauchtest.
5. **Ersteinrichtung:** `https://zentrale.te-alltagshelfer.org` öffnen → Einrichtungscode → Passkey anlegen → **Wiederherstellungscodes sicher aufbewahren**. Danach auf dem Handy: Seite öffnen, „Zum Home-Bildschirm“, mit Passkey anmelden, unter *Benachrichtigungen* Push aktivieren.
6. **Optional verbinden:** *Einstellungen → GitHub-Verbindung* (Passkey) und *KI-Zugänge* für Claude Code.

## Laufender Betrieb

| Was | Wie |
|---|---|
| Neue Version | Pull Request → CI „Prüfen“ (Tests, E2E Desktop/Handy, Budget, Audit) → Merge → *Produktivsetzung* manuell |
| Sicherung | nächtlich automatisch (verschlüsselt, 30 Tage, mit Wiederherstellungstest); zusätzlich vor jeder Produktivsetzung |
| Kosten | Berichte → Infrastruktur & Kosten; Push bei 80 %/95 % |
| Fehler | Cloudflare-Dashboard → Workers → te-zentrale → Logs (Observability) |
| Gerät verloren | mit Wiederherstellungscode anmelden → *Einstellungen → Passkeys*: neues Gerät hinzufügen; Sitzungen des verlorenen Geräts laufen nach 30 Tagen ab (sofort: D1-Konsole `DELETE FROM sitzungen WHERE geraet LIKE …`) |
| KI-Zugang kompromittiert | *Einstellungen → KI-Zugänge → sperren* (sofort wirksam) |

## Wiederherstellung

**A) Zeitpunkt der letzten 7 Tage (D1 Time Travel, Free-Tarif):**
```powershell
npx wrangler d1 time-travel info te-zentrale-db --env produktion
npx wrangler d1 time-travel restore te-zentrale-db --env produktion --timestamp 2026-11-19T06:00:00Z
```

**B) Aus einer Sicherung (GitHub-Artefakt):**
1. Artefakt herunterladen, entschlüsseln:
   ```powershell
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -in te-zentrale-2026-11-19.sql.gz.enc -out sicherung.sql.gz
   ```
   Danach entpacken (`gzip -d sicherung.sql.gz`).
2. Probe lokal: `npm run wiederherstellung:testen -- sicherung.sql`
3. In eine **neue** D1-Datenbank (EU) einspielen, ID in `wrangler.jsonc` umstellen, veröffentlichen:
   ```powershell
   npx wrangler d1 create te-zentrale-db-wiederhergestellt --jurisdiction eu
   npx wrangler d1 execute te-zentrale-db-wiederhergestellt --remote --file sicherung.sql
   ```
   Wiederherstellen ist eine Änderung am Produktivsystem → Stufe 3.

## Notfall: Kosten / Tarif
Im Free-Tarif entstehen keine Kosten; bei 100 % schlagen Anfragen bis 01:00 Uhr fehl. Ein Wechsel auf Workers Paid ist eine Stufe-3-Freigabe.
