export class ApiFehler extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Methode = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function anfrage<T>(methode: Methode, pfad: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${pfad}`, {
      method: methode,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        // CSRF-Schutz: der Worker akzeptiert schreibende Anfragen nur mit diesem Header
        'x-te-anfrage': '1',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiFehler(0, 'offline', 'Keine Verbindung zur Zentrale. Bitte Netz prüfen.');
  }
  const text = await res.text();
  let daten: unknown = null;
  try {
    daten = text ? JSON.parse(text) : null;
  } catch {
    /* kein JSON */
  }
  if (!res.ok) {
    const f = (daten as { fehler?: { code: string; meldung: string; details?: unknown } } | null)?.fehler;
    throw new ApiFehler(res.status, f?.code ?? 'fehler', f?.meldung ?? `Fehler ${res.status}`, f?.details);
  }
  return daten as T;
}

export const api = {
  get: <T>(pfad: string) => anfrage<T>('GET', pfad),
  post: <T>(pfad: string, body: unknown = {}) => anfrage<T>('POST', pfad, body),
  patch: <T>(pfad: string, body: unknown) => anfrage<T>('PATCH', pfad, body),
  put: <T>(pfad: string, body: unknown) => anfrage<T>('PUT', pfad, body),
  delete: <T>(pfad: string) => anfrage<T>('DELETE', pfad),
};
