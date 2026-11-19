/**
 * Tages- und Projektberichte (Pflichtenheft 4.2, 6) – deterministisch aus den Daten der Zentrale erzeugt,
 * ohne KI. Format: Markdown + Kennzahlen (JSON) für die Kacheln.
 * Free-Tarif: alles in wenigen Sammelabfragen (D1 batch).
 */
import type { Env } from '../env';
import { berlin } from './zeit';

const STATUS: Record<string, string> = {
  neu: 'neu', geplant: 'geplant', wartend: 'wartend', zugewiesen: 'zugewiesen', in_bearbeitung: 'in Bearbeitung',
  pruefung: 'in Prüfung', freigabe_erforderlich: 'Freigabe erforderlich', blockiert: 'blockiert', abgeschlossen: 'abgeschlossen', abgebrochen: 'abgebrochen',
};

type Zeile = Record<string, string | number | null>;

function liste(titel: string, zeilen: Zeile[], format: (z: Zeile) => string, leer = 'keine'): string {
  return `## ${titel}\n${zeilen.length ? zeilen.map((z) => `- ${format(z)}`).join('\n') : `_${leer}_`}`;
}

function datumDe(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export interface BerichtErgebnis {
  titel: string;
  inhalt: string;
  kennzahlen: Record<string, number>;
  von: string;
  bis: string;
}

/** Bericht über einen Zeitraum, optional auf ein Projekt beschränkt. */
export async function berichtErzeugen(env: Env, von: Date, bis: Date, projektSlug: string | null): Promise<BerichtErgebnis> {
  const db = env.DB;
  const v = von.toISOString();
  const b = bis.toISOString();
  const p = projektSlug;
  const pf = (spalte: string) => (p ? `AND ${spalte} = ?` : '');
  const pb = p ? [p] : [];

  const [erledigt, neu, pruefung, blockiert, wartend, freigabenOffen, freigabenEntschieden, entscheidungen, rueckfragen, prs, zahlen, projekte, mitarbeiter, projekt] =
    await db.batch([
      db.prepare(`SELECT a.id, a.titel, a.projekt_slug, m.rolle FROM aufgaben a LEFT JOIN mitarbeiter m ON m.id = a.zustaendig_id
                   WHERE a.status = 'abgeschlossen' AND a.abgeschlossen_am >= ? AND a.abgeschlossen_am < ? ${pf('a.projekt_slug')} ORDER BY a.abgeschlossen_am`).bind(v, b, ...pb),
      db.prepare(`SELECT a.id, a.titel, a.projekt_slug, a.prioritaet FROM aufgaben a WHERE a.erstellt_am >= ? AND a.erstellt_am < ? ${pf('a.projekt_slug')} ORDER BY a.erstellt_am`).bind(v, b, ...pb),
      db.prepare(`SELECT a.id, a.titel FROM aufgaben a WHERE a.status = 'pruefung' ${pf('a.projekt_slug')} ORDER BY a.aktualisiert_am`).bind(...pb),
      db.prepare(`SELECT a.id, a.titel, a.prioritaet, a.aktualisiert_am FROM aufgaben a WHERE a.status = 'blockiert' ${pf('a.projekt_slug')} ORDER BY a.aktualisiert_am`).bind(...pb),
      db.prepare(`SELECT a.id, a.titel, m.name, m.limit_bis, m.status AS ma_status FROM aufgaben a LEFT JOIN mitarbeiter m ON m.id = a.zustaendig_id
                   WHERE a.status = 'wartend' ${pf('a.projekt_slug')}`).bind(...pb),
      db.prepare(`SELECT id, titel, typ, dringend, angefragt_am FROM freigaben WHERE status = 'offen' ${pf('projekt_slug')} ORDER BY dringend DESC, angefragt_am`).bind(...pb),
      db.prepare(`SELECT id, titel, status, entschieden_am FROM freigaben WHERE status IN ('erteilt','abgelehnt') AND entschieden_am >= ? AND entschieden_am < ? ${pf('projekt_slug')}`).bind(v, b, ...pb),
      db.prepare(`SELECT id, stufe, titel, von FROM entscheidungen WHERE zeit >= ? AND zeit < ? ${pf('projekt_slug')} ORDER BY zeit`).bind(v, b, ...pb),
      db.prepare(`SELECT n.aufgabe_id, n.inhalt, n.von FROM nachrichten n WHERE n.art = 'rueckfrage' AND n.an = 'gf' AND n.gelesen_am IS NULL ${pf('n.projekt_slug')}`).bind(...pb),
      db.prepare(`SELECT x.repo, x.nummer, x.titel, x.zustand, x.checks FROM github_prs x JOIN github_repos r ON r.full_name = x.repo
                   WHERE x.aktualisiert_am >= ? ${pf('r.projekt_slug')} ORDER BY x.aktualisiert_am DESC LIMIT 15`).bind(v, ...pb),
      db.prepare(`SELECT
                    (SELECT COUNT(*) FROM aufgaben WHERE status NOT IN ('abgeschlossen','abgebrochen') ${pf('projekt_slug')}) AS offen,
                    (SELECT COUNT(*) FROM aufgaben WHERE status IN ('zugewiesen','in_bearbeitung') ${pf('projekt_slug')}) AS in_arbeit,
                    (SELECT COUNT(*) FROM aktivitaeten WHERE zeit >= ? AND zeit < ? ${pf('projekt_slug')}) AS aktivitaeten`).bind(...pb, ...pb, v, b, ...pb),
      db.prepare(`SELECT p.slug, p.name,
                    (SELECT COUNT(*) FROM aufgaben a WHERE a.projekt_slug = p.slug AND a.status NOT IN ('abgeschlossen','abgebrochen')) AS offen,
                    (SELECT COUNT(*) FROM aufgaben a WHERE a.projekt_slug = p.slug AND a.status = 'abgeschlossen' AND a.abgeschlossen_am >= ? AND a.abgeschlossen_am < ?) AS erledigt,
                    (SELECT COUNT(*) FROM aufgaben a WHERE a.projekt_slug = p.slug AND a.status = 'blockiert') AS blockiert
                   FROM projekte p WHERE p.status <> 'archiviert' ${pf('p.slug')} ORDER BY p.sortierung`).bind(v, b, ...pb),
      db.prepare(`SELECT m.rolle, m.name,
                    (SELECT COUNT(*) FROM aktivitaeten x WHERE x.akteur_typ = 'mitarbeiter' AND x.akteur_id = m.id AND x.zeit >= ? AND x.zeit < ?) AS aktionen,
                    (SELECT COUNT(*) FROM aufgaben a WHERE a.zustaendig_id = m.id AND a.status = 'abgeschlossen' AND a.abgeschlossen_am >= ? AND a.abgeschlossen_am < ? ${pf('a.projekt_slug')}) AS erledigt
                   FROM mitarbeiter m WHERE m.aktiv = 1 ORDER BY m.sortierung`).bind(v, b, v, b, ...pb),
      db.prepare('SELECT name, kurz FROM projekte WHERE slug = ?').bind(p ?? ''),
    ]);

  const r = (x: D1Result | undefined) => (x?.results ?? []) as Zeile[];
  const z = (r(zahlen)[0] ?? {}) as Record<string, number>;
  const kennzahlen = {
    erledigt: r(erledigt).length,
    neu: r(neu).length,
    offen: Number(z.offen ?? 0),
    in_arbeit: Number(z.in_arbeit ?? 0),
    pruefung: r(pruefung).length,
    blockiert: r(blockiert).length,
    wartend: r(wartend).length,
    freigaben_offen: r(freigabenOffen).length,
    freigaben_entschieden: r(freigabenEntschieden).length,
    entscheidungen: r(entscheidungen).length,
    rueckfragen: r(rueckfragen).length,
    aktivitaeten: Number(z.aktivitaeten ?? 0),
  };

  const pName = (r(projekt)[0]?.name as string | undefined) ?? null;
  const zeitraum = `${datumDe(v)} – ${datumDe(b)}`;
  const teile: string[] = [
    `# ${pName ? `Projektbericht ${pName}` : 'Tagesbericht TE-Digital'}`,
    `Zeitraum: ${zeitraum} · erstellt automatisch aus den Daten der Zentrale`,
    `## Überblick\n- ${kennzahlen.erledigt} erledigt, ${kennzahlen.neu} neu, ${kennzahlen.offen} offen (${kennzahlen.in_arbeit} in Arbeit)\n- ${kennzahlen.pruefung} zur Prüfung, ${kennzahlen.blockiert} blockiert, ${kennzahlen.wartend} wartend\n- ${kennzahlen.freigaben_offen} offene Freigaben, ${kennzahlen.rueckfragen} offene Rückfragen, ${kennzahlen.entscheidungen} Entscheidungen im Zeitraum`,
  ];
  // Was wartet auf die Geschäftsführung – zuerst
  if (kennzahlen.freigaben_offen || kennzahlen.rueckfragen || kennzahlen.pruefung) {
    teile.push(liste('Wartet auf die Geschäftsführung', [
      ...r(freigabenOffen).map((f) => ({ t: `${f.dringend ? '**dringend** ' : ''}Freigabe ${f.id}: ${f.titel}` })),
      ...r(rueckfragen).map((n) => ({ t: `Rückfrage${n.aufgabe_id ? ` zu ${n.aufgabe_id}` : ''} von ${n.von}: ${String(n.inhalt).replace(/\s+/g, ' ').slice(0, 140)}` })),
      ...r(pruefung).map((a) => ({ t: `Prüfung ${a.id}: ${a.titel}` })),
    ] as Zeile[], (x) => String(x.t)));
  }
  teile.push(liste('Erledigt', r(erledigt), (a) => `${a.id} ${a.titel}${a.rolle ? ` (${a.rolle})` : ''}${p ? '' : ` · ${a.projekt_slug}`}`));
  teile.push(liste('Neu angelegt', r(neu), (a) => `${a.id} ${a.titel} · ${a.prioritaet}${p ? '' : ` · ${a.projekt_slug}`}`));
  teile.push(liste('Blockiert', r(blockiert), (a) => `${a.id} ${a.titel} (${a.prioritaet}, seit ${datumDe(String(a.aktualisiert_am))})`));
  teile.push(
    liste('Wartend / Limit-Pause', r(wartend), (a) =>
      `${a.id} ${a.titel}${a.ma_status === 'wartend_limit' && a.limit_bis ? ` – ${a.name} wieder verfügbar ab ${datumDe(String(a.limit_bis))}` : ''}`,
    ),
  );
  teile.push(liste('Entschiedene Freigaben', r(freigabenEntschieden), (f) => `${f.id} ${f.titel}: **${f.status}**`));
  teile.push(liste('Entscheidungen', r(entscheidungen), (e) => `${e.id} (Stufe ${e.stufe}, ${e.von}): ${e.titel}`));
  if (r(prs).length) teile.push(liste('Pull Requests (aktualisiert)', r(prs), (x) => `${x.repo} #${x.nummer} ${x.titel} – ${x.zustand}, Checks ${x.checks}`));
  if (!p) {
    teile.push(
      `## Projekte\n| Projekt | offen | erledigt | blockiert |\n|---|---|---|---|\n${r(projekte)
        .map((x) => `| ${x.name} | ${x.offen} | ${x.erledigt} | ${x.blockiert} |`)
        .join('\n')}`,
    );
  }
  teile.push(
    `## KI-Mitarbeiter\n| Rolle | Aktionen über die Zentrale | erledigt |\n|---|---|---|\n${r(mitarbeiter)
      .map((m) => `| ${m.rolle} (${m.name}) | ${m.aktionen} | ${m.erledigt} |`)
      .join('\n')}\n\n_Aktionen über die Zentrale zählen nur direkte Zugriffe (MCP); Arbeit über Übergabepakete erscheint als Ergebnis der Geschäftsführung._`,
  );
  if (!p) teile.push(`_Statusbegriffe: ${Object.values(STATUS).join(', ')}._`);

  return {
    titel: pName ? `Projektbericht ${pName} (${berlin(von).datum} – ${berlin(bis).datum})` : `Tagesbericht ${berlin(bis).datum.split('-').reverse().join('.')}`,
    inhalt: teile.join('\n\n'),
    kennzahlen,
    von: v,
    bis: b,
  };
}

/** Tagesbericht für den Berliner Kalendertag von `d` – höchstens einer je Tag (neu erstellen ersetzt). */
export async function tagesberichtSpeichern(env: Env, d: Date = new Date(), ersetzen = false, von = 'system'): Promise<number> {
  const tag = berlin(d).datum;
  const vorhanden = await env.DB.prepare(`SELECT id FROM berichte WHERE typ = 'tag' AND datum = ?`).bind(tag).first<{ id: number }>();
  if (vorhanden && !ersetzen) return vorhanden.id;
  const bis = d;
  const vonZeit = new Date(d.getTime() - 24 * 3_600_000);
  const b = await berichtErzeugen(env, vonZeit, bis, null);
  if (vorhanden) await env.DB.prepare('DELETE FROM berichte WHERE id = ?').bind(vorhanden.id).run();
  const r = await env.DB.prepare(
    `INSERT INTO berichte (typ, datum, von, bis, titel, inhalt, kennzahlen, erstellt_von) VALUES ('tag', ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(tag, b.von, b.bis, b.titel, b.inhalt, JSON.stringify(b.kennzahlen), von)
    .first<{ id: number }>();
  return r!.id;
}

export function kurztext(k: Record<string, number>): string {
  return [
    `${k.erledigt ?? 0} erledigt`,
    `${k.in_arbeit ?? 0} in Arbeit`,
    k.pruefung ? `${k.pruefung} zur Prüfung` : '',
    k.freigaben_offen ? `${k.freigaben_offen} Freigabe(n) offen` : '',
    k.rueckfragen ? `${k.rueckfragen} Rückfrage(n)` : '',
    k.blockiert ? `${k.blockiert} blockiert` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
