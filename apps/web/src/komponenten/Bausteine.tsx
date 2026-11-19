import type { ComponentChildren } from 'preact';
import type { LucideIcon } from 'lucide-preact';

export function Karte(props: {
  titel?: string;
  kicker?: string;
  mehr?: { text: string; href: string };
  klasse?: string;
  akzent?: string;
  children: ComponentChildren;
}) {
  return (
    <section class={`karte ${props.akzent ? 'akzent' : ''} ${props.klasse ?? ''}`} style={props.akzent ? { '--akzent': props.akzent } : undefined}>
      {props.titel && (
        <div class="karte-kopf">
          <div>
            {props.kicker && <p class="kicker">{props.kicker}</p>}
            <h2>{props.titel}</h2>
          </div>
          {props.mehr && (
            <a class="mehr" href={props.mehr.href}>
              {props.mehr.text} →
            </a>
          )}
        </div>
      )}
      <div class="karte-inhalt">{props.children}</div>
    </section>
  );
}

export function Kennzahl(props: { titel: string; wert: number | string; fuss?: string; Icon: LucideIcon; ton?: 'gold' | 'krit' | 'ok'; klasse?: string }) {
  const { Icon } = props;
  return (
    <div class={`karte kennzahl ${props.ton ?? ''} ${props.klasse ?? ''}`}>
      <div class="k-kopf">
        <span class="k-ic">
          <Icon size={17} aria-hidden="true" />
        </span>
        {props.titel}
      </div>
      <div class="k-wert">{props.wert}</div>
      {props.fuss && <div class="k-fuss">{props.fuss}</div>}
    </div>
  );
}

export function Pill(props: { ton?: 'ok' | 'warn' | 'krit' | 'info' | 'gold' | ''; children: ComponentChildren; titel?: string }) {
  return (
    <span class={`pill ${props.ton ?? ''}`} title={props.titel}>
      {props.children}
    </span>
  );
}

export function Leer(props: { Icon: LucideIcon; titel: string; text?: string; children?: ComponentChildren }) {
  const { Icon } = props;
  return (
    <div class="leer">
      <Icon size={30} aria-hidden="true" />
      <b>{props.titel}</b>
      {props.text}
      {props.children && <div style={{ marginTop: 12 }}>{props.children}</div>}
    </div>
  );
}

export function Ladebalken() {
  return <div class="ladebalken" role="progressbar" aria-label="Wird geladen" />;
}
