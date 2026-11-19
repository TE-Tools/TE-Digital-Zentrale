import { useEffect, useState } from 'preact/hooks';

let anzeigen: (t: string) => void = () => {};

/** Kurze Bestätigung unten am Bildschirm. */
export function toast(text: string): void {
  anzeigen(text);
}

export function ToastHost() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let timer = 0;
    anzeigen = (t) => {
      setText(t);
      clearTimeout(timer);
      timer = window.setTimeout(() => setText(null), 2800);
    };
    return () => clearTimeout(timer);
  }, []);
  return text ? (
    <div class="toast" role="status" aria-live="polite">
      {text}
    </div>
  ) : null;
}
