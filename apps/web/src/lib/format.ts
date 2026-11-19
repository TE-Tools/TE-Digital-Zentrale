import type { Aktivitaet, MitarbeiterStatus, Mitarbeiter } from './typen';

/** „gerade eben“, „vor 5 Min.“, „vor 3 Std.“, „gestern“, „vor 4 Tagen“, sonst Datum. */
export function relativeZeit(iso: string | null | undefined, jetzt: number = Date.now()): string {
  if (!iso) return 'nie';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '–';
  const s = Math.round((jetzt - t) / 1000);
  if (s < 0) return zukunft(-s);
  if (s < 45) return 'gerade eben';
  const min = Math.round(s / 60);
  if (min < 60) return `vor ${min} Min.`;
  const std = Math.round(min / 60);
  if (std < 24) return `vor ${std} Std.`;
  const tage = Math.round(std / 24);
  if (tage === 1) return 'gestern';
  if (tage < 7) return `vor ${tage} Tagen`;
  return datum(iso);
}

function zukunft(s: number): string {
  const min = Math.round(s / 60);
  if (min < 1) return 'gleich';
  if (min < 60) return `in ${min} Min.`;
  const std = Math.round(min / 60);
  if (std < 24) return `in ${std} Std.`;
  return `in ${Math.round(std / 24)} Tagen`;
}

export function datum(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function datumLang(d: Date = new Date()): string {
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function begruessung(stunde: number = new Date().getHours()): string {
  if (stunde < 5) return 'Gute Nacht';
  if (stunde < 11) return 'Guten Morgen';
  if (stunde < 18) return 'Guten Tag';
  return 'Guten Abend';
}

export function initialen(name: string): string {
  const teile = name.replace(/\(.*?\)/g, '').trim().split(/[\s-]+/).filter(Boolean);
  return ((teile[0]?.[0] ?? '') + (teile[1]?.[0] ?? '')).toUpperCase() || '?';
}

export const STATUS_TEXT: Record<MitarbeiterStatus, { text: string; ton: 'ok' | 'warn' | 'krit' | 'info' | '' }> = {
  unbekannt: { text: 'Kein Status', ton: '' },
  verfuegbar: { text: 'Verfügbar', ton: 'ok' },
  arbeitet: { text: 'Arbeitet', ton: 'info' },
  wartend_limit: { text: 'Limit – Pause', ton: 'warn' },
  pausiert: { text: 'Pausiert', ton: '' },
};

export const ZUGANG_TEXT: Record<Mitarbeiter['zugang'], string> = {
  abo: 'Abo',
  kostenlos: 'Kostenlos (Web)',
  flexibel: 'Flexibel',
};

export const ARBEITSWEG_TEXT: Record<Mitarbeiter['arbeitsweg'], string> = {
  mcp: 'Direktzugriff (MCP)',
  paket: 'Übergabepaket',
  github: 'GitHub',
  flexibel: 'je nach Besetzung',
};

const AKTIONEN: Record<string, string> = {
  'zentrale.eingerichtet': 'hat die Zentrale eingerichtet',
  'zugang.eingerichtet': 'hat den Zugang eingerichtet',
  'anmeldung.passkey': 'hat sich mit Passkey angemeldet',
  'anmeldung.wiederherstellungscode': 'hat sich mit Wiederherstellungscode angemeldet',
  'passkey.hinzugefuegt': 'hat einen Passkey hinzugefügt',
  'projekt.angelegt': 'hat ein Projekt angelegt',
  'projekt.geaendert': 'hat ein Projekt geändert',
  'aufgabe.angelegt': 'hat einen Auftrag erteilt',
  'aufgabe.geaendert': 'hat eine Aufgabe geändert',
  'aufgabe.status': 'hat den Status geändert',
  'aufgabe.ergebnis': 'hat ein Ergebnis zurückgeführt',
  'aufgabe.checkpoint': 'hat einen Zwischenstand gespeichert',
  'aufgabe.limit': 'hat eine Limit-Pause eingetragen',
  'aufgabe.fortgesetzt': 'hat eine Aufgabe fortgesetzt',
  'aufgabe.abhaengigkeit': 'hat eine Abhängigkeit ergänzt',
  'aufgabe.abhaengigkeit_entfernt': 'hat eine Abhängigkeit entfernt',
  'nachricht.erfasst': 'hat eine Nachricht erfasst',
  'entscheidung.dokumentiert': 'hat eine Entscheidung dokumentiert',
  'freigabe.beantragt': 'hat eine Freigabe beantragt',
  'freigabe.erteilt': 'hat eine Freigabe erteilt',
  'freigabe.abgelehnt': 'hat eine Freigabe abgelehnt',
  'freigabe.zurueckgezogen': 'hat eine Freigabe zurückgezogen',
  'mitarbeiter.status': 'hat einen Mitarbeiterstatus gesetzt',
  'wissen.angelegt': 'hat einen Wissensartikel angelegt',
  'wissen.geaendert': 'hat einen Wissensartikel geändert',
  'wissen.archiviert': 'hat einen Wissensartikel archiviert',
  'wissen.wiederhergestellt': 'hat einen Wissensartikel wiederhergestellt',
  'wissen.aus_aufgabe': 'hat ein Ergebnis als Wissen gespeichert',
  'bericht.tag': 'hat einen Tagesbericht erstellt',
  'bericht.projekt': 'hat einen Projektbericht erstellt',
  'sperre.gesetzt': 'hat Dateien gesperrt',
  'sperre.freigegeben': 'hat eine Sperre gelöst',
  'zugang.erstellt': 'hat einen KI-Zugang erstellt',
  'zugang.widerrufen': 'hat einen KI-Zugang gesperrt',
  'github.einrichtung_gestartet': 'hat die GitHub-Einrichtung gestartet',
  'github.app_angelegt': 'GitHub-App angelegt',
  'github.installiert': 'GitHub-App installiert',
  'github.getrennt': 'hat GitHub getrennt',
  'github.repo_zugeordnet': 'hat ein Repository zugeordnet',
  'push.geraet_angemeldet': 'hat ein Gerät für Push angemeldet',
  'push.geraet_abgemeldet': 'hat ein Gerät abgemeldet',
  'benachrichtigungen.einstellungen': 'hat Benachrichtigungen eingestellt',
};

/** Link zum Objekt einer Aktivität (oder null). */
export function aktivitaetLink(a: Aktivitaet): string | null {
  if (!a.objekt_id) return null;
  if (a.objekt_typ === 'projekt') return `/projekte/${a.objekt_id}`;
  if (a.objekt_typ === 'aufgabe' || (a.objekt_typ === 'nachricht' && a.objekt_id.startsWith('TD-'))) return `/aufgaben/${a.objekt_id}`;
  if (a.objekt_typ === 'freigabe' || a.objekt_typ === 'entscheidung') return '/freigaben';
  if (a.objekt_typ === 'mitarbeiter') return '/mitarbeiter';
  if (a.objekt_typ === 'wissen') return `/wissen/${a.objekt_id}`;
  if (a.objekt_typ === 'bericht') return `/berichte/${a.objekt_id}`;
  return null;
}

export function aktivitaetText(a: Aktivitaet): string {
  return AKTIONEN[a.aktion] ?? a.aktion;
}

/** Ein Status gilt als veraltet, wenn die letzte Bestätigung älter als 6 Std. ist. */
export function istVeraltet(iso: string | null, jetzt: number = Date.now(), stunden = 6): boolean {
  if (!iso) return true;
  return jetzt - Date.parse(iso) > stunden * 3_600_000;
}

/** Hellere Kachel-Tönung zu einer Hausfarbe (wie #047857 → #E7F3EE auf der Website). */
export function toenung(hex: string, anteil = 0.12): string {
  return `color-mix(in srgb, ${hex} ${Math.round(anteil * 100)}%, var(--surface))`;
}
