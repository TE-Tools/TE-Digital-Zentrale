# Löschkonzept – TE-Digital Zentrale

Stand: 19.11.2026. Automatische Löschungen laufen stündlich im Cron (`apps/worker/src/cron.ts → aufraeumen`).

| Daten | Frist | Umsetzung |
|---|---|---|
| Sitzungen | Ablauf nach 30 Tagen; danach stündlich gelöscht. Abmelden löscht sofort | automatisch |
| Anmelde-Challenges (WebAuthn) | 5 Minuten | automatisch |
| GitHub-Einrichtungs-Token (state) | 15 Minuten | automatisch |
| Benachrichtigungen (Posteingang) | gelesene nach 90 Tagen, alle nach 180 Tagen | automatisch |
| Push-Abos | beim Abmelden des Geräts; vom Push-Dienst als ungültig gemeldete sofort; nach 10 Fehlversuchen | automatisch |
| Kosten-Messwerte | 90 Tage | automatisch |
| Sicherungen (GitHub-Artefakte) | 30 Tage | GitHub-Aufbewahrung |
| KI-Zugänge | Widerruf sofort wirksam; Eintrag bleibt als Nachweis (nur Hash, kein Token) | manuell |
| Aufgaben, Nachrichten, Wissen, Berichte | Arbeitsunterlagen – archivieren statt löschen; Löschung wichtiger Daten ist Stufe 3 | manuell nach Freigabe |
| Entscheidungen, Freigaben, Audit-Protokoll | dauerhaft (Nachweispflicht, Pflichtenheft 3), technisch unveränderlich; enthalten keine IP-Adressen | – |
| Benutzer | auf Anfrage/bei Ausscheiden: Benutzer, Passkeys, Codes, Sitzungen, Push-Abos werden mitgelöscht (ON DELETE CASCADE); Name im Audit bleibt als Nachweis | manuell |

**Hinweis:** Daten bei Dritten (Anthropic, ChatGPT, Gemini, Grok, Push-Dienste) unterliegen deren Fristen – deshalb keine personenbezogenen Daten in Übergabepakete.
