import { useState } from 'preact/hooks';
import { Archive, ArchiveRestore, ArrowLeft, BookOpen, History, Pencil, Plus, Save } from 'lucide-preact';
import { Auswahl } from '../komponenten/Auswahl';
import { Karte, Ladebalken, Leer, Pill } from '../komponenten/Bausteine';
import { Markdown } from '../komponenten/Markdown';
import { toast } from '../komponenten/Toast';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { datum, relativeZeit } from '../lib/format';
import { useKopf } from '../lib/kopf';
import { navigiere } from '../lib/router';
import type { Benutzer, Projekt } from '../lib/typen';

export const KATEGORIEN: Record<string, string> = {
  organisation: 'Organisation',
  rolle: 'Rolle',
  arbeitsablauf: 'Arbeitsablauf',
  anleitung: 'Anleitung',
  architektur: 'Architektur',
  technik: 'Technik',
  entscheidung: 'Entscheidung',
  zusammenfassung: 'Zusammenfassung',
  sonstiges: 'Sonstiges',
};

interface WissenKurz {
  id: number;
  projekt_slug: string | null;
  projekt_name: string | null;
  projekt_farbe: string | null;
  kategorie: string;
  titel: string;
  zusammenfassung: string;
  tags: string;
  quelle: string;
  fuer_kontext: number;
  archiviert: number;
  version: number;
  aktualisiert_am: string;
  aktualisiert_von: string;
}
interface WissenVoll extends WissenKurz {
  inhalt: string;
}

// ------------------------------------------------------------------ Liste

export function Wissen({ benutzer }: { benutzer: Benutzer }) {
  useKopf('Unternehmenswissen', 'Wissen');
  const start = new URLSearchParams(location.search);
  const [suche, setSuche] = useState('');
  const [kategorie, setKategorie] = useState('');
  const [projekt, setProjekt] = useState(start.get('projekt') ?? '');
  const [archiv, setArchiv] = useState(false);
  const q = new URLSearchParams();
  if (suche.trim().length >= 2) q.set('suche', suche.trim());
  if (kategorie) q.set('kategorie', kategorie);
  if (projekt) q.set('projekt', projekt);
  if (archiv) q.set('archiviert', '1');
  const liste = useDaten<{ wissen: WissenKurz[] }>(`/wissen?${q}`);
  const projekte = useDaten<{ projekte: Projekt[] }>('/projekte', 0);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div class="werkzeugleiste">
        <input class="eingabe suche" type="search" placeholder="Suchen in Titel, Kurzfassung, Inhalt …" value={suche} onInput={(e) => setSuche((e.target as HTMLInputElement).value)} aria-label="Suche" />
        <select class="eingabe" value={kategorie} onChange={(e) => setKategorie((e.target as HTMLSelectElement).value)} aria-label="Kategorie">
          <option value="">Alle Kategorien</option>
          {Object.entries(KATEGORIEN).map(([k, v]) => <option value={k} key={k}>{v}</option>)}
        </select>
        <select class="eingabe" value={projekt} onChange={(e) => setProjekt((e.target as HTMLSelectElement).value)} aria-label="Bereich">
          <option value="">Alle Bereiche</option>
          <option value="unternehmen">Unternehmen (übergreifend)</option>
          {projekte.daten?.projekte.map((p) => <option value={p.slug} key={p.slug}>{p.name}</option>)}
        </select>
        <label class="reihe" style={{ fontSize: 13.5 }}><input type="checkbox" checked={archiv} onChange={(e) => setArchiv((e.target as HTMLInputElement).checked)} /> Archiv</label>
        {benutzer.rolle === 'gf' && (
          <a class="btn btn-gold btn-sm" style={{ marginLeft: 'auto' }} href={`/wissen/neu${projekt && projekt !== 'unternehmen' ? `?projekt=${projekt}` : ''}`}>
            <Plus size={16} aria-hidden="true" /> Artikel anlegen
          </a>
        )}
      </div>
      {!liste.daten ? <Ladebalken /> : liste.daten.wissen.length === 0 ? (
        <Karte><Leer Icon={BookOpen} titel="Keine Artikel" text="Wissen entsteht aus Ergebnissen („Als Wissen speichern“), durch Claude Code (wissen_speichern) oder hier von Hand." /></Karte>
      ) : (
        <div class="wissen-liste">
          {liste.daten.wissen.map((w) => (
            <a key={w.id} class="karte akzent wissen-karte" href={`/wissen/${w.id}`} style={{ '--akzent': w.projekt_farbe ?? 'var(--gold)' }}>
              <div class="reihe" style={{ gap: 6 }}>
                <Pill ton={w.kategorie === 'rolle' || w.kategorie === 'organisation' || w.kategorie === 'arbeitsablauf' ? 'gold' : ''}>{KATEGORIEN[w.kategorie]}</Pill>
                <span class="zeitstempel">{w.projekt_name ?? 'Unternehmen'} · W{w.id}</span>
              </div>
              <b>{w.titel}</b>
              <p>{w.zusammenfassung || '–'}</p>
              <span class="zeitstempel">v{w.version} · {relativeZeit(w.aktualisiert_am)} · {w.aktualisiert_von}{w.fuer_kontext ? '' : ' · nicht im Übergabepaket'}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Detail / Bearbeiten

export function WissenDetail({ id, benutzer }: { id: string; benutzer: Benutzer }) {
  const neu = id === 'neu';
  const d = useDaten<{ wissen: WissenVoll; versionen: { version: number; titel: string; geaendert_von: string; geaendert_am: string }[] }>(neu ? null : `/wissen/${id}`, 0);
  const [bearbeiten, setBearbeiten] = useState(neu);
  const [ansicht, setAnsicht] = useState<number | null>(null);
  const alt = useDaten<{ version: { inhalt: string; titel: string; geaendert_von: string; geaendert_am: string } }>(ansicht ? `/wissen/${id}/versionen/${ansicht}` : null, 0);
  const w = d.daten?.wissen;
  useKopf(neu ? 'Neuer Wissensartikel' : (w?.titel ?? 'Wissen'), 'Wissen');
  const gf = benutzer.rolle === 'gf';

  if (!neu && !w) return d.fehler ? <p class="hinweis krit">{d.fehler.message}</p> : <Ladebalken />;

  if (bearbeiten) {
    return (
      <WissenFormular
        w={w}
        abbrechen={() => (neu ? navigiere('/wissen') : setBearbeiten(false))}
        gespeichert={(nid) => {
          setBearbeiten(false);
          if (neu) navigiere(`/wissen/${nid}`, true);
          else void d.neuLaden();
        }}
      />
    );
  }

  async function archivieren(archiviert: boolean) {
    await api.post(`/wissen/${id}/archivieren`, { archiviert });
    toast(archiviert ? 'Archiviert' : 'Wiederhergestellt');
    await d.neuLaden();
  }

  return (
    <div class="raster">
      <div class="sp-12 reihe">
        <a class="btn btn-text btn-sm" href="/wissen"><ArrowLeft size={16} aria-hidden="true" /> Unternehmenswissen</a>
        {gf && (
          <div class="reihe" style={{ marginLeft: 'auto' }}>
            <button class="btn btn-ghost btn-sm" onClick={() => setBearbeiten(true)}><Pencil size={15} aria-hidden="true" /> Bearbeiten</button>
            <button class="btn btn-text btn-sm" onClick={() => archivieren(!w!.archiviert)}>
              {w!.archiviert ? <><ArchiveRestore size={15} aria-hidden="true" /> Wiederherstellen</> : <><Archive size={15} aria-hidden="true" /> Archivieren</>}
            </button>
          </div>
        )}
      </div>
      <div class="sp-8">
        <Karte akzent={w!.projekt_farbe ?? 'var(--gold)'}>
          <div class="reihe" style={{ gap: 6, marginBottom: 10 }}>
            <Pill ton="gold">{KATEGORIEN[w!.kategorie]}</Pill>
            <span class="pill">{w!.projekt_name ?? 'Unternehmen'}</span>
            {w!.archiviert ? <Pill>archiviert</Pill> : null}
            <span class="zeitstempel" style={{ marginLeft: 'auto' }}>W{w!.id} · Version {w!.version}</span>
          </div>
          {ansicht && alt.daten ? (
            <>
              <div class="hinweis warn" style={{ marginBottom: 12 }}>
                <History size={16} aria-hidden="true" />
                <p style={{ flex: 1 }}>Ältere Version {ansicht} von {alt.daten.version.geaendert_von}, {datum(alt.daten.version.geaendert_am)}.</p>
                <button class="btn btn-text btn-sm" onClick={() => setAnsicht(null)}>Aktuelle anzeigen</button>
              </div>
              <Markdown text={alt.daten.version.inhalt} />
            </>
          ) : (
            <Markdown text={w!.inhalt || '_Kein Inhalt._'} />
          )}
        </Karte>
      </div>
      <div class="sp-4" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Karte titel="Kurzfassung" kicker={w!.fuer_kontext ? 'Fließt in Übergabepakete ein' : 'Nicht im Übergabepaket'}>
          <p class="textblock">{w!.zusammenfassung || '–'}</p>
          {w!.tags && <p class="zeitstempel" style={{ marginTop: 10 }}>Stichworte: {w!.tags}</p>}
          <p class="zeitstempel" style={{ marginTop: 6 }}>Quelle: {w!.quelle.startsWith('aufgabe:') ? <a href={`/aufgaben/${w!.quelle.slice(8)}`}>{w!.quelle.slice(8)}</a> : w!.quelle}</p>
        </Karte>
        <Karte titel="Versionen" kicker="Nachvollziehbar">
          <ul class="zeitleiste">
            {d.daten!.versionen.map((v) => (
              <li key={v.version}>
                <span class="punkt" aria-hidden="true" style={v.version === w!.version ? { background: 'var(--gold)' } : undefined} />
                <div class="text">
                  <button class="btn btn-text btn-sm" style={{ padding: 0, minHeight: 0 }} onClick={() => setAnsicht(v.version === w!.version ? null : v.version)}>
                    Version {v.version}
                  </button>{' '}
                  · {v.geaendert_von}
                  <div class="zeitstempel">{relativeZeit(v.geaendert_am)}</div>
                </div>
              </li>
            ))}
          </ul>
        </Karte>
      </div>
    </div>
  );
}

function WissenFormular({ w, abbrechen, gespeichert }: { w?: WissenVoll; abbrechen: () => void; gespeichert: (id: number) => void }) {
  const projekte = useDaten<{ projekte: Projekt[] }>('/projekte', 0);
  const vorProjekt = new URLSearchParams(location.search).get('projekt') ?? '';
  const [zf, setZf] = useState(w?.zusammenfassung ?? '');
  const [fehler, setFehler] = useState<string | null>(null);

  async function speichern(e: Event) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const t = (k: string) => String(f.get(k) ?? '');
    const daten = {
      titel: t('titel').trim(),
      kategorie: t('kategorie'),
      projekt_slug: t('projekt_slug') || null,
      zusammenfassung: zf.trim(),
      inhalt: t('inhalt'),
      tags: t('tags').trim(),
      fuer_kontext: f.get('fuer_kontext') === 'on',
    };
    try {
      if (w) {
        await api.patch(`/wissen/${w.id}`, { ...daten, version: w.version });
        toast('Gespeichert – neue Version');
        gespeichert(w.id);
      } else {
        const r = await api.post<{ id: number }>('/wissen', daten);
        toast('Artikel angelegt');
        gespeichert(r.id);
      }
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : 'Fehler');
    }
  }

  return (
    <form onSubmit={speichern} class="raster">
      <div class="sp-8">
        <Karte titel={w ? `W${w.id} bearbeiten` : 'Neuer Artikel'} kicker="Markdown">
          <div style={{ display: 'grid', gap: 12 }}>
            <label class="feld"><span>Titel</span><input class="eingabe" name="titel" required minLength={3} maxLength={160} defaultValue={w?.titel} /></label>
            <label class="feld">
              <span>Inhalt</span>
              <textarea class="eingabe" name="inhalt" rows={18} maxLength={60000} defaultValue={w?.inhalt} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13.5 }} placeholder={'# Überschrift\n\nText, - Listen, **fett**, `Code`, [Link](https://…)'} />
            </label>
          </div>
        </Karte>
      </div>
      <div class="sp-4" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Karte titel="Einordnung">
          <div style={{ display: 'grid', gap: 12 }}>
            <label class="feld">
              <span>Kategorie</span>
              <Auswahl class="eingabe" name="kategorie" defaultValue={w?.kategorie ?? 'anleitung'}>
                {Object.entries(KATEGORIEN).map(([k, v]) => <option value={k} key={k}>{v}</option>)}
              </Auswahl>
            </label>
            <label class="feld">
              <span>Bereich</span>
              {projekte.daten ? (
                <Auswahl class="eingabe" name="projekt_slug" defaultValue={w ? (w.projekt_slug ?? '') : vorProjekt}>
                  <option value="">Unternehmen (übergreifend)</option>
                  {projekte.daten.projekte.map((p) => <option value={p.slug} key={p.slug}>{p.name}</option>)}
                </Auswahl>
              ) : <Ladebalken />}
            </label>
            <label class="feld">
              <span>Kurzfassung für Übergabepakete</span>
              <textarea class="eingabe" rows={5} maxLength={600} value={zf} onInput={(e) => setZf((e.target as HTMLTextAreaElement).value)} placeholder="2–4 Sätze. Das Wesentliche, das ein KI-Mitarbeiter wissen muss." />
              <span class={`zaehler ${zf.length > 500 ? 'zu-lang' : ''}`}>{zf.length} / 500</span>
            </label>
            <label class="feld"><span>Stichworte</span><input class="eingabe" name="tags" maxLength={200} defaultValue={w?.tags} placeholder="kommagetrennt" /></label>
            <label class="reihe" style={{ fontSize: 14 }}><input type="checkbox" name="fuer_kontext" defaultChecked={w ? !!w.fuer_kontext : true} /> In Übergabepakete aufnehmen</label>
          </div>
        </Karte>
        {fehler && <p class="feld-fehler">{fehler}</p>}
        <div class="reihe">
          <button class="btn btn-primary"><Save size={17} aria-hidden="true" /> Speichern</button>
          <button type="button" class="btn btn-ghost" onClick={abbrechen}>Abbrechen</button>
        </div>
      </div>
    </form>
  );
}

