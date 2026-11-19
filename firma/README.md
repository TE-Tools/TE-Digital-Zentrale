# Firma – Struktur, Rollen und Arbeitsanweisungen

Dieser Ordner ist die **versionierte Quelle** für Organisation, Rollen und Arbeitsweisen der TE-Digital AI Company (Pflichtenheft Kap. 8: GitHub enthält Firmenstruktur, Agentenrollen und Arbeitsanweisungen).

- Beim Aufbau der Datenbank werden die Dokumente als Startbestand ins **Unternehmenswissen** übernommen (Migration `0006_wissen_berichte.sql`, erzeugt mit `node scripts/firma-zu-sql.mjs`).
- Danach wird in der Zentrale weitergepflegt – jede Änderung ist dort versioniert. Wesentliche Änderungen an Rollen und Regeln bitte zusätzlich hier per Pull Request nachziehen.
- Die `zusammenfassung` im Kopf fließt in die Übergabepakete der KI-Mitarbeiter ein. Sie soll kurz bleiben (max. ca. 500 Zeichen).
