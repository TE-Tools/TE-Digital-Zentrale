import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { LayoutDashboard, ListChecks, Menu, Plus, ShieldCheck, WifiOff } from 'lucide-preact';
import { aufLiveZustand, liveZustand, type LiveZustand } from '../lib/live';
import { initialen } from '../lib/format';
import type { Benutzer } from '../lib/typen';
import { useDaten } from '../lib/daten';
import { BEREICHE, istAktiv } from './navigation';
import { MarkenKachel } from './Marke';

interface ProjektKurz { slug: string; name: string; farbe: string; status: string }

export function Rahmen(props: {
  pfad: string;
  benutzer: Benutzer;
  titel: string;
  kicker?: string;
  aktionen?: ComponentChildren;
  offeneFreigaben?: number;
  ungelesen?: number;
  meldungen?: number;
  /** Zeitpunkt des letzten erfolgreichen Ladens (Offline-Anzeige) */
  stand?: number | null;
  /** Erhöhen, um die Projektliste der Seitenleiste neu zu laden */
  projekteVersion?: number;
  children: ComponentChildren;
}) {
  const [mehrOffen, setMehrOffen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [live, setLive] = useState<LiveZustand>(liveZustand());
  useEffect(() => aufLiveZustand(setLive), []);
  useEffect(() => {
    const an = () => setOnline(true);
    const aus = () => setOnline(false);
    window.addEventListener('online', an);
    window.addEventListener('offline', aus);
    return () => {
      window.removeEventListener('online', an);
      window.removeEventListener('offline', aus);
    };
  }, []);
  const projekte = useDaten<{ projekte: ProjektKurz[] }>('/projekte', 300_000, props.projekteVersion);
  const sichtbare = (projekte.daten?.projekte ?? []).filter((p) => p.status !== 'archiviert');

  useEffect(() => setMehrOffen(false), [props.pfad]);
  useEffect(() => {
    document.title = `${props.titel} · TE-Digital Zentrale`;
  }, [props.titel]);

  const aktuell = (p: string) => (istAktiv(p, props.pfad) ? 'page' : undefined);

  return (
    <div class="app">
      <aside class="seitenleiste" aria-label="Hauptnavigation">
        <a class="marke" href="/">
          <MarkenKachel />
          <span class="marke-text">
            <b>TE-Digital</b>
            <span>Zentrale</span>
          </span>
        </a>
        <nav>
          {BEREICHE.map((b) => (
            <a class="nav-link" href={b.pfad} aria-current={aktuell(b.pfad)} key={b.pfad}>
              <b.Icon size={18} aria-hidden="true" />
              {b.text}
              {b.pfad === '/freigaben' && (props.offeneFreigaben ?? 0) > 0 ? (
                <span class="badge">{props.offeneFreigaben}</span>
              ) : b.pfad === '/benachrichtigungen' && (props.meldungen ?? 0) > 0 ? (
                <span class="badge">{props.meldungen}</span>
              ) : b.pfad === '/kommunikation' && (props.ungelesen ?? 0) > 0 ? (
                <span class="badge" title="Ungelesene Nachrichten an die Geschäftsführung">{props.ungelesen}</span>
              ) : b.phase ? (
                <span class="bald" title={`Folgt in Phase ${b.phase}`}>P{b.phase}</span>
              ) : null}
            </a>
          ))}
          {sichtbare.length > 0 && <div class="nav-gruppe">Projekte</div>}
          {sichtbare.map((p) => (
            <a class="nav-link" href={`/projekte/${p.slug}`} aria-current={aktuell(`/projekte/${p.slug}`)} key={p.slug}>
              <span class="projekt-punkt" style={{ background: p.farbe }} aria-hidden="true" />
              {p.name}
            </a>
          ))}
        </nav>
        <div class="seitenleiste-fuss">
          <span class="avatar" aria-hidden="true">{initialen(props.benutzer.name)}</span>
          <span class="wer">
            <b>{props.benutzer.name}</b>
            {props.benutzer.rolle === 'gf' ? 'Geschäftsführung' : 'Lesezugriff'}
          </span>
          <span
            class={`live-punkt ${live}`}
            title={live === 'verbunden' ? 'Live verbunden – Änderungen erscheinen sofort' : live === 'verbinde' ? 'Verbinde …' : 'Nicht live – Aktualisierung jede Minute'}
            aria-label={live === 'verbunden' ? 'Live verbunden' : 'Nicht live verbunden'}
          />
        </div>
      </aside>

      <div class="haupt">
        <header class="kopf">
          <a href="/" aria-label="Zum Dashboard">
            <MarkenKachel groesse={30} />
          </a>
          <div style={{ minWidth: 0 }}>
            {props.kicker && <p class="kicker">{props.kicker}</p>}
            <h1>{props.titel}</h1>
          </div>
          <div class="kopf-rechts">{props.aktionen}</div>
        </header>
        {!online && (
          <div class="offline-band" role="status">
            <WifiOff size={16} aria-hidden="true" />
            Offline – angezeigt wird der letzte Stand{props.stand ? ` von ${new Date(props.stand).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : ''}. Änderungen sind erst wieder mit Verbindung möglich.
          </div>
        )}
        <main class="inhalt" id="inhalt">
          {props.children}
        </main>
      </div>

      <nav class="unten-nav" aria-label="Schnellnavigation">
        <a class="unten-link" href="/" aria-current={props.pfad === '/' ? 'page' : undefined}>
          <LayoutDashboard size={21} aria-hidden="true" />
          Übersicht
        </a>
        <a class="unten-link" href="/aufgaben" aria-current={props.pfad.startsWith('/aufgaben') && props.pfad !== '/aufgaben/neu' ? 'page' : undefined}>
          <ListChecks size={21} aria-hidden="true" />
          Aufgaben
        </a>
        <a class="unten-link" href="/aufgaben/neu" aria-label="Neuer Auftrag">
          <span class="unten-plus">
            <Plus size={24} aria-hidden="true" />
          </span>
        </a>
        <a class="unten-link" href="/freigaben" aria-current={aktuell('/freigaben')}>
          <ShieldCheck size={21} aria-hidden="true" />
          Freigaben
          {(props.offeneFreigaben ?? 0) > 0 && <span class="badge">{props.offeneFreigaben}</span>}
        </a>
        <button class="unten-link" type="button" onClick={() => setMehrOffen(true)} aria-expanded={mehrOffen}>
          <Menu size={21} aria-hidden="true" />
          Mehr
          {(props.ungelesen ?? 0) + (props.meldungen ?? 0) > 0 && <span class="badge">{(props.ungelesen ?? 0) + (props.meldungen ?? 0)}</span>}
        </button>
      </nav>

      {mehrOffen && (
        <>
          <div class="blatt-hintergrund" onClick={() => setMehrOffen(false)} />
          <div class="blatt" role="dialog" aria-modal="true" aria-label="Alle Bereiche">
            <div class="blatt-griff" />
            {BEREICHE.map((b) => (
              <a class="nav-link" href={b.pfad} aria-current={aktuell(b.pfad)} key={b.pfad}>
                <b.Icon size={19} aria-hidden="true" />
                {b.text}
                {b.phase && <span class="bald">P{b.phase}</span>}
              </a>
            ))}
            <div class="nav-gruppe">Projekte</div>
            {sichtbare.map((p) => (
              <a class="nav-link" href={`/projekte/${p.slug}`} key={p.slug}>
                <span class="projekt-punkt" style={{ background: p.farbe }} aria-hidden="true" />
                {p.name}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
