import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodError } from 'zod';

export class ApiFehler extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function validierungsFehler(err: ZodError): ApiFehler {
  return new ApiFehler(
    400,
    'ungueltige_eingabe',
    'Die Eingabe ist unvollständig oder ungültig.',
    err.issues.map((i) => ({ feld: i.path.join('.'), meldung: i.message })),
  );
}
