import { describe, expect, it } from 'vitest';
import { hatInhalt, zerlegeAntwort } from '../src/lib/antwort';
import { erzeugePaket, pruefePaket, type PaketDaten } from '../src/lib/paket';
import { istErlaubt } from '../src/lib/status';

describe('zerlegeAntwort', () => {
  it('erkennt die vereinbarten Abschnitte in verschiedenen Schreibweisen', () => {
    const t = zerlegeAntwort(
      [
        '## ERGEBNIS',
        'Landingpage-Text fertig.',
        '',
        '**Offene Fragen:**',
        '- Welche Zielgruppe zuerst?',
        'FREIGABEANTRÄGE: keine',
        '### Zwischenstand',
        'Text steht, als Nächstes Bilder auswählen.',
      ].join('\n'),
    );
    expect(t.strukturiert).toBe(true);
    expect(t.ergebnis).toBe('Landingpage-Text fertig.');
    expect(t.offeneFragen).toContain('Zielgruppe');
    expect(t.freigabeantraege).toBe('keine');
    expect(hatInhalt(t.freigabeantraege)).toBe(false);
    expect(t.zwischenstand).toBe('Text steht, als Nächstes Bilder auswählen.');
  });

  it('behandelt unstrukturierte Antworten als reines Ergebnis', () => {
    const t = zerlegeAntwort('Einfach nur ein Text ohne Überschriften.');
    expect(t.strukturiert).toBe(false);
    expect(t.ergebnis).toBe('Einfach nur ein Text ohne Überschriften.');
    expect(t.zwischenstand).toBe('');
  });

  it('erkennt echte Freigabeanträge', () => {
    const t = zerlegeAntwort('ERGEBNIS: Kampagne geplant\nFreigabeantrag: 50 € Werbebudget für Instagram');
    expect(hatInhalt(t.freigabeantraege)).toBe(true);
    expect(t.ergebnis).toBe('Kampagne geplant');
  });
});

describe('Übergabepaket', () => {
  const basis: PaketDaten = {
    aufgabe: { id: 'TD-0001', titel: 'Landingpage texten', beschreibung: 'Texte für die neue Seite', prioritaet: 'hoch', status: 'zugewiesen' },
    projekt: { name: 'Familienplaner', kurz: 'Familien organisieren', stack: 'React', repo_url: null },
    mitarbeiter: { name: 'Gemini', rolle: 'Marketing & Vertrieb' },
    uebergabe: {
      ziel: 'Mehr Anmeldungen',
      ausgangslage: '',
      dateien: '',
      ergebnis_soll: 'Drei Textvarianten',
      einschraenkungen: 'Keine Superlative',
      akzeptanzkriterien: 'Max. 120 Wörter',
      freigaben: 'Veröffentlichung',
    },
    checkpoint: null,
    entscheidungen: [{ id: 'EN-0002', stufe: 2, titel: 'Zielgruppe Eltern' }],
    abhaengigkeiten: [],
    offeneRueckfragen: [],
  };

  it('enthält Rolle, Stufenregel, Übergabefelder und Antwortformat, leere Felder entfallen', () => {
    const p = erzeugePaket(basis, 'voll', new Date('2026-11-19T08:00:00Z'));
    expect(p).toContain('# Auftrag TD-0001 – Landingpage texten');
    expect(p).toContain('Marketing & Vertrieb');
    expect(p).toContain('Stufe 3');
    expect(p).toContain('## Gewünschtes Ergebnis\nDrei Textvarianten');
    expect(p).toContain('EN-0002');
    expect(p).toContain('ZWISCHENSTAND:');
    expect(p).not.toContain('## Ausgangslage');
  });

  it('Fortsetzungspaket ist kürzer und enthält den letzten Zwischenstand', () => {
    const mitCp = { ...basis, checkpoint: { zusammenfassung: 'Variante 1 fertig', naechste_schritte: 'Variante 2', zeit: '2026-11-19T07:00:00Z' } };
    const voll = erzeugePaket(mitCp, 'voll');
    const fort = erzeugePaket(mitCp, 'fortsetzung');
    expect(fort.length).toBeLessThan(voll.length);
    expect(fort).toContain('# Fortsetzung TD-0001');
    expect(fort).toContain('Variante 1 fertig');
    expect(fort).toContain('Nächste Schritte: Variante 2');
  });

  it('warnt vor personenbezogenen Daten, Zugangsdaten und Überlänge', () => {
    expect(pruefePaket('kurz und sauber')).toEqual([]);
    expect(pruefePaket('Kontakt: max@beispiel.de').join()).toContain('E-Mail');
    expect(pruefePaket('Ruf an: 0171 1234567').join()).toContain('Telefonnummer');
    expect(pruefePaket('api_key: abc').join()).toContain('Zugangsdaten');
    expect(pruefePaket('x'.repeat(9000)).join()).toContain('länger als empfohlen');
  });
});

describe('Statusübergänge', () => {
  it('lässt „Freigabe erforderlich“ nur per Abbruch manuell verlassen', () => {
    expect(istErlaubt('freigabe_erforderlich', 'in_bearbeitung')).toBe(false);
    expect(istErlaubt('freigabe_erforderlich', 'abgebrochen')).toBe(true);
    expect(istErlaubt('neu', 'abgeschlossen')).toBe(false);
    expect(istErlaubt('in_bearbeitung', 'pruefung')).toBe(true);
  });
});
