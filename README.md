# TE-Digital Zentrale

Zentrale Unternehmenssteuerung von TE-Digital als PWA: KI-Mitarbeiter, Projekte, Aufgaben, Freigaben und Unternehmenswissen. Grundlage sind das Pflichtenheft v1.0 und der freigegebene Plan in [docs/Bestandsaufnahme-und-Implementierungsplan.md](docs/Bestandsaufnahme-und-Implementierungsplan.md).

**Stand:** Phase 2 (Grundsystem) – lokal lauffähig, noch nicht in Cloudflare angelegt.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `apps/worker` | Cloudflare Worker (Hono, TypeScript): API, Passkey-Anmeldung, D1-Migrationen, Tests (laufen in workerd) |
| `apps/web` | PWA (Preact, Vite, `vite-plugin-pwa`): Dashboard, Projekte, Mitarbeiter, Einstellungen |
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
3. `npx wrangler secret put EINRICHTUNGSCODE --env produktion`
4. `npm run build` und danach `npx wrangler deploy --env produktion` im Ordner `apps/worker`. Die Custom Domain `zentrale.te-alltagshelfer.org` wird dabei angelegt.
5. Die Zentrale öffnen, mit dem Einrichtungscode den Passkey anlegen und die Wiederherstellungscodes sichern.
