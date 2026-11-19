import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { sitzungPflicht } from '../lib/sitzung';
import { EFFEKTIVER_STATUS } from './mitarbeiter';

const dashboard = new Hono<AppEnv>();

export type Unternehmensstatus = 'ok' | 'warnung' | 'kritisch';

dashboard.get('/', async (c) => {
  const s = sitzungPflicht(c);
  const db = c.env.DB;
  const heute = new Date().toISOString().slice(0, 10);

  // Ein einziger Roundtrip (D1 batch) – wichtig für den Free-Tarif (max. 50 Abfragen/Anfrage).
  const [zahlen, mitarbeiter, projekte, freigaben, aktivitaeten, fortsetzbar, rueckfragen] = await db.batch([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM aufgaben WHERE status IN ('zugewiesen','in_bearbeitung','pruefung')) AS in_arbeit,
           (SELECT COUNT(*) FROM aufgaben WHERE status IN ('neu','geplant','wartend')) AS wartend,
           (SELECT COUNT(*) FROM aufgaben WHERE status = 'blockiert') AS blockiert,
           (SELECT COUNT(*) FROM aufgaben WHERE status = 'abgeschlossen' AND substr(abgeschlossen_am,1,10) = ?) AS heute_abgeschlossen,
           (SELECT COUNT(*) FROM aufgaben WHERE status = 'abgeschlossen') AS abgeschlossen,
           (SELECT COUNT(*) FROM freigaben WHERE status = 'offen') AS offene_freigaben,
           (SELECT COUNT(*) FROM freigaben WHERE status = 'offen' AND dringend = 1) AS dringende_freigaben,
           (SELECT COUNT(*) FROM aufgaben WHERE status = 'blockiert' AND prioritaet IN ('hoch','kritisch')) AS kritisch_blockiert,
           (SELECT COUNT(*) FROM aufgaben WHERE status = 'pruefung') AS in_pruefung,
           (SELECT COUNT(*) FROM nachrichten WHERE an = 'gf' AND gelesen_am IS NULL) AS ungelesen,
           (SELECT COUNT(*) FROM benachrichtigungen WHERE benutzer_id = ? AND gelesen_am IS NULL) AS meldungen_ungelesen`,
      )
      .bind(heute, s.benutzer.id),
    db.prepare(
      `SELECT m.id, m.name, m.rolle, m.anbieter, m.zugang, m.arbeitsweg, ${EFFEKTIVER_STATUS} AS status, m.status_bestaetigt_am, m.limit_bis, m.farbe,
              (SELECT a.id || ' · ' || a.titel FROM aufgaben a
                WHERE a.zustaendig_id = m.id AND a.status IN ('in_bearbeitung','zugewiesen','pruefung')
                ORDER BY a.aktualisiert_am DESC LIMIT 1) AS aktuelle_aufgabe
         FROM mitarbeiter m WHERE m.aktiv = 1 ORDER BY m.sortierung`,
    ),
    db.prepare(
      `SELECT p.slug, p.name, p.kurz, p.farbe, p.status,
              (SELECT COUNT(*) FROM aufgaben a WHERE a.projekt_slug = p.slug AND a.status NOT IN ('abgeschlossen','abgebrochen')) AS offen,
              (SELECT COUNT(*) FROM aufgaben a WHERE a.projekt_slug = p.slug AND a.status = 'abgeschlossen') AS fertig,
              (SELECT COUNT(*) FROM aufgaben a WHERE a.projekt_slug = p.slug AND a.status = 'blockiert') AS blockiert
         FROM projekte p WHERE p.status != 'archiviert' ORDER BY p.sortierung, p.name`,
    ),
    db.prepare(
      `SELECT id, typ, titel, projekt_slug, dringend, angefragt_am, angefragt_von
         FROM freigaben WHERE status = 'offen' ORDER BY dringend DESC, angefragt_am LIMIT 10`,
    ),
    db.prepare(
      `SELECT id, zeit, akteur_typ, akteur_name, aktion, objekt_typ, objekt_id, projekt_slug, details
         FROM aktivitaeten ORDER BY zeit DESC, id DESC LIMIT 15`,
    ),
    // Nach Limit-Pause wieder fortsetzbar (Kap. 6.1, Schritt 3)
    db.prepare(
      `SELECT a.id, a.titel, a.projekt_slug, m.name AS mitarbeiter, m.limit_bis
         FROM aufgaben a JOIN mitarbeiter m ON m.id = a.zustaendig_id
        WHERE a.status = 'wartend' AND m.status = 'wartend_limit' AND m.limit_bis <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
        ORDER BY m.limit_bis LIMIT 10`,
    ),
    db.prepare(
      `SELECT n.id, n.von, n.aufgabe_id, n.inhalt, n.zeit, a.titel AS aufgabe_titel
         FROM nachrichten n LEFT JOIN aufgaben a ON a.id = n.aufgabe_id
        WHERE n.an = 'gf' AND n.gelesen_am IS NULL AND n.art IN ('rueckfrage','eskalation','warnung')
        ORDER BY n.zeit DESC LIMIT 10`,
    ),
  ]);

  const z = (zahlen?.results[0] ?? {}) as Record<string, number>;
  const status: Unternehmensstatus =
    (z.dringende_freigaben ?? 0) > 0 || (z.kritisch_blockiert ?? 0) > 0
      ? 'kritisch'
      : (z.blockiert ?? 0) > 0 || (z.offene_freigaben ?? 0) > 0 || (rueckfragen?.results.length ?? 0) > 0
        ? 'warnung'
        : 'ok';

  return c.json({
    stand: new Date().toISOString(),
    status,
    zahlen: z,
    mitarbeiter: mitarbeiter?.results ?? [],
    projekte: projekte?.results ?? [],
    freigaben: freigaben?.results ?? [],
    aktivitaeten: aktivitaeten?.results ?? [],
    fortsetzbar: fortsetzbar?.results ?? [],
    rueckfragen: rueckfragen?.results ?? [],
  });
});

export default dashboard;
