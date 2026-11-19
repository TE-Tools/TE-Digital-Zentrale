import { SELF } from 'cloudflare:test';

export const BASIS = 'http://localhost';

export interface Antwort<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export async function anfrage<T = any>(
  pfad: string,
  opts: { methode?: string; body?: unknown; cookie?: string; ohneCsrf?: boolean; origin?: string; basis?: string } = {},
): Promise<Antwort<T>> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers.cookie = opts.cookie;
  if (!opts.ohneCsrf) headers['x-te-anfrage'] = '1';
  if (opts.origin) headers.origin = opts.origin;
  const res = await SELF.fetch(`${opts.basis ?? BASIS}${pfad}`, {
    method: opts.methode ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

/** Meldet sich über den lokalen Dev-Zugang an und liefert den Cookie-Header. */
export async function devAnmelden(): Promise<string> {
  const r = await anfrage('/api/auth/dev-anmeldung', { body: {} });
  if (r.status !== 200) throw new Error(`Dev-Anmeldung fehlgeschlagen: ${r.status}`);
  const setCookie = r.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0]!;
}
