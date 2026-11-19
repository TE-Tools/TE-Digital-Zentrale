import { useState } from 'preact/hooks';
import { AlertTriangle, ArrowLeft, ExternalLink, GitBranch, ListChecks, Pencil, ShieldCheck, Target } from 'lucide-preact';
import { Karte, Kennzahl, Ladebalken, Leer, Pill } from '../komponenten/Bausteine';
import { useDaten } from '../lib/daten';
import { aktivitaetText, datum, relativeZeit } from '../lib/format';
import { useKopf } from '../lib/kopf';
import type { Aktivitaet, AufgabeKurz, Benutzer, Projekt } from '../lib/typen';
import { AufgabenListe } from '../komponenten/AufgabenListe';
import { ProjektFormular } from './ProjektFormular';

export function ProjektDetail({ slug, benutzer, geaendert }: { slug: string; benutzer: Benutzer; geaendert: () => void }) {
  const { daten, fehler, neuLaden } = useDaten<{ projekt: Projekt; aktivitaeten: Aktivitaet[] }>(`/projekte/${slug}`);
  const [bearbeiten, setBearbeiten] = useState(false);
  const p = daten?.projekt;
  useKopf(p?.name ?? 'Projekt', 'Projekt');

  if (!p) {
    return fehler ? (
      <div class="hinweis krit"><AlertTriangle size={18} /><p>{fehler.message} <a href="/projekte">Zur Projektliste</a></p></div>
    ) : (
      <Ladebalken />
    );
  }

  return (
    <div class="raster" style={{ '--akzent': p.farbe }}>
      <div class="sp-12 reihe">
        <a class="btn btn-text btn-sm" href="/projekte"><ArrowLeft size={16} aria-hidden="true" /> Alle Projekte</a>
        <div class="reihe" style={{ marginLeft: 'auto', gap: 6 }}>
          <Pill ton={p.status === 'aktiv' ? 'ok' : p.status === 'archiviert' ? '' : 'warn'}>{p.status}</Pill>
          {benutzer.rolle === 'gf' && !bearbeiten && (
            <button class="btn btn-ghost btn-sm" onClick={() => setBearbeiten(true)}>
              <Pencil size={15} aria-hidden="true" /> Bearbeiten
            </button>
          )}
        </div>
      </div>

      {bearbeiten ? (
        <div class="sp-12">
          <Karte titel="Projekt bearbeiten" akzent={p.farbe}>
            <ProjektFormular
              projekt={p}
              abbrechen={() => setBearbeiten(false)}
              gespeichert={() => {
                setBearbeiten(false);
                geaendert();
                void neuLaden();
              }}
            />
          </Karte>
        </div>
      ) : (
        <>
          <div class="sp-8">
            <Karte titel="Überblick" kicker={p.kurz || 'Projekt'} akzent={p.farbe}>
              <p style={{ margin: '0 0 16px', whiteSpace: 'pre-line' }}>{p.beschreibung || 'Noch keine Beschreibung.'}</p>
              <dl class="daten">
                <dt>GitHub</dt>
                <dd>{p.repo_url ? <a href={p.repo_url} target="_blank" rel="noopener noreferrer" class="reihe" style={{ gap: 5, display: 'inline-flex' }}><GitBranch size={14} />{p.repo_url.replace('https://github.com/', '')}</a> : '–'}</dd>
                <dt>Website</dt>
                <dd>{p.website_url ? <a href={p.website_url} target="_blank" rel="noopener noreferrer" class="reihe" style={{ gap: 5, display: 'inline-flex' }}><ExternalLink size={14} />{p.website_url.replace('https://', '')}</a> : '–'}</dd>
                <dt>Hosting</dt>
                <dd>{p.hosting || '–'}</dd>
                <dt>Technologie</dt>
                <dd>{p.stack || '–'}</dd>
                <dt>Angelegt</dt>
                <dd>{datum(p.erstellt_am)} · zuletzt geändert {relativeZeit(p.aktualisiert_am)}</dd>
              </dl>
            </Karte>
          </div>
          <div class="sp-4" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
            <Kennzahl titel="Offene Aufgaben" wert={p.offene_aufgaben} fuss={`${p.abgeschlossen} erledigt`} Icon={ListChecks} />
            <Kennzahl titel="Offene Freigaben" wert={p.offene_freigaben} fuss={p.blockiert ? `${p.blockiert} Aufgaben blockiert` : 'keine Blockaden'} Icon={ShieldCheck} ton="gold" />
          </div>
          <div class="sp-6">
            <Karte titel="Ziele" kicker="Ausrichtung">
              {p.ziele ? (
                <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
                  {p.ziele.split('\n').filter(Boolean).map((z, i) => <li key={i}>{z}</li>)}
                </ul>
              ) : (
                <Leer Icon={Target} titel="Noch keine Ziele" text="Über „Bearbeiten“ ergänzen." />
              )}
            </Karte>
          </div>
          <div class="sp-6">
            <Karte titel="Änderungsprotokoll" kicker="Audit">
              {daten.aktivitaeten.length === 0 ? (
                <Leer Icon={ListChecks} titel="Noch keine Einträge" />
              ) : (
                <ul class="zeitleiste">
                  {daten.aktivitaeten.map((a) => (
                    <li key={a.id}>
                      <span class="punkt" aria-hidden="true" style={{ borderColor: p.farbe }} />
                      <div class="text">
                        <b>{a.akteur_name ?? 'System'}</b> {aktivitaetText(a)}
                        {a.details && JSON.parse(a.details).felder ? <span class="zeitstempel"> ({(JSON.parse(a.details).felder as string[]).join(', ')})</span> : null}
                        <div class="zeitstempel">{relativeZeit(a.zeit)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Karte>
          </div>
          <div class="sp-12">
            <ProjektAufgaben slug={p.slug} gf={benutzer.rolle === 'gf'} />
          </div>
        </>
      )}
    </div>
  );
}

function ProjektAufgaben({ slug, gf }: { slug: string; gf: boolean }) {
  const [gruppe, setGruppe] = useState<'offen' | 'erledigt'>('offen');
  const r = useDaten<{ aufgaben: AufgabeKurz[] }>(`/aufgaben?projekt=${slug}&gruppe=${gruppe}`);
  return (
    <Karte titel="Aufgaben" kicker="Projektbereich" mehr={{ text: 'In der Aufgabenliste', href: `/aufgaben?projekt=${slug}` }}>
      <div class="reihe" style={{ marginBottom: 10 }}>
        <div class="reiter" role="group" aria-label="Filter">
          <button aria-pressed={gruppe === 'offen'} onClick={() => setGruppe('offen')}>Offen</button>
          <button aria-pressed={gruppe === 'erledigt'} onClick={() => setGruppe('erledigt')}>Erledigt</button>
        </div>
        {gf && <a class="btn btn-gold btn-sm" style={{ marginLeft: 'auto' }} href={`/aufgaben/neu?projekt=${slug}`}>+ Auftrag für dieses Projekt</a>}
      </div>
      {!r.daten ? <Ladebalken /> : r.daten.aufgaben.length === 0 ? (
        <Leer Icon={ListChecks} titel={gruppe === 'offen' ? 'Keine offenen Aufgaben' : 'Noch nichts erledigt'} />
      ) : (
        <AufgabenListe aufgaben={r.daten.aufgaben} ohneProjekt />
      )}
    </Karte>
  );
}
