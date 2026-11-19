import { useEffect, useState } from 'preact/hooks';

/** Minimaler History-Router ohne Abhängigkeiten. */
const hoerer = new Set<() => void>();

export function navigiere(pfad: string, ersetzen = false): void {
  if (pfad === location.pathname + location.search) return;
  if (ersetzen) history.replaceState(null, '', pfad);
  else history.pushState(null, '', pfad);
  window.scrollTo(0, 0);
  hoerer.forEach((h) => h());
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => hoerer.forEach((h) => h()));
  // Interne Links abfangen (nur Linksklick ohne Modifier, gleiche Origin, kein target)
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a || a.target || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    e.preventDefault();
    navigiere(url.pathname + url.search);
  });
}

/** Liefert den Pfad; rendert auch neu, wenn sich nur die Query (?gruppe=…) ändert. */
export function usePfad(): string {
  const [ort, setOrt] = useState(location.pathname + location.search);
  useEffect(() => {
    const h = () => setOrt(location.pathname + location.search);
    hoerer.add(h);
    return () => void hoerer.delete(h);
  }, []);
  return ort.split('?')[0]!;
}

/** Prüft „/projekte/:slug“-Muster und liefert die Parameter. */
export function passt(muster: string, pfad: string): Record<string, string> | null {
  const m = muster.split('/').filter(Boolean);
  const p = pfad.split('/').filter(Boolean);
  if (m.length !== p.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < m.length; i++) {
    const seg = m[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(p[i]!);
    else if (seg !== p[i]) return null;
  }
  return params;
}
