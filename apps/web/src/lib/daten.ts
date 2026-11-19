import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiFehler, api } from './api';
import { liveZustand } from './live';

interface Zustand<T> {
  daten: T | null;
  fehler: ApiFehler | null;
  laedt: boolean;
  /** Zeitpunkt des letzten erfolgreichen Ladens (für die Offline-Anzeige) */
  stand: number | null;
  neuLaden: () => Promise<void>;
}

function gespeichert<T>(schluessel?: string): { daten: T; stand: number } | null {
  if (!schluessel) return null;
  try {
    const roh = localStorage.getItem(`te-cache:${schluessel}`);
    return roh ? (JSON.parse(roh) as { daten: T; stand: number }) : null;
  } catch {
    return null;
  }
}

/**
 * Lädt Daten von der API.
 * - Echtzeit: lädt neu, sobald die Live-Verbindung eine Änderung meldet (Ereignis „te:geaendert“).
 * - Polling nur als Rückfall, wenn die Live-Verbindung fehlt (Free-Tarif sparsam).
 * - Beim Zurückkehren in die App wird frisch geladen.
 * - Optional `speichern`: letzter Stand bleibt auf diesem Gerät für die Offline-Anzeige erhalten.
 */
export function useDaten<T>(pfad: string | null, intervallMs = 60_000, ausloeser: unknown = 0, speichern?: string): Zustand<T> {
  const start = gespeichert<T>(speichern);
  const [daten, setDaten] = useState<T | null>(start?.daten ?? null);
  const [stand, setStand] = useState<number | null>(start?.stand ?? null);
  const [fehler, setFehler] = useState<ApiFehler | null>(null);
  const [laedt, setLaedt] = useState(true);
  const aktuellerPfad = useRef(pfad);
  aktuellerPfad.current = pfad;

  const neuLaden = useCallback(async () => {
    if (!pfad) return;
    setLaedt(true);
    try {
      const d = await api.get<T>(pfad);
      if (aktuellerPfad.current === pfad) {
        const jetzt = Date.now();
        setDaten(d);
        setStand(jetzt);
        setFehler(null);
        if (speichern) {
          try {
            localStorage.setItem(`te-cache:${speichern}`, JSON.stringify({ daten: d, stand: jetzt }));
          } catch {
            /* Speicher voll oder gesperrt */
          }
        }
      }
    } catch (e) {
      if (aktuellerPfad.current === pfad) setFehler(e as ApiFehler);
    } finally {
      if (aktuellerPfad.current === pfad) setLaedt(false);
    }
  }, [pfad, speichern]);

  useEffect(() => {
    void neuLaden();
    const sichtbar = () => document.visibilityState === 'visible' && void neuLaden();
    const geaendert = () => document.visibilityState === 'visible' && void neuLaden();
    document.addEventListener('visibilitychange', sichtbar);
    window.addEventListener('te:geaendert', geaendert);
    window.addEventListener('online', geaendert);
    const t =
      intervallMs > 0
        ? setInterval(() => document.visibilityState === 'visible' && liveZustand() !== 'verbunden' && void neuLaden(), intervallMs)
        : 0;
    return () => {
      document.removeEventListener('visibilitychange', sichtbar);
      window.removeEventListener('te:geaendert', geaendert);
      window.removeEventListener('online', geaendert);
      if (t) clearInterval(t);
    };
  }, [neuLaden, intervallMs, ausloeser]);

  // Beim Wechsel auf eine andere Ressource alte Daten nicht anzeigen
  const ersterPfad = useRef(pfad);
  useEffect(() => {
    if (ersterPfad.current !== pfad) setDaten(null);
    ersterPfad.current = pfad;
  }, [pfad]);

  return { daten, fehler, laedt, stand, neuLaden };
}
