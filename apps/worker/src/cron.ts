/**
 * Zeitgesteuerte Aufgaben (Cron „*\/15 * * * *“, Free-Tarif):
 * 1. Limit-Pausen, die abgelaufen sind → „wieder verfügbar, fortsetzen“ melden (einmalig je Pause)
 * 2. Zurückgestellte Meldungen (Ruhezeit / gebündelt) versenden, sobald erlaubt
 * 3. Tagesbericht zur eingestellten Uhrzeit (einmal pro Tag)
 */
import type { Env } from './env';
import { anGeraeteSenden, basisUrl, einstellungenLaden, melden } from './lib/melden';
import { berlin, inRuhezeit, jetzt } from './lib/zeit';
import { liveSenden } from './live';
import { abgleichen, verbindungLaden } from './lib/github';

export async function cronAusfuehren(env: Env, jetztDatum: Date = new Date()): Promise<{ limits: number; versendet: number; berichte: number }> {
  const basis = basisUrl(env);
  const stats = { limits: 0, versendet: 0, berichte: 0 };

  // 1 – abgelaufene Limit-Pausen
  const abgelaufen = await env.DB.prepare(
    `SELECT a.id, a.titel, m.name, m.limit_bis FROM aufgaben a JOIN mitarbeiter m ON m.id = a.zustaendig_id
      WHERE a.status = 'wartend' AND m.status = 'wartend_limit' AND m.limit_bis <= ?`,
  )
    .bind(jetztDatum.toISOString())
    .all<{ id: string; titel: string; name: string; limit_bis: string }>();
  for (const a of abgelaufen.results) {
    await (await melden(
      env,
      {
        kategorie: 'wichtig',
        titel: `${a.name} wieder verfügbar`,
        text: `${a.id} „${a.titel}“ kann fortgesetzt werden.`,
        url: `/aufgaben/${a.id}`,
        schluessel: `limit:${a.id}:${a.limit_bis}`,
      },
      null,
      basis,
    )).versand;
    stats.limits++;
  }

  // 2 – zurückgestellte Meldungen
  const zeit = berlin(jetztDatum);
  const benutzer = await env.DB.prepare(`SELECT id FROM benutzer WHERE rolle = 'gf'`).all<{ id: string }>();
  for (const { id } of benutzer.results) {
    const e = await einstellungenLaden(env.DB, id);
    if (!inRuhezeit(zeit.hhmm, e.ruhe_von, e.ruhe_bis)) {
      const offen = await env.DB.prepare(
        `SELECT id, kategorie, titel, text, url FROM benachrichtigungen
          WHERE benutzer_id = ? AND push_status = 'offen' AND erstellt_am <= ? ORDER BY erstellt_am`,
      )
        .bind(id, jetztDatum.toISOString())
        .all<{ id: number; kategorie: 'kritisch' | 'wichtig' | 'tagesbericht'; titel: string; text: string; url: string }>();
      // Gebündelt: nur zur vollen Stunde (erster Lauf nach :00); sonst sofort nach Ende der Ruhezeit
      const darf = e.wichtig !== 'gebuendelt' || zeit.minute < 15;
      if (offen.results.length && darf) {
        const eine = offen.results.length === 1 ? offen.results[0]! : null;
        const zugestellt = await anGeraeteSenden(
          env,
          id,
          eine
            ? { kategorie: eine.kategorie, titel: eine.titel, text: eine.text, url: eine.url }
            : {
                kategorie: 'wichtig',
                titel: `${offen.results.length} neue Meldungen`,
                text: offen.results.slice(0, 4).map((m) => `• ${m.titel}`).join('\n'),
                url: '/benachrichtigungen',
                tag: 'buendel',
              },
          basis,
        );
        const status = zugestellt === 0 ? 'kein_geraet' : eine ? 'gesendet' : 'gebuendelt';
        await env.DB.batch(
          offen.results.map((m) =>
            env.DB.prepare('UPDATE benachrichtigungen SET push_status = ?, gesendet_am = ? WHERE id = ?').bind(status, jetzt(), m.id),
          ),
        );
        stats.versendet += offen.results.length;
      }
    }

    // 3 – Tagesbericht
    if (e.tagesbericht && zeit.hhmm >= e.tagesbericht_zeit && e.letzter_tagesbericht !== zeit.datum) {
      const bericht = await tagesbericht(env, jetztDatum);
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO benachrichtigungs_einstellungen (benutzer_id, letzter_tagesbericht) VALUES (?, ?)
           ON CONFLICT(benutzer_id) DO UPDATE SET letzter_tagesbericht = excluded.letzter_tagesbericht`,
        ).bind(id, zeit.datum),
        env.DB.prepare(
          `INSERT OR IGNORE INTO benachrichtigungen (benutzer_id, kategorie, titel, text, url, schluessel, push_status) VALUES (?, 'tagesbericht', ?, ?, '/', ?, 'offen') `,
        ).bind(id, bericht.titel, bericht.text, `tagesbericht:${zeit.datum}`),
      ]);
      const zugestellt = await anGeraeteSenden(env, id, { kategorie: 'tagesbericht', titel: bericht.titel, text: bericht.text, url: '/', tag: 'tagesbericht' }, basis);
      await env.DB.prepare(`UPDATE benachrichtigungen SET push_status = ?, gesendet_am = ? WHERE benutzer_id = ? AND schluessel = ?`)
        .bind(zugestellt ? 'gesendet' : 'kein_geraet', jetzt(), id, `tagesbericht:${zeit.datum}`)
        .run();
      stats.berichte++;
    }
  }

  // 4 – GitHub-Abgleich einmal pro Stunde (Webhooks halten den Rest aktuell)
  if (zeit.minute < 15) {
    const v = await verbindungLaden(env);
    if (v.status === 'installiert') await abgleichen(env).catch((e) => console.error('GitHub-Abgleich', e));
  }

  if (stats.limits || stats.berichte) await liveSenden(env, { art: 'geaendert', quelle: 'cron' });
  return stats;
}

/** Kurzer Tagesbericht aus vorbereiteten Zählwerten (ausführlicher Bericht folgt in Phase 6). */
export async function tagesbericht(env: Env, d: Date): Promise<{ titel: string; text: string }> {
  const seit = new Date(d.getTime() - 24 * 3_600_000).toISOString();
  const z = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM aufgaben WHERE status = 'abgeschlossen' AND abgeschlossen_am >= ?) AS erledigt,
       (SELECT COUNT(*) FROM aufgaben WHERE status IN ('zugewiesen','in_bearbeitung')) AS in_arbeit,
       (SELECT COUNT(*) FROM aufgaben WHERE status = 'pruefung') AS pruefung,
       (SELECT COUNT(*) FROM aufgaben WHERE status = 'blockiert') AS blockiert,
       (SELECT COUNT(*) FROM aufgaben WHERE status = 'wartend') AS wartend,
       (SELECT COUNT(*) FROM freigaben WHERE status = 'offen') AS freigaben,
       (SELECT COUNT(*) FROM nachrichten WHERE an = 'gf' AND gelesen_am IS NULL AND art = 'rueckfrage') AS rueckfragen`,
  )
    .bind(seit)
    .first<Record<string, number>>();
  const teile = [
    `${z?.erledigt ?? 0} erledigt (24 Std.)`,
    `${z?.in_arbeit ?? 0} in Arbeit`,
    z?.pruefung ? `${z.pruefung} zur Prüfung` : '',
    z?.freigaben ? `${z.freigaben} Freigabe(n) offen` : '',
    z?.rueckfragen ? `${z.rueckfragen} Rückfrage(n)` : '',
    z?.blockiert ? `${z.blockiert} blockiert` : '',
    z?.wartend ? `${z.wartend} wartend` : '',
  ].filter(Boolean);
  return { titel: 'Tagesbericht TE-Digital', text: teile.join(' · ') };
}
