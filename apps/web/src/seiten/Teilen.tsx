import { useEffect, useState } from 'preact/hooks';
import { ClipboardPaste, MessageSquarePlus, Plus, Share2 } from 'lucide-preact';
import { Karte, Ladebalken, Leer } from '../komponenten/Bausteine';
import { toast } from '../komponenten/Toast';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { useKopf } from '../lib/kopf';
import { navigiere } from '../lib/router';
import type { AufgabeKurz } from '../lib/typen';

interface Geteilt { titel: string; text: string; url: string }

/** Liest den vom Service Worker abgelegten Inhalt (einmalig) bzw. Query-Parameter als Rückfall. */
async function geteiltLesen(): Promise<Geteilt | null> {
  const q = new URLSearchParams(location.search);
  if (q.get('geteilt') === '1' && 'caches' in window) {
    const cache = await caches.open('te-geteilt');
    const r = await cache.match('/geteilt');
    if (r) {
      await cache.delete('/geteilt');
      return (await r.json()) as Geteilt;
    }
  }
  const text = q.get('text') ?? '';
  return text || q.get('url') ? { titel: q.get('title') ?? '', text, url: q.get('url') ?? '' } : null;
}

export const NEUER_AUFTRAG_VORLAGE = 'te-auftrag-vorlage';

export function Teilen() {
  useKopf('Geteilter Inhalt', 'Aus einer anderen App');
  const [inhalt, setInhalt] = useState<Geteilt | null | undefined>(undefined);
  const [aufgabe, setAufgabe] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const offene = useDaten<{ aufgaben: AufgabeKurz[] }>('/aufgaben?gruppe=offen', 0);

  useEffect(() => {
    geteiltLesen().then(setInhalt, () => setInhalt(null));
  }, []);

  useEffect(() => {
    // Naheliegend: die zuletzt bearbeitete Aufgabe in Arbeit vorauswählen
    const kandidat = offene.daten?.aufgaben.find((a) => a.status === 'in_bearbeitung' || a.status === 'zugewiesen');
    if (kandidat && !aufgabe) setAufgabe(kandidat.id);
  }, [offene.daten]);

  if (inhalt === undefined) return <Ladebalken />;
  if (!inhalt) {
    return (
      <Karte>
        <Leer Icon={Share2} titel="Nichts geteilt" text="Auf Android in ChatGPT, Gemini oder Grok auf „Teilen“ tippen und die TE-Zentrale wählen. Auf dem iPhone die Antwort kopieren und in der Aufgabe einfügen." />
      </Karte>
    );
  }

  const gesamt = [inhalt.titel, inhalt.text, inhalt.url].filter(Boolean).join('\n\n');

  async function alsAntwort() {
    setLaeuft(true);
    try {
      // Nur Text (+ Link) – der Titel des Teilen-Dialogs gehört nicht zur Antwort
      const antwort = [inhalt!.text, inhalt!.url].filter(Boolean).join('\n\n') || gesamt;
      const r = await api.post<{ erkannt: { freigabe: string | null; rueckfragen: boolean } }>(`/aufgaben/${aufgabe}/ergebnis`, { text: antwort });
      toast(`Als Antwort zu ${aufgabe} übernommen${r.erkannt.freigabe ? ` · Freigabe ${r.erkannt.freigabe}` : ''}`);
      navigiere(`/aufgaben/${aufgabe}`, true);
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Fehler');
    } finally {
      setLaeuft(false);
    }
  }

  async function alsNotiz() {
    setLaeuft(true);
    try {
      await api.post('/nachrichten', { art: 'notiz', von: 'gf', an: null, inhalt: gesamt });
      toast('Als Notiz unter Kommunikation abgelegt');
      navigiere('/kommunikation', true);
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Fehler');
    } finally {
      setLaeuft(false);
    }
  }

  function alsAuftrag() {
    try {
      sessionStorage.setItem(NEUER_AUFTRAG_VORLAGE, JSON.stringify({ titel: inhalt!.titel, beschreibung: [inhalt!.text, inhalt!.url].filter(Boolean).join('\n\n') }));
    } catch {
      /* ignorieren */
    }
    navigiere('/aufgaben/neu', true);
  }

  return (
    <div class="raster">
      <div class="sp-7">
        <Karte titel={inhalt.titel || 'Geteilter Text'} kicker={`${gesamt.length.toLocaleString('de-DE')} Zeichen`}>
          <pre class="paket" style={{ maxHeight: 420 }}>{gesamt}</pre>
        </Karte>
      </div>
      <div class="sp-5" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Karte titel="Als Antwort übernehmen" kicker="Empfohlen">
          {!offene.daten ? <Ladebalken /> : offene.daten.aufgaben.length === 0 ? (
            <p class="textblock leer">Keine offenen Aufgaben.</p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <select class="eingabe" value={aufgabe} onChange={(e) => setAufgabe((e.target as HTMLSelectElement).value)} aria-label="Aufgabe">
                {offene.daten.aufgaben.map((a) => (
                  <option value={a.id} key={a.id}>{a.id} · {a.titel}</option>
                ))}
              </select>
              <div>
                <button class="btn btn-primary" disabled={laeuft || !aufgabe} onClick={alsAntwort}>
                  <ClipboardPaste size={17} aria-hidden="true" /> Übernehmen
                </button>
              </div>
              <p class="zeitstempel" style={{ margin: 0 }}>Ergebnis, Rückfragen, Freigabeanträge und Zwischenstand werden automatisch erkannt.</p>
            </div>
          )}
        </Karte>
        <Karte titel="Oder …">
          <div class="reihe">
            <button class="btn btn-ghost btn-sm" disabled={laeuft} onClick={alsAuftrag}><Plus size={16} aria-hidden="true" /> Neuen Auftrag daraus</button>
            <button class="btn btn-ghost btn-sm" disabled={laeuft} onClick={alsNotiz}><MessageSquarePlus size={16} aria-hidden="true" /> Als Notiz ablegen</button>
          </div>
        </Karte>
      </div>
    </div>
  );
}
