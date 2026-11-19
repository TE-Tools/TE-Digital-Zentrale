import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { X } from 'lucide-preact';

export function Dialog(props: { titel: string; schliessen: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && props.schliessen();
    document.addEventListener('keydown', esc);
    const alt = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = alt;
    };
  }, [props.schliessen]);
  return (
    <div class="dialog-hg" onClick={(e) => e.target === e.currentTarget && props.schliessen()}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label={props.titel}>
        <div class="dialog-kopf">
          <h2>{props.titel}</h2>
          <button class="btn btn-text btn-sm schliessen" onClick={props.schliessen} aria-label="Schließen">
            <X size={18} />
          </button>
        </div>
        <div class="dialog-inhalt">{props.children}</div>
      </div>
    </div>
  );
}
