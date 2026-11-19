import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

/**
 * Unkontrolliertes <select> mit Startwert. Preact setzt „defaultValue“ bei <select> nicht
 * (die DOM-Eigenschaft existiert dort nicht) – daher wird der Wert einmalig per Ref gesetzt.
 */
export function Auswahl({ defaultValue, ...rest }: Omit<JSX.IntrinsicElements['select'], 'defaultValue' | 'ref'> & { defaultValue?: string | number }) {
  const ref = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    if (ref.current && defaultValue !== undefined) ref.current.value = String(defaultValue);
  }, []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preact-Typen der select-Attribute sind hier zu eng
  return <select ref={ref} {...(rest as any)} />;
}
