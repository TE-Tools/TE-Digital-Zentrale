# Auftragsverarbeiter und Dienste – Checkliste

Stand: 19.11.2026. Vor der Produktivsetzung prüfen und abhaken.

| Dienst | Rolle | Vertrag | Drittland | Status |
|---|---|---|---|---|
| Cloudflare (Workers, D1, Durable Objects, Analytics, Workers AI für den „Assistenten“) | Auftragsverarbeiter | Cloudflare DPA (Teil der Self-Serve-Bedingungen) | USA – DPF + SCC; Daten per EU-Jurisdiktion in der EU | ☐ DPA im Cloudflare-Dashboard bestätigt (bereits für die TE-Apps genutzt?) |
| GitHub (Repository, Actions inkl. KI-Aufträge mit Claude Code, Artefakte, App) | Auftragsverarbeiter | GitHub DPA (Teil der Kundenbedingungen) | USA – DPF + SCC | ☐ geprüft |
| Anthropic (Claude-Abo, Claude Code) | eigener Vertrag der Geschäftsführung | Verbraucher-/Abo-Bedingungen; für geschäftliche Inhalte Einstellungen zur Datennutzung prüfen | USA | ☐ Einstellungen zur Modell-Verbesserung geprüft – laut alltagstools-DSGVO ist der AVV mit Anthropic noch offen |
| ChatGPT / Gemini / Grok (kostenlos) | kein Auftragsverarbeiter (Verbraucherkonten, manuelle Nutzung) | – | USA | ☐ Training in den Konten deaktiviert, wo möglich · Grundsatz: keine personenbezogenen Daten |
| Push-Dienste (Google FCM, Apple, Mozilla, Microsoft) | technische Übermittlung, Inhalte E2E-verschlüsselt | – | USA | – |
| Spracherkennung im Browser (optional) | Browser-Hersteller | – | USA | Hinweis vor erster Nutzung in der App |
