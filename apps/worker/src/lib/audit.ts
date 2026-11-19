import type { SitzungsInfo } from '../env';

export interface AuditEintrag {
  aktion: string;
  objektTyp?: string;
  objektId?: string;
  projektSlug?: string | null;
  details?: Record<string, unknown>;
}

/** Erzeugt das Statement für einen Audit-Eintrag, damit es im selben batch() wie die Änderung läuft. */
export function auditStatement(
  db: D1Database,
  akteur: SitzungsInfo | null,
  eintrag: AuditEintrag,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO aktivitaeten (akteur_typ, akteur_id, akteur_name, aktion, objekt_typ, objekt_id, projekt_slug, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      !akteur ? 'system' : akteur.benutzer.rolle === 'agent' ? 'mitarbeiter' : 'benutzer',
      akteur?.benutzer.rolle === 'agent' ? akteur.benutzer.id.replace(/^ma:/, '') : (akteur?.benutzer.id ?? null),
      akteur?.benutzer.name ?? 'System',
      eintrag.aktion,
      eintrag.objektTyp ?? null,
      eintrag.objektId ?? null,
      eintrag.projektSlug ?? null,
      eintrag.details ? JSON.stringify(eintrag.details) : null,
    );
}
