import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { listenUeberschneidung } from '../lib/pfade';
import { sitzungPflicht } from '../lib/sitzung';

/**
 * Übersicht Entwicklung: offene PRs mit Checks und verknüpften Aufgaben, aktive Sperren und erkannte Konflikte.
 * Konflikt = zwei offene PRs im selben Repo ändern dieselben Dateien, oder ein PR ändert Dateien, die eine
 * andere Aufgabe gesperrt hat. Nichts wird automatisch überschrieben (Pflichtenheft 7.1).
 */
const entwicklung = new Hono<AppEnv>();

interface Pr {
  repo: string;
  nummer: number;
  titel: string;
  zustand: string;
  branch: string;
  ziel_branch: string;
  autor: string | null;
  url: string;
  checks: string;
  dateien: string | null;
  aufgabe_id: string | null;
  aufgabe_titel: string | null;
  aufgabe_status: string | null;
  projekt_slug: string | null;
  projekt_farbe: string | null;
  aktualisiert_am: string;
}

entwicklung.get('/', async (c) => {
  sitzungPflicht(c);
  const db = c.env.DB;
  const [prs, sperren, aufgaben] = await db.batch([
    db.prepare(
      `SELECT x.*, a.titel AS aufgabe_titel, a.status AS aufgabe_status, r.projekt_slug, p.farbe AS projekt_farbe
         FROM github_prs x JOIN github_repos r ON r.full_name = x.repo LEFT JOIN projekte p ON p.slug = r.projekt_slug
         LEFT JOIN aufgaben a ON a.id = x.aufgabe_id
        WHERE x.zustand IN ('offen','entwurf') OR x.aktualisiert_am > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')
        ORDER BY x.zustand IN ('offen','entwurf') DESC, x.aktualisiert_am DESC LIMIT 100`,
    ),
    db.prepare(
      `SELECT s.id, s.repo, s.pfade, s.aufgabe_id, s.inhaber_id, s.grund, s.seit, a.titel AS aufgabe_titel
         FROM repo_sperren s JOIN aufgaben a ON a.id = s.aufgabe_id WHERE s.freigegeben_am IS NULL ORDER BY s.seit DESC`,
    ),
    // Entwicklungsaufgaben: mit Branch oder bei der technischen Leitung
    db.prepare(
      `SELECT a.id, a.titel, a.status, a.branch, a.pr_url, a.projekt_slug, p.farbe AS projekt_farbe
         FROM aufgaben a JOIN projekte p ON p.slug = a.projekt_slug
        WHERE a.status NOT IN ('abgeschlossen','abgebrochen') AND (a.branch IS NOT NULL OR a.zustaendig_id = 'technik')
        ORDER BY a.aktualisiert_am DESC LIMIT 50`,
    ),
  ]);
  const prListe = (prs?.results ?? []) as Pr[];
  const sperrListe = ((sperren?.results ?? []) as { id: number; repo: string; pfade: string; aufgabe_id: string; inhaber_id: string; grund: string; seit: string; aufgabe_titel: string }[]).map(
    (s) => ({ ...s, pfade: JSON.parse(s.pfade) as string[] }),
  );

  const konflikte: { art: 'pr_pr' | 'pr_sperre'; repo: string; a: string; b: string; dateien: string[] }[] = [];
  const offene = prListe.filter((p) => (p.zustand === 'offen' || p.zustand === 'entwurf') && p.dateien);
  for (let i = 0; i < offene.length; i++) {
    const a = offene[i]!;
    const da = JSON.parse(a.dateien!) as string[];
    for (let j = i + 1; j < offene.length; j++) {
      const b = offene[j]!;
      if (b.repo !== a.repo) continue;
      const gemeinsam = listenUeberschneidung(da, JSON.parse(b.dateien!) as string[]);
      if (gemeinsam.length) konflikte.push({ art: 'pr_pr', repo: a.repo, a: `#${a.nummer}`, b: `#${b.nummer}`, dateien: gemeinsam.slice(0, 10) });
    }
    for (const s of sperrListe) {
      if (s.repo !== a.repo || s.aufgabe_id === a.aufgabe_id) continue;
      const gemeinsam = listenUeberschneidung(da, s.pfade);
      if (gemeinsam.length) konflikte.push({ art: 'pr_sperre', repo: a.repo, a: `#${a.nummer}`, b: `${s.aufgabe_id} (Sperre ${s.id})`, dateien: gemeinsam.slice(0, 10) });
    }
  }

  return c.json({
    prs: prListe.map((p) => ({ ...p, dateien: p.dateien ? (JSON.parse(p.dateien) as string[]).length : null })),
    sperren: sperrListe,
    konflikte,
    aufgaben: aufgaben?.results ?? [],
  });
});

export default entwicklung;
