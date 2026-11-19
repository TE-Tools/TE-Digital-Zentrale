import { createContext } from 'preact';
import { useContext, useEffect } from 'preact/hooks';

export interface Kopf {
  titel: string;
  kicker?: string;
}

export const KopfKontext = createContext<(k: Kopf) => void>(() => {});

/** Seiten setzen damit Titel und Kicker der Kopfzeile. */
export function useKopf(titel: string, kicker?: string): void {
  const setzen = useContext(KopfKontext);
  useEffect(() => setzen({ titel, kicker }), [titel, kicker, setzen]);
}
