import { useEffect, useState } from 'preact/hooks';
import { AlertTriangle, CheckCheck, MessagesSquare, Send } from 'lucide-preact';
import { Karte, Ladebalken, Leer, Pill } from '../komponenten/Bausteine';
import { toast } from '../komponenten/Toast';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { relativeZeit } from '../lib/format';
import { useKopf } from '../lib/kopf';
import { NACHRICHTEN_ART, teilnehmerName } from '../lib/texte';
import type { Benutzer, Mitarbeiter, Nachricht, NachrichtenArt, Projekt } from '../lib/typen';
import { Auswahl } from '../komponenten/Auswahl';
import { Aufklappbar } from './AufgabeDetail';

export function Kommunikation({ benutzer, gelesen }: { benutzer: Benutzer; gelesen: () => void }) {
  useKopf('Kommunikation', 'Zentrale Nachrichten');
  const [ansicht, setAnsicht] = useState<'alle' | 'ungelesen'>('alle');
  const [teilnehmer, setTeilnehmer] = useState('');
  const [art, setArt] = useState('');
  const q = new URLSearchParams();
  if (ansicht === 'ungelesen') q.set('ungelesen', '1');
  if (teilnehmer) q.set('teilnehmer', teilnehmer);
  if (art) q.set('art', art);
  const liste = useDaten<{ nachrichten: Nachricht[] }>(`/nachrichten?${q}`);
  const ma = useDaten<{ mitarbeiter: Mitarbeiter[] }>('/mitarbeiter', 0);
  const projekte = useDaten<{ projekte: Projekt[] }>('/projekte', 0);
  const mitarbeiter = ma.daten?.mitarbeiter ?? [];
  const gf = benutzer.rolle === 'gf';

  // Ungelesene werden beim Ansehen der Gesamtliste als gelesen markiert (nach kurzer Anzeige)
  const ungeleseneIds = (liste.daten?.nachrichten ?? []).filter((n) => n.an === 'gf' && !n.gelesen_am).map((n) => n.id);
  useEffect(() => {
    if (!gf || ungeleseneIds.length === 0) return;
    const t = setTimeout(() => {
      void api.post('/nachrichten/gelesen', { ids: ungeleseneIds }).then(gelesen);
    }, 2500);
    return () => clearTimeout(t);
  }, [ungeleseneIds.join(',')]);

  return (
    <div class="raster">
      <div class="sp-8" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
        <div class="werkzeugleiste">
          <div class="reiter" role="group" aria-label="Ansicht">
            <button aria-pressed={ansicht === 'alle'} onClick={() => setAnsicht('alle')}>Alle</button>
            <button aria-pressed={ansicht === 'ungelesen'} onClick={() => setAnsicht('ungelesen')}>Ungelesen</button>
          </div>
          <select class="eingabe" value={teilnehmer} onChange={(e) => setTeilnehmer((e.target as HTMLSelectElement).value)} aria-label="Teilnehmer">
            <option value="">Alle Teilnehmer</option>
            <option value="gf">Geschäftsführung</option>
            {mitarbeiter.map((m) => <option value={m.id} key={m.id}>{m.rolle}</option>)}
          </select>
          <select class="eingabe" value={art} onChange={(e) => setArt((e.target as HTMLSelectElement).value)} aria-label="Art">
            <option value="">Alle Arten</option>
            {Object.entries(NACHRICHTEN_ART).map(([k, v]) => <option value={k} key={k}>{v.text}</option>)}
          </select>
          {gf && ungeleseneIds.length > 0 && (
            <button class="btn btn-text btn-sm" onClick={() => api.post('/nachrichten/gelesen', {}).then(() => { gelesen(); void liste.neuLaden(); })}>
              <CheckCheck size={16} aria-hidden="true" /> Alle gelesen
            </button>
          )}
        </div>
        <Karte>
          {liste.fehler ? (
            <p class="hinweis krit"><AlertTriangle size={18} />{liste.fehler.message}</p>
          ) : !liste.daten ? (
            <Ladebalken />
          ) : liste.daten.nachrichten.length === 0 ? (
            <Leer Icon={MessagesSquare} titel="Keine Nachrichten" text="Übergaben, Ergebnisberichte, Rückfragen und Warnungen erscheinen hier – zentral, nicht verstreut in Chatverläufen." />
          ) : (
            <ul class="verlauf">
              {liste.daten.nachrichten.map((n) => (
                <li key={n.id} class={`nachricht ${n.von === 'gf' ? 'von-gf' : ''} ${n.an === 'gf' && !n.gelesen_am ? 'ungelesen' : ''}`}>
                  <div class="nachricht-kopf">
                    <b>{teilnehmerName(n.von, mitarbeiter)}</b>→ {teilnehmerName(n.an, mitarbeiter)}
                    <Pill ton={NACHRICHTEN_ART[n.art].ton}>{NACHRICHTEN_ART[n.art].text}</Pill>
                    {n.aufgabe_id && <a href={`/aufgaben/${n.aufgabe_id}`}>{n.aufgabe_id}</a>}
                    {!n.aufgabe_id && n.projekt_name && <span>{n.projekt_name}</span>}
                    <span style={{ marginLeft: 'auto' }}>{relativeZeit(n.zeit)}</span>
                  </div>
                  {n.aufgabe_titel && <div class="zeitstempel" style={{ marginBottom: 4 }}>{n.aufgabe_titel}</div>}
                  <Aufklappbar text={n.inhalt} />
                </li>
              ))}
            </ul>
          )}
        </Karte>
      </div>

      <div class="sp-4">
        {gf && <NeueNachricht mitarbeiter={mitarbeiter} projekte={projekte.daten?.projekte ?? []} fertig={liste.neuLaden} />}
      </div>
    </div>
  );
}

function NeueNachricht({ mitarbeiter, projekte, fertig }: { mitarbeiter: Mitarbeiter[]; projekte: Projekt[]; fertig: () => Promise<void> }) {
  const [art, setArt] = useState<NachrichtenArt>('information');
  const [fehler, setFehler] = useState<string | null>(null);
  async function senden(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const f = new FormData(form);
    const t = (k: string) => String(f.get(k) ?? '').trim();
    const aufgabe = t('aufgabe_id').toUpperCase().replace(/^(\d+)$/, (m) => `TD-${m.padStart(4, '0')}`);
    try {
      await api.post('/nachrichten', {
        art,
        von: t('von') || 'gf',
        an: t('an') || null,
        projekt_slug: t('projekt_slug') || null,
        aufgabe_id: aufgabe || null,
        inhalt: t('inhalt'),
      });
      form.reset();
      setFehler(null);
      toast('Nachricht gespeichert');
      await fertig();
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : 'Fehler');
    }
  }
  return (
    <Karte titel="Nachricht erfassen" kicker="Neu">
      <p class="zeitstempel" style={{ margin: '0 0 12px' }}>
        Auch Nachrichten aus einem KI-Tool (z. B. eine Warnung von Grok) hier ablegen, damit nichts im Chatverlauf verloren geht.
      </p>
      <form onSubmit={senden} style={{ display: 'grid', gap: 10 }}>
        <div class="formular-raster">
          <label class="feld">
            <span>Von</span>
            <Auswahl class="eingabe" name="von" defaultValue="gf">
              <option value="gf">Geschäftsführung</option>
              {mitarbeiter.map((m) => <option value={m.id} key={m.id}>{m.rolle}</option>)}
            </Auswahl>
          </label>
          <label class="feld">
            <span>An</span>
            <Auswahl class="eingabe" name="an" defaultValue="">
              <option value="">Alle</option>
              <option value="gf">Geschäftsführung</option>
              {mitarbeiter.map((m) => <option value={m.id} key={m.id}>{m.rolle}</option>)}
            </Auswahl>
          </label>
        </div>
        <label class="feld">
          <span>Art</span>
          <select class="eingabe" value={art} onChange={(e) => setArt((e.target as HTMLSelectElement).value as NachrichtenArt)}>
            {Object.entries(NACHRICHTEN_ART).map(([k, v]) => <option value={k} key={k}>{v.text}</option>)}
          </select>
        </label>
        <div class="formular-raster">
          <label class="feld">
            <span>Projekt</span>
            <Auswahl class="eingabe" name="projekt_slug" defaultValue="">
              <option value="">–</option>
              {projekte.map((p) => <option value={p.slug} key={p.slug}>{p.name}</option>)}
            </Auswahl>
          </label>
          <label class="feld">
            <span>Aufgabe</span>
            <input class="eingabe" name="aufgabe_id" placeholder="TD-0001" />
          </label>
        </div>
        <label class="feld">
          <span>Inhalt</span>
          <textarea class="eingabe" name="inhalt" rows={5} required />
        </label>
        {fehler && <p class="feld-fehler">{fehler}</p>}
        <div><button class="btn btn-primary btn-sm"><Send size={16} aria-hidden="true" /> Speichern</button></div>
      </form>
    </Karte>
  );
}
