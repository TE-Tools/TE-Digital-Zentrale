import { useEffect, useState } from 'preact/hooks';
import { Bot, ExternalLink, Play, RotateCcw, Square } from 'lucide-preact';
import { Karte, Pill } from './Bausteine';
import { toast } from './Toast';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { relativeZeit } from '../lib/format';
import type { AufgabenStatus, AutomatikDaten, KiLauf } from '../lib/typen';

export const AUTOMATIK_TEXT: Record<'workers_ai' | 'github_claude', string> = {
  workers_ai: 'Workers AI (kostenlos im eigenen Konto)',
  github_claude: 'Claude Code auf GitHub (Claude-Abo)',
};

const LAUF_TON: Record<KiLauf['status'], 'ok' | 'warn' | 'krit' | 'info' | 'gold' | ''> = {
  wartet: 'gold',
  laeuft: 'ok',
  fertig: 'ok',
  fehler: 'krit',
  limit: 'warn',
  abgebrochen: '',
};
const LAUF_TEXT: Record<KiLauf['status'], string> = {
  wartet: 'wartet auf Start',
  laeuft: 'arbeitet',
  fertig: 'fertig',
  fehler: 'Fehler',
  limit: 'Pause (Limit)',
  abgebrochen: 'abgebrochen',
};

/** Hält relative Zeitangaben („seit 3 Min.“) aktuell, solange etwas läuft. */
function useTick(aktiv: boolean, ms = 15_000): number {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    if (!aktiv) return;
    const i = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(i);
  }, [aktiv, ms]);
  return t;
}

/**
 * „Was passiert gerade?“ – zeigt ehrlich, ob eine KI an der Aufgabe arbeitet.
 * Automatische Mitarbeiter (Assistent, Claude Code) starten per Knopf; bei allen anderen
 * steht klar da, dass nur gearbeitet wird, während das Paket im Chat eingefügt ist.
 */
export function AutomatikKarte({ id, gf, status }: { id: string; gf: boolean; status: AufgabenStatus }) {
  const { daten, neuLaden } = useDaten<AutomatikDaten>(`/automatik/aufgaben/${id}`, 30_000);
  const [laeuft, setLaeuft] = useState(false);
  const letzter = daten?.laeufe[0] ?? null;
  const aktiv = !!letzter && (letzter.status === 'wartet' || letzter.status === 'laeuft');
  const jetzt = useTick(aktiv);

  // Während ein Lauf aktiv ist, zusätzlich alle 20 s nachladen (falls die Live-Verbindung fehlt)
  useEffect(() => {
    if (!aktiv) return;
    const i = setInterval(() => void neuLaden(), 20_000);
    return () => clearInterval(i);
  }, [aktiv, neuLaden]);

  if (!daten) return null;

  if (!daten.automatik) {
    return (
      <Karte titel="Wer arbeitet gerade?" kicker="Automatik">
        <div class="hinweis info">
          <Bot size={18} aria-hidden="true" />
          <p>
            {daten.mitarbeiter ? (
              <>
                <b>{daten.mitarbeiter} arbeitet nicht automatisch.</b> Die KI arbeitet nur, während Sie das Übergabepaket im Chat einfügen –
                in der Zentrale sehen Sie das erst, wenn die Antwort zurückgeführt ist.
              </>
            ) : (
              <b>Noch niemand zugewiesen.</b>
            )}{' '}
            Ohne Kopieren geht es mit <b>Assistent</b> (Workers AI) oder <b>Claude Code</b> – unter „Bearbeiten“ zuweisen.
          </p>
        </div>
      </Karte>
    );
  }

  const startbar = gf && !aktiv && !['abgeschlossen', 'abgebrochen', 'freigabe_erforderlich'].includes(status);

  async function ausfuehren(fn: () => Promise<unknown>, erfolg: string) {
    setLaeuft(true);
    try {
      await fn();
      toast(erfolg);
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Das hat nicht geklappt.');
    } finally {
      await neuLaden();
      setLaeuft(false);
    }
  }

  const starten = (modus: 'voll' | 'fortsetzung') =>
    ausfuehren(() => api.post(`/automatik/aufgaben/${id}/starten`, { modus }), `${daten.mitarbeiter} legt los`);

  return (
    <Karte titel="Wer arbeitet gerade?" kicker={AUTOMATIK_TEXT[daten.automatik]}>
      {!letzter && <p class="textblock leer" style={{ marginTop: 0 }}>{daten.mitarbeiter} hat mit dieser Aufgabe noch nicht begonnen.</p>}

      {letzter && (
        <div class={`hinweis ${letzter.status === 'fehler' ? 'krit' : letzter.status === 'limit' ? 'warn' : letzter.status === 'fertig' ? 'ok' : ''}`} aria-live="polite">
          {aktiv ? <span class="puls" style={{ marginTop: 4, ...(letzter.status === 'wartet' ? { '--puls': 'var(--gold)' } : {}) }} aria-hidden="true" /> : <Bot size={18} aria-hidden="true" />}
          <p>
            {letzter.status === 'laeuft' && <b>{daten.mitarbeiter} arbeitet – seit {relativeZeit(letzter.gestartet_am ?? letzter.erstellt_am, jetzt).replace(/^vor /, '')}. </b>}
            {letzter.status === 'wartet' && <b>Wird gestartet … </b>}
            {letzter.status === 'fertig' && <b>Fertig {relativeZeit(letzter.beendet_am, jetzt)}. </b>}
            {letzter.status === 'limit' && <b>Pause. </b>}
            {letzter.status === 'fehler' && <b>Nicht geklappt. </b>}
            {letzter.status === 'abgebrochen' && <b>Abgebrochen. </b>}
            {letzter.meldung}
            {aktiv && <span class="zeitstempel"> · letztes Lebenszeichen {relativeZeit(letzter.aktualisiert_am, jetzt)}</span>}
            {letzter.extern_url && (
              <>
                {' '}
                <a href={letzter.extern_url} target="_blank" rel="noopener noreferrer">
                  Lauf auf GitHub ansehen <ExternalLink size={13} aria-hidden="true" />
                </a>
              </>
            )}
          </p>
        </div>
      )}

      {gf && (
        <div class="aktionsleiste" style={{ marginTop: 14 }}>
          {startbar && !letzter && (
            <button class="btn btn-primary btn-sm" disabled={laeuft} onClick={() => starten('voll')}>
              <Play size={16} aria-hidden="true" /> Jetzt automatisch bearbeiten lassen
            </button>
          )}
          {startbar && letzter && (
            <button class="btn btn-primary btn-sm" disabled={laeuft} onClick={() => starten(letzter.status === 'fertig' ? 'voll' : 'fortsetzung')}>
              <RotateCcw size={16} aria-hidden="true" /> {letzter.status === 'fertig' ? 'Noch einmal bearbeiten lassen' : 'Erneut versuchen'}
            </button>
          )}
          {aktiv && (
            <button class="btn btn-ghost btn-sm" disabled={laeuft} onClick={() => ausfuehren(() => api.post(`/automatik/laeufe/${letzter!.id}/abbrechen`, {}), 'Abgebrochen')}>
              <Square size={15} aria-hidden="true" /> Abbrechen
            </button>
          )}
        </div>
      )}

      {daten.laeufe.length > 1 && (
        <details style={{ marginTop: 12 }}>
          <summary class="zeitstempel" style={{ cursor: 'pointer' }}>Frühere Durchläufe ({daten.laeufe.length - 1})</summary>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 6 }}>
            {daten.laeufe.slice(1).map((l) => (
              <li key={l.id} class="reihe" style={{ gap: 8, fontSize: 13.5 }}>
                <Pill ton={LAUF_TON[l.status]}>{LAUF_TEXT[l.status]}</Pill>
                <span class="zeitstempel">{relativeZeit(l.erstellt_am, jetzt)}</span>
                <span>{l.meldung}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Karte>
  );
}
