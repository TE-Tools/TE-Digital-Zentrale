/**
 * Erzeugt das Übergabepaket für einen KI-Mitarbeiter (Pflichtenheft 6.3, 11).
 * Ziel: kompakt (kostenlose Web-Zugänge haben kleine Kontingente), vollständig genug,
 * damit der Mitarbeiter ohne alten Chatverlauf arbeiten kann.
 */

export const PAKET_ZIEL_ZEICHEN = 8000;

export interface PaketDaten {
  aufgabe: { id: string; titel: string; beschreibung: string; prioritaet: string; status: string };
  projekt: { name: string; kurz: string; stack: string; repo_url: string | null } | null;
  mitarbeiter: { name: string; rolle: string } | null;
  uebergabe: {
    ziel: string;
    ausgangslage: string;
    dateien: string;
    ergebnis_soll: string;
    einschraenkungen: string;
    akzeptanzkriterien: string;
    freigaben: string;
  } | null;
  checkpoint: { zusammenfassung: string; naechste_schritte: string; zeit: string } | null;
  entscheidungen: { id: string; stufe: number; titel: string }[];
  abhaengigkeiten: { id: string; titel: string; status: string }[];
  offeneRueckfragen: { von: string; inhalt: string }[];
}

export type PaketModus = 'voll' | 'fortsetzung';

const STUFEN_REGEL =
  'Entscheidungsrahmen: Stufe 1 (Recherche, Entwürfe, Konzepte, interne Tests) selbstständig. ' +
  'Stufe 2 (größere technische/planerische Änderungen) nur mit Information an Projektleitung und Geschäftsführung. ' +
  'Stufe 3 (Kosten, Verträge, Veröffentlichungen, Produktivsetzung, Löschen wichtiger Daten, Sicherheits-/Rechteänderungen) ' +
  'NIEMALS selbst ausführen – nur als Freigabeantrag formulieren.';

const ANTWORTFORMAT = [
  '## Antwortformat',
  'Antworte auf Deutsch und gliedere deine Antwort genau mit diesen Überschriften:',
  'ERGEBNIS: das Arbeitsergebnis',
  'OFFENE FRAGEN: Rückfragen an die Geschäftsführung (oder „keine“)',
  'FREIGABEANTRÄGE: Stufe-3-Maßnahmen, die eine Freigabe brauchen (oder „keine“)',
  'ZWISCHENSTAND: 2–5 Sätze – was erledigt ist und was als Nächstes kommt, damit nach einer Unterbrechung nahtlos weitergearbeitet werden kann.',
].join('\n');

function abschnitt(titel: string, inhalt: string | null | undefined): string {
  const t = (inhalt ?? '').trim();
  return t ? `## ${titel}\n${t}` : '';
}

function datum(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });
}

export function erzeugePaket(d: PaketDaten, modus: PaketModus = 'voll', jetzt = new Date()): string {
  const a = d.aufgabe;
  const u = d.uebergabe;
  const kopf = [
    `# ${modus === 'fortsetzung' ? 'Fortsetzung' : 'Auftrag'} ${a.id} – ${a.titel}`,
    `Projekt: ${d.projekt?.name ?? '–'} · Priorität: ${a.prioritaet} · Stand: ${datum(jetzt.toISOString())}`,
  ].join('\n');

  const rolle = d.mitarbeiter
    ? `## Deine Rolle\nDu arbeitest als ${d.mitarbeiter.rolle} der TE-Digital AI Company.${modus === 'voll' ? ' ' + STUFEN_REGEL : ' Stufe-3-Maßnahmen nur als Freigabeantrag.'}`
    : `## Rahmen\n${STUFEN_REGEL}`;

  const teile: string[] = [kopf, rolle];

  if (modus === 'fortsetzung') {
    teile.push(abschnitt('Ziel', u?.ziel || a.beschreibung));
    teile.push(
      d.checkpoint
        ? `## Letzter Zwischenstand (${datum(d.checkpoint.zeit)})\n${d.checkpoint.zusammenfassung}${d.checkpoint.naechste_schritte ? `\nNächste Schritte: ${d.checkpoint.naechste_schritte}` : ''}`
        : '## Letzter Zwischenstand\nNoch keiner gespeichert – bitte von vorne beginnen.',
    );
    teile.push(abschnitt('Akzeptanzkriterien', u?.akzeptanzkriterien));
    teile.push('Bitte setze die Arbeit ab diesem Zwischenstand fort.');
  } else {
    teile.push(abschnitt('Beschreibung', a.beschreibung));
    if (d.projekt && (d.projekt.kurz || d.projekt.stack || d.projekt.repo_url)) {
      teile.push(
        abschnitt(
          'Projektkontext',
          [d.projekt.kurz, d.projekt.stack && `Technik: ${d.projekt.stack}`, d.projekt.repo_url && `Repository: ${d.projekt.repo_url}`]
            .filter(Boolean)
            .join('\n'),
        ),
      );
    }
    teile.push(abschnitt('Ziel', u?.ziel));
    teile.push(abschnitt('Ausgangslage', u?.ausgangslage));
    teile.push(abschnitt('Relevante Dateien und Informationen', u?.dateien));
    teile.push(abschnitt('Gewünschtes Ergebnis', u?.ergebnis_soll));
    teile.push(abschnitt('Einschränkungen', u?.einschraenkungen));
    teile.push(abschnitt('Akzeptanzkriterien', u?.akzeptanzkriterien));
    teile.push(abschnitt('Erforderliche Freigaben', u?.freigaben));
    if (d.checkpoint) {
      teile.push(`## Bisheriger Stand (${datum(d.checkpoint.zeit)})\n${d.checkpoint.zusammenfassung}`);
    }
    if (d.abhaengigkeiten.length) {
      teile.push(abschnitt('Abhängigkeiten', d.abhaengigkeiten.map((x) => `- ${x.id} ${x.titel} (${x.status})`).join('\n')));
    }
    if (d.entscheidungen.length) {
      teile.push(abschnitt('Relevante Entscheidungen', d.entscheidungen.map((e) => `- ${e.id} (Stufe ${e.stufe}): ${e.titel}`).join('\n')));
    }
    if (d.offeneRueckfragen.length) {
      teile.push(abschnitt('Antworten der Geschäftsführung auf Rückfragen', d.offeneRueckfragen.map((r) => `- ${r.inhalt}`).join('\n')));
    }
  }

  teile.push(ANTWORTFORMAT);
  return teile.filter(Boolean).join('\n\n');
}

/** Hinweise vor dem Kopieren: Länge und erkennbare personenbezogene Daten (Datenschutz, Kap. 6.1/10). */
export function pruefePaket(text: string): string[] {
  const w: string[] = [];
  if (text.length > PAKET_ZIEL_ZEICHEN) {
    w.push(`Das Paket ist mit ${text.length} Zeichen länger als empfohlen (${PAKET_ZIEL_ZEICHEN}). Kostenlose Zugänge erreichen so schneller ihr Limit.`);
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) {
    w.push('Das Paket enthält eine E-Mail-Adresse. Bitte prüfen, ob personenbezogene Daten wirklich nötig sind.');
  }
  if (/(?:\+49|0049|\b0)[\s/-]?\d{2,5}[\s/-]?\d{3,}[\s/-]?\d{0,6}/.test(text)) {
    w.push('Das Paket enthält vermutlich eine Telefonnummer. Bitte prüfen, ob personenbezogene Daten wirklich nötig sind.');
  }
  if (/(passwort|password|api[-_ ]?key|secret|token)\s*[:=]/i.test(text)) {
    w.push('Das Paket scheint Zugangsdaten zu enthalten. Diese dürfen nie in ein KI-Tool kopiert werden.');
  }
  return w;
}
