/**
 * Live-Verbindung zur Zentrale (WebSocket über Durable Object).
 * Der Server schickt nur „etwas hat sich geändert“; die Seiten laden dann über die API nach.
 * Fällt die Verbindung aus, greift weiterhin das (langsamere) Polling in useDaten.
 */
export type LiveZustand = 'verbinde' | 'verbunden' | 'getrennt';

const hoerer = new Set<(z: LiveZustand) => void>();
let zustand: LiveZustand = 'getrennt';
let ws: WebSocket | null = null;
let versuche = 0;
let pingTimer = 0;
let neuTimer = 0;
let aktiv = false;

function setze(z: LiveZustand) {
  zustand = z;
  hoerer.forEach((h) => h(z));
}

export function liveZustand(): LiveZustand {
  return zustand;
}

export function aufLiveZustand(h: (z: LiveZustand) => void): () => void {
  hoerer.add(h);
  return () => void hoerer.delete(h);
}

/** Alle Datenansichten neu laden lassen (gebündelt, max. 1× pro 400 ms). */
let aenderungTimer = 0;
export function aenderungMelden(): void {
  clearTimeout(aenderungTimer);
  aenderungTimer = window.setTimeout(() => window.dispatchEvent(new Event('te:geaendert')), 400);
}

function verbinden() {
  if (!aktiv || ws) return;
  setze('verbinde');
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`;
  const s = new WebSocket(url);
  ws = s;
  s.onopen = () => {
    versuche = 0;
    setze('verbunden');
    aenderungMelden(); // nach (Wieder-)Verbindung einmal frisch laden
    clearInterval(pingTimer);
    pingTimer = window.setInterval(() => s.readyState === WebSocket.OPEN && s.send('ping'), 30_000);
  };
  s.onmessage = (e) => {
    if (e.data === 'pong') return;
    aenderungMelden();
  };
  s.onclose = () => {
    clearInterval(pingTimer);
    ws = null;
    setze('getrennt');
    if (!aktiv) return;
    // Exponentielles Zurückhalten: 2 s, 4 s, … max. 60 s
    const warte = Math.min(60_000, 2000 * 2 ** versuche++);
    clearTimeout(neuTimer);
    neuTimer = window.setTimeout(verbinden, warte);
  };
  s.onerror = () => s.close();
}

export function liveStarten(): void {
  if (aktiv) return;
  aktiv = true;
  verbinden();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !ws && aktiv) {
      versuche = 0;
      verbinden();
    }
  });
  window.addEventListener('online', () => {
    versuche = 0;
    if (!ws && aktiv) verbinden();
  });
}

export function liveBeenden(): void {
  aktiv = false;
  clearTimeout(neuTimer);
  ws?.close();
  ws = null;
}
