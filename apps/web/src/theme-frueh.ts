// Setzt das Farbschema vor dem ersten Rendern (kein Aufblitzen).
try {
  const t = localStorage.getItem('te-theme');
  if (t === 'hell' || t === 'dunkel') document.documentElement.dataset.theme = t === 'hell' ? 'light' : 'dark';
} catch {
  /* Speicher nicht verfügbar – Systemeinstellung gilt */
}
