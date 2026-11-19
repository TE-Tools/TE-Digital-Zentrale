import { useState } from 'preact/hooks';
import { AlertTriangle, ListChecks, Plus } from 'lucide-preact';
import { AufgabenListe } from '../komponenten/AufgabenListe';
import { Karte, Ladebalken, Leer } from '../komponenten/Bausteine';
import { useDaten } from '../lib/daten';
import { useKopf } from '../lib/kopf';
import type { AufgabeKurz, Benutzer, Mitarbeiter, Projekt } from '../lib/typen';

const GRUPPEN = [
  { wert: 'offen', text: 'Alle offenen' },
  { wert: 'arbeit', text: 'In Arbeit' },
  { wert: 'pruefung', text: 'Prüfung & Freigabe' },
  { wert: 'wartend', text: 'Neu & wartend' },
  { wert: 'blockiert', text: 'Blockiert' },
  { wert: 'erledigt', text: 'Erledigt' },
] as const;

export function Aufgaben({ benutzer }: { benutzer: Benutzer }) {
  useKopf('Aufgaben & Aufträge', 'Arbeit');
  const start = new URLSearchParams(location.search);
  const [gruppe, setGruppe] = useState<string>(start.get('gruppe') ?? 'offen');
  const [projekt, setProjekt] = useState(start.get('projekt') ?? '');
  const [zustaendig, setZustaendig] = useState(start.get('zustaendig') ?? '');
  const [suche, setSuche] = useState('');

  const q = new URLSearchParams({ gruppe });
  if (projekt) q.set('projekt', projekt);
  if (zustaendig) q.set('zustaendig', zustaendig);
  if (suche.trim().length >= 2) q.set('suche', suche.trim());

  const liste = useDaten<{ aufgaben: AufgabeKurz[] }>(`/aufgaben?${q}`);
  const projekte = useDaten<{ projekte: Projekt[] }>('/projekte', 0);
  const ma = useDaten<{ mitarbeiter: Mitarbeiter[] }>('/mitarbeiter', 0);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div class="reihe" style={{ justifyContent: 'space-between' }}>
        <div class="reiter" role="group" aria-label="Status-Filter" style={{ flex: 1, minWidth: 0 }}>
          {GRUPPEN.map((g) => (
            <button key={g.wert} aria-pressed={gruppe === g.wert} onClick={() => setGruppe(g.wert)}>
              {g.text}
            </button>
          ))}
        </div>
        {benutzer.rolle === 'gf' && (
          <a class="btn btn-gold btn-sm" href="/aufgaben/neu">
            <Plus size={16} aria-hidden="true" /> Neuer Auftrag
          </a>
        )}
      </div>

      <div class="werkzeugleiste">
        <input class="eingabe suche" type="search" placeholder="Suchen (Titel oder TD-Nummer)" value={suche} onInput={(e) => setSuche((e.target as HTMLInputElement).value)} aria-label="Suche" />
        <select class="eingabe" value={projekt} onChange={(e) => setProjekt((e.target as HTMLSelectElement).value)} aria-label="Projekt">
          <option value="">Alle Projekte</option>
          {projekte.daten?.projekte.map((p) => (
            <option value={p.slug} key={p.slug}>{p.name}</option>
          ))}
        </select>
        <select class="eingabe" value={zustaendig} onChange={(e) => setZustaendig((e.target as HTMLSelectElement).value)} aria-label="Zuständig">
          <option value="">Alle Mitarbeiter</option>
          {ma.daten?.mitarbeiter.map((m) => (
            <option value={m.id} key={m.id}>{m.rolle}</option>
          ))}
        </select>
      </div>

      <Karte>
        {liste.fehler ? (
          <p class="hinweis krit"><AlertTriangle size={18} />{liste.fehler.message}</p>
        ) : !liste.daten ? (
          <Ladebalken />
        ) : liste.daten.aufgaben.length === 0 ? (
          <Leer Icon={ListChecks} titel="Keine Aufgaben in dieser Ansicht">
            {benutzer.rolle === 'gf' && <a class="btn btn-ghost btn-sm" href="/aufgaben/neu">Ersten Auftrag erteilen</a>}
          </Leer>
        ) : (
          <AufgabenListe aufgaben={liste.daten.aufgaben} ohneProjekt={!!projekt} />
        )}
      </Karte>
    </div>
  );
}
