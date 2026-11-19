# Verzeichnis von Verarbeitungstätigkeiten – TE-Digital Zentrale (Art. 30 Abs. 1 DSGVO)

Stand: 19.11.2026 · bei jeder wesentlichen Änderung prüfen.

**Verantwortlicher:** TE-Digital (Inhaber) – Anschrift und Kontakt wie im Verzeichnis der TE-Alltagshelfer (`te-alltagstools-website/alltagstools-DSGVO/VERARBEITUNGSVERZEICHNIS.md`). Kein Datenschutzbeauftragter erforderlich (§ 38 BDSG).

**Art der Anwendung:** Internes Werkzeug der Geschäftsführung (ein Benutzer, optional Lesezugänge). Keine Kunden- oder Endnutzerdaten der TE-Apps. Kunden- und personenbezogene Daten Dritter sollen **nicht** in Aufgaben, Übergabepakete oder Wissen eingetragen werden; die Zentrale warnt vor E-Mail-Adressen, Telefonnummern und Zugangsdaten in Übergabepaketen.

Empfänger-Kürzel: **CF** = Cloudflare (Workers, D1 und Durable Object mit EU-Jurisdiktion, Rate Limiting, Analytics; USA, DPF + SCC) · **GH** = GitHub (Quellcode, Firmendokumente, Sicherungs-Artefakte, GitHub-App; USA, DPF + SCC) · **PD** = Push-Dienste der Browser-Hersteller (Google, Apple, Mozilla, Microsoft) – Inhalte Ende-zu-Ende verschlüsselt · **AN** = Anthropic (Claude-Abo der Geschäftsführung, MCP-Zugriff) · **KI-Web** = ChatGPT, Gemini, Grok (kostenlose Web-Zugänge, von der Geschäftsführung manuell genutzt) · **SR** = Spracherkennung des Browsers (Google bei Chrome/Edge, Apple bei Safari) – nur wenn das Diktat genutzt wird.

| # | Verarbeitung | Zweck | Betroffene | Datenkategorien | Rechtsgrundlage | Empfänger | Löschung |
|---|---|---|---|---|---|---|---|
| 1 | Anmeldung | Zugang absichern | Geschäftsführung, Lesezugänge | Name, Rolle, Passkey (öffentlicher Schlüssel), Sitzung (Token-Hash, Gerätekennung/User-Agent), Wiederherstellungscodes (Hash) | Art. 6 (1) f (Sicherheit), b | CF | Sitzung nach Ablauf (30 Tage) stündlich; Passkeys/Codes mit dem Benutzer |
| 2 | Unternehmenssteuerung | Aufgaben, Projekte, Kommunikation, Entscheidungen, Freigaben, Wissen, Berichte | Geschäftsführung; KI-Mitarbeiter sind keine Personen | Arbeitsinhalte, Namen der Rollen, Zeitstempel | Art. 6 (1) f | CF | nach Bedarf durch die GF (archivieren); Entscheidungen/Freigaben dauerhaft (Nachweis) |
| 3 | Audit-Protokoll | Nachvollziehbarkeit, Schutz gegen unberechtigte Änderungen | Geschäftsführung | Akteur (Name/Rolle), Aktion, Objekt, Zeit | Art. 6 (1) f | CF | dauerhaft (unveränderlich), keine IP-Adressen |
| 4 | Push-Benachrichtigungen | Hinweise aufs Handy | Geschäftsführung | Push-Abo je Gerät (Endpunkt, Schlüssel), Gerätebezeichnung, Meldungstexte | Art. 6 (1) f / Einwilligung im Browser | CF, PD | Abo beim Abmelden bzw. nach Ablauf; Meldungen gelesen nach 90, sonst 180 Tagen |
| 5 | KI-Zugänge (MCP) | Claude Code arbeitet mit der Zentrale | Geschäftsführung (als Inhaber des Abos) | Token-Hash, Bezeichnung, Zeitpunkt letzter Nutzung; übertragene Arbeitsinhalte | Art. 6 (1) f | CF, AN | Widerruf jederzeit; Inhalte bei AN nach dessen Bedingungen |
| 6 | Übergabepakete an KI-Web-Dienste | Arbeit durch ChatGPT/Gemini/Grok | – (keine personenbezogenen Daten vorgesehen) | Arbeitsinhalte (manuell kopiert) | Art. 6 (1) f | KI-Web | beim Anbieter nach dessen Bedingungen; Training in den Konten möglichst deaktivieren |
| 7 | GitHub-Anbindung | PRs, Checks, Branches anzeigen | Entwickler-Konten (GitHub-Benutzernamen) | Repository-, PR- und Check-Daten, Autor-Login | Art. 6 (1) f | GH, CF | mit der Trennung der Verbindung (Repos); PR-Daten bei Bedarf |
| 8 | Spracheingabe (optional) | Diktieren | Geschäftsführung | Audio während des Diktats | Art. 6 (1) a (Hinweis vor erster Nutzung) | SR | keine Speicherung in der Zentrale |
| 9 | Drosselung & Betrieb | Missbrauchsschutz, Fehleranalyse | alle Aufrufenden | IP-Adresse (flüchtig im Zähler), Logs | Art. 6 (1) f | CF | Zähler minutenweise; Logs nach Cloudflare-Fristen |
| 10 | Kostenwächter | Kostenkontrolle | – | Nutzungszahlen des Cloudflare-Kontos | Art. 6 (1) f | CF | 90 Tage |
| 11 | Sicherungen | Wiederherstellung | wie 1–7 | vollständiger Datenbank-Export, AES-256-verschlüsselt | Art. 6 (1) f, Art. 32 | GH (Artefakt) | 30 Tage |

**Datenstandort:** D1-Datenbank und Durable Object mit **EU-Jurisdiktion** (Speicherung und Ausführung in der EU). Cloudflare und GitHub sind US-Unternehmen (DPF-zertifiziert, ergänzend SCC); ein Zugriff nach US-Recht ist rechtlich nicht ausgeschlossen – deshalb Grundsatz: keine Kunden- oder sensiblen Daten in der Zentrale.

**Besondere Kategorien (Art. 9):** keine vorgesehen. **DSFA (Art. 35):** nicht erforderlich (keine umfangreiche oder risikoreiche Verarbeitung, ein Benutzer).
