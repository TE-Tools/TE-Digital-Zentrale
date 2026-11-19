import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiFehler, api } from './api';

interface Zustand<T> {
  daten: T | null;
  fehler: ApiFehler | null;
  laedt: boolean;
  neuLaden: () => Promise<void>;
}

/**
 * Lädt Daten von der API und aktualisiert sie regelmäßig sowie beim Zurückkehren in die App.
 * (Echtzeit per Durable Object folgt in Phase 4; bis dahin sparsames Polling – Free-Tarif.)
 */
export function useDaten<T>(pfad: string | null, intervallMs = 60_000, ausloeser: unknown = 0): Zustand<T> {
  const [daten, setDaten] = useState<T | null>(null);
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
        setDaten(d);
        setFehler(null);
      }
    } catch (e) {
      if (aktuellerPfad.current === pfad) setFehler(e as ApiFehler);
    } finally {
      if (aktuellerPfad.current === pfad) setLaedt(false);
    }
  }, [pfad]);

  useEffect(() => {
    void neuLaden();
    const sichtbar = () => document.visibilityState === 'visible' && void neuLaden();
    document.addEventListener('visibilitychange', sichtbar);
    const t = intervallMs > 0 ? setInterval(() => document.visibilityState === 'visible' && void neuLaden(), intervallMs) : 0;
    return () => {
      document.removeEventListener('visibilitychange', sichtbar);
      if (t) clearInterval(t);
    };
  }, [neuLaden, intervallMs, ausloeser]);

  // Beim Wechsel auf eine andere Ressource alte Daten nicht anzeigen
  useEffect(() => setDaten(null), [pfad]);

  return { daten, fehler, laedt, neuLaden };
}
