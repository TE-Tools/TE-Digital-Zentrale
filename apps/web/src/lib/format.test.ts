import { describe, expect, it } from 'vitest';
import { begruessung, initialen, istVeraltet, relativeZeit } from './format';

const JETZT = Date.parse('2026-11-19T12:00:00Z');
const vor = (sek: number) => new Date(JETZT - sek * 1000).toISOString();

describe('relativeZeit', () => {
  it.each([
    [null, 'nie'],
    [vor(10), 'gerade eben'],
    [vor(5 * 60), 'vor 5 Min.'],
    [vor(3 * 3600), 'vor 3 Std.'],
    [vor(26 * 3600), 'gestern'],
    [vor(4 * 86400), 'vor 4 Tagen'],
    [vor(-30 * 60), 'in 30 Min.'],
  ])('%s → %s', (iso, erwartet) => {
    expect(relativeZeit(iso, JETZT)).toBe(erwartet);
  });

  it('zeigt ab einer Woche das Datum', () => {
    expect(relativeZeit(vor(10 * 86400), JETZT)).toBe('09.11.2026');
  });
});

describe('Hilfen', () => {
  it('bildet Initialen', () => {
    expect(initialen('Claude Code')).toBe('CC');
    expect(initialen('Geschäftsführung (lokal)')).toBe('G');
    expect(initialen('TE-Digital')).toBe('TD');
  });

  it('erkennt veraltete Statusmeldungen', () => {
    expect(istVeraltet(null, JETZT)).toBe(true);
    expect(istVeraltet(vor(3600), JETZT)).toBe(false);
    expect(istVeraltet(vor(7 * 3600), JETZT)).toBe(true);
  });

  it('begrüßt passend zur Tageszeit', () => {
    expect(begruessung(8)).toBe('Guten Morgen');
    expect(begruessung(14)).toBe('Guten Tag');
    expect(begruessung(20)).toBe('Guten Abend');
  });
});
