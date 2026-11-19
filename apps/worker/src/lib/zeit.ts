export function jetzt(): string {
  return new Date().toISOString();
}

export function inMinuten(minuten: number): string {
  return new Date(Date.now() + minuten * 60_000).toISOString();
}

export function inTagen(tage: number): string {
  return new Date(Date.now() + tage * 86_400_000).toISOString();
}

export function istAbgelaufen(iso: string): boolean {
  return Date.parse(iso) <= Date.now();
}

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Datum (YYYY-MM-DD) und Uhrzeit (HH:MM) in Europe/Berlin. */
export function berlin(d: Date = new Date()): { datum: string; hhmm: string; minute: number } {
  const t = Object.fromEntries(BERLIN.formatToParts(d).map((x) => [x.type, x.value]));
  const stunde = t.hour === '24' ? '00' : t.hour;
  return { datum: `${t.year}-${t.month}-${t.day}`, hhmm: `${stunde}:${t.minute}`, minute: Number(t.minute) };
}

/** Liegt HH:MM in der Ruhezeit von–bis (auch über Mitternacht)? */
export function inRuhezeit(hhmm: string, von: string | null, bis: string | null): boolean {
  if (!von || !bis || von === bis) return false;
  return von < bis ? hhmm >= von && hhmm < bis : hhmm >= von || hhmm < bis;
}
