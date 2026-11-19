import { useEffect, useRef, useState } from 'preact/hooks';
import { Mic, MicOff } from 'lucide-preact';
import { toast } from './Toast';

/* Web Speech API – in Chrome/Edge (Google-Server) und Safari (Apple-Server) verfügbar, kostenlos. */
type Erkennung = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function erkennungsKlasse(): (new () => Erkennung) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Erkennung; webkitSpeechRecognition?: new () => Erkennung };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function diktatMoeglich(): boolean {
  return erkennungsKlasse() !== null;
}

const HINWEIS = 'te-diktat-hinweis';

/**
 * Mikrofon-Knopf, der diktierten Text an ein Eingabefeld anhängt.
 * Fehlt die Browser-Unterstützung (z. B. Firefox), wird nichts angezeigt – das Mikrofon der
 * Handy-Tastatur funktioniert immer.
 */
export function Diktat({ ziel, label = 'Diktieren' }: { ziel: () => HTMLTextAreaElement | HTMLInputElement | null; label?: string }) {
  const [laeuft, setLaeuft] = useState(false);
  const erkennung = useRef<Erkennung | null>(null);
  const Klasse = erkennungsKlasse();

  useEffect(() => () => erkennung.current?.stop(), []);
  if (!Klasse) return null;

  function anhaengen(text: string) {
    const el = ziel();
    if (!el) return;
    const davor = el.value && !/\s$/.test(el.value) ? ' ' : '';
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, el.value + davor + text.trim());
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function starten() {
    let bekannt = false;
    try {
      bekannt = localStorage.getItem(HINWEIS) === '1';
    } catch {
      /* ignorieren */
    }
    if (!bekannt) {
      const ok = confirm(
        'Spracheingabe im Browser\n\nDie Aufnahme wird vom Browser-Hersteller verarbeitet (Chrome/Edge: Google, Safari: Apple) – kostenlos, aber außerhalb der Zentrale. Bitte keine vertraulichen Kundendaten diktieren.\n\nAlternativ: Mikrofon der Handy-Tastatur.\n\nFortfahren?',
      );
      if (!ok) return;
      try {
        localStorage.setItem(HINWEIS, '1');
      } catch {
        /* ignorieren */
      }
    }
    const e = new Klasse!();
    e.lang = 'de-DE';
    e.continuous = true;
    e.interimResults = false;
    e.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        if (r.isFinal) anhaengen(r[0].transcript);
      }
    };
    e.onerror = (ev) => {
      if (ev.error === 'not-allowed') toast('Mikrofon nicht erlaubt');
      else if (ev.error !== 'no-speech' && ev.error !== 'aborted') toast('Spracheingabe nicht verfügbar');
    };
    e.onend = () => setLaeuft(false);
    erkennung.current = e;
    e.start();
    setLaeuft(true);
  }

  return (
    <button
      type="button"
      class={`btn btn-sm ${laeuft ? 'btn-primary' : 'btn-ghost'}`}
      onClick={() => (laeuft ? erkennung.current?.stop() : starten())}
      aria-pressed={laeuft}
      title={laeuft ? 'Diktat beenden' : label}
    >
      {laeuft ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
      {laeuft ? 'Stopp' : label}
    </button>
  );
}

/** Text vorlesen (Gerätestimme, lokal, kostenlos). */
export function vorlesen(text: string): boolean {
  if (!('speechSynthesis' in window)) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  const stimme = speechSynthesis.getVoices().find((v) => v.lang.startsWith('de'));
  if (stimme) u.voice = stimme;
  speechSynthesis.speak(u);
  return true;
}
