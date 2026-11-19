import { useState } from 'preact/hooks';
import { AlertTriangle, ExternalLink, FolderKanban, GitBranch, Plus } from 'lucide-preact';
import { Karte, Ladebalken, Leer, Pill } from '../komponenten/Bausteine';
import { useDaten } from '../lib/daten';
import { toenung } from '../lib/format';
import { useKopf } from '../lib/kopf';
import { navigiere } from '../lib/router';
import type { Benutzer, Projekt } from '../lib/typen';
import { ProjektFormular } from './ProjektFormular';

export function Projekte({ benutzer, geaendert }: { benutzer: Benutzer; geaendert: () => void }) {
  useKopf('Projekte', 'Portfolio');
  const { daten, fehler, neuLaden } = useDaten<{ projekte: Projekt[] }>('/projekte');
  const [neu, setNeu] = useState(false);
  const [filter, setFilter] = useState<'aktiv' | 'alle'>('aktiv');

  if (!daten) return fehler ? <p class="hinweis krit"><AlertTriangle size={18} />{fehler.message}</p> : <Ladebalken />;

  const liste = daten.projekte.filter((p) => filter === 'alle' || p.status !== 'archiviert');

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div class="reihe">
        <div class="reihe" role="group" aria-label="Filter">
          <button class={`btn btn-sm ${filter === 'aktiv' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('aktiv')}>Laufend</button>
          <button class={`btn btn-sm ${filter === 'alle' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('alle')}>Alle inkl. Archiv</button>
        </div>
        {benutzer.rolle === 'gf' && (
          <button class="btn btn-gold btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setNeu(true)}>
            <Plus size={16} aria-hidden="true" /> Projekt anlegen
          </button>
        )}
      </div>

      {neu && (
        <Karte titel="Neues Projekt" kicker="Anlegen">
          <ProjektFormular
            abbrechen={() => setNeu(false)}
            gespeichert={(slug) => {
              setNeu(false);
              geaendert();
              void neuLaden();
              navigiere(`/projekte/${slug}`);
            }}
          />
        </Karte>
      )}

      {liste.length === 0 ? (
        <Karte><Leer Icon={FolderKanban} titel="Keine Projekte" /></Karte>
      ) : (
        <div class="pj-liste" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {liste.map((p) => (
            <a class="karte akzent pj-karte" href={`/projekte/${p.slug}`} key={p.slug} style={{ '--akzent': p.farbe, padding: 0 }}>
              <div style={{ padding: '16px 18px 18px', display: 'grid', gap: 12 }}>
                <div class="pj-kopf">
                  <span class="pj-ic" style={{ background: toenung(p.farbe), color: p.farbe, width: 42, height: 42 }} aria-hidden="true">
                    {p.name.replace(/^TE-(Digital )?/, '').slice(0, 2).toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <b style={{ fontSize: 16.5 }}>{p.name}</b>
                    <span>{p.kurz}</span>
                  </div>
                </div>
                <div class="reihe" style={{ gap: 6 }}>
                  <Pill ton={p.status === 'aktiv' ? 'ok' : p.status === 'archiviert' ? '' : 'warn'}>{p.status}</Pill>
                  {p.offene_freigaben > 0 && <Pill ton="gold">{p.offene_freigaben} Freigaben</Pill>}
                  {p.blockiert > 0 && <Pill ton="krit">{p.blockiert} blockiert</Pill>}
                </div>
                <div class="pj-zahlen">
                  <span><b>{p.offene_aufgaben}</b> offene Aufgaben</span>
                  <span><b>{p.abgeschlossen}</b> erledigt</span>
                </div>
                <div class="pj-zahlen" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  {p.repo_url && <span class="reihe" style={{ gap: 4 }}><GitBranch size={13} aria-hidden="true" />{p.repo_url.replace('https://github.com/', '')}</span>}
                  {p.website_url && <span class="reihe" style={{ gap: 4 }}><ExternalLink size={13} aria-hidden="true" />{new URL(p.website_url).host}</span>}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
