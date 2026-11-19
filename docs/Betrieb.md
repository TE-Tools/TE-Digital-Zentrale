# Betriebshandbuch – TE-Digital Zentrale

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
