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
