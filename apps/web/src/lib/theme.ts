export type ThemaWahl = 'system' | 'hell' | 'dunkel';

export function themaLesen(): ThemaWahl {
  try {
    const t = localStorage.getItem('te-theme');
    return t === 'hell' || t === 'dunkel' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function themaSetzen(t: ThemaWahl): void {
  try {
    if (t === 'system') localStorage.removeItem('te-theme');
    else localStorage.setItem('te-theme', t);
  } catch {
    /* ignorieren */
  }
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t === 'hell' ? 'light' : 'dark';
}
