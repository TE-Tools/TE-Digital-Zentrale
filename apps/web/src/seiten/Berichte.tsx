import { useState } from 'preact/hooks';
import { AlertTriangle, ArrowLeft, Cloud, FileText, Gauge, ListChecks, Plus, RefreshCw } from 'lucide-preact';
import { Karte, Kennzahl, Ladebalken, Leer, Pill } from '../komponenten/Bausteine';
import { Markdown } from '../komponenten/Markdown';
import { toast } from '../komponenten/Toast';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { aktivitaetLink, aktivitaetText, datum, relativeZeit } from '../lib/format';
import { useKopf } from '../lib/kopf';
import { navigiere } from '../lib/router';
import type { Aktivitaet, Benutzer, Projekt } from '../lib/typen';

interface BerichtKurz {
  id: number;
  typ: 'tag' | 'projekt';
  datum: string;
  titel: string;
  projekt_name: string | null;
  projekt_farbe: string | null;
  kennzahlen: Record<string, number>;
  erstellt_am: string;
}

type Ansicht = 'berichte' | 'protokoll' | 'kosten';

export function Berichte({ benutzer }: { benutzer: Benutzer }) {
  useKopf('Berichte', 'Berichte · Protokoll · Kosten');
  const start = new URLSearchParams(location.search).get('ansicht') as Ansicht | null;
  const [ansicht, setAnsicht] = useState<Ansicht>(start ?? 'berichte');
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div class="reiter" role="group" aria-label="Ansicht">
        <button aria-pressed={ansicht === 'berichte'} onClick={() => setAnsicht('berichte')}><FileText size={15} aria-hidden="true" /> Tages- & Projektberichte</button>
        <button aria-pressed={ansicht === 'protokoll'} onClick={() => setAnsicht('protokoll')}><ListChecks size={15} aria-hidden="true" /> Aktivitätsprotokoll</button>
        <button aria-pressed={ansicht === 'kosten'} onClick={() => setAnsicht('kosten')}><Gauge size={15} aria-hidden="true" /> Infrastruktur & Kosten</button>
      </div>
      {ansicht === 'berichte' && <BerichtListe gf={benutzer.rolle === 'gf'} />}
      {ansicht === 'protokoll' && <Protokoll />}
      {ansicht === 'kosten' && <Kosten gf={benutzer.rolle === 'gf'} />}
    </div>
  );
}

// ------------------------------------------------------------------ Berichte

function BerichtListe({ gf }: { gf: boolean }) {
  const liste = useDaten<{ berichte: BerichtKurz[] }>('/berichte');
  const projekte = useDaten<{ projekte: Projekt[] }>('/projekte', 0);
  const [laeuft, setLaeuft] = useState(false);

  async function erstellen(pfad: string, body: unknown) {
    setLaeuft(true);
    try {
      const r = await api.post<{ id: number }>(pfad, body);
      navigiere(`/berichte/${r.id}`);
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Fehler');
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div class="raster">
      <div class="sp-8">
        <Karte titel="Berichte" kicker="Automatisch aus den Daten der Zentrale">
          {!liste.daten ? <Ladebalken /> : liste.daten.berichte.length === 0 ? (
            <Leer Icon={FileText} titel="Noch keine Berichte" text="Der Tagesbericht entsteht automatisch zur eingestellten Uhrzeit (Benachrichtigungen) und kommt als Push." />
          ) : (
            <ul class="aufgaben-liste">
              {liste.daten.berichte.map((b) => (
                <li key={b.id}>
                  <a class="aufgabe-zeile" href={`/berichte/${b.id}`} style={{ '--akzent': b.projekt_farbe ?? 'var(--gold)' }}>
                    <span class="leiste" aria-hidden="true" />
                    <div style={{ minWidth: 0 }}>
                      <div class="titel">{b.titel}</div>
                      <div class="meta">
                        <span>{b.kennzahlen.erledigt ?? 0} erledigt</span>
                        <span>{b.kennzahlen.offen ?? 0} offen</span>
                        {b.kennzahlen.freigaben_offen ? <span>{b.kennzahlen.freigaben_offen} Freigaben offen</span> : null}
                        <span>erstellt {relativeZeit(b.erstellt_am)}</span>
                      </div>
                    </div>
                    <div class="rechts"><Pill ton={b.typ === 'tag' ? 'gold' : 'info'}>{b.typ === 'tag' ? 'Tagesbericht' : 'Projektbericht'}</Pill></div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Karte>
      </div>
      {gf && (
        <div class="sp-4" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
          <Karte titel="Tagesbericht" kicker="Letzte 24 Stunden">
            <button class="btn btn-primary btn-sm" disabled={laeuft} onClick={() => erstellen('/berichte/tag', {})}>
              <RefreshCw size={15} aria-hidden="true" /> Jetzt erstellen
            </button>
            <p class="zeitstempel" style={{ margin: '10px 0 0' }}>Ersetzt den heutigen Tagesbericht durch einen aktuellen Stand.</p>
          </Karte>
          <Karte titel="Projektbericht" kicker="Zeitraum wählen">
            <form
              style={{ display: 'grid', gap: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.target as HTMLFormElement);
                void erstellen('/berichte/projekt', { projekt_slug: String(f.get('projekt')), tage: Number(f.get('tage')) });
              }}
            >
              <select class="eingabe" name="projekt" required aria-label="Projekt">
                {projekte.daten?.projekte.map((p) => <option value={p.slug} key={p.slug}>{p.name}</option>)}
              </select>
              <select class="eingabe" name="tage" aria-label="Zeitraum">
                <option value="7">Letzte 7 Tage</option>
                <option value="30">Letzte 30 Tage</option>
                <option value="90">Letzte 90 Tage</option>
              </select>
              <div><button class="btn btn-ghost btn-sm" disabled={laeuft}><Plus size={15} aria-hidden="true" /> Erstellen</button></div>
            </form>
          </Karte>
        </div>
      )}
    </div>
  );
}

export function BerichtDetail({ id }: { id: string }) {
  const d = useDaten<{ bericht: BerichtKurz & { inhalt: string; von: string; bis: string } }>(`/berichte/${id}`, 0);
  const b = d.daten?.bericht;
  useKopf(b?.titel ?? 'Bericht', b?.typ === 'projekt' ? 'Projektbericht' : 'Tagesbericht');
  if (!b) return d.fehler ? <p class="hinweis krit">{d.fehler.message}</p> : <Ladebalken />;
  const k = b.kennzahlen;
  return (
    <div class="raster">
      <div class="sp-12"><a class="btn btn-text btn-sm" href="/berichte"><ArrowLeft size={16} aria-hidden="true" /> Alle Berichte</a></div>
      <div class="sp-3"><Kennzahl titel="Erledigt" wert={k.erledigt ?? 0} fuss={`${k.neu ?? 0} neu im Zeitraum`} Icon={ListChecks} ton="ok" /></div>
      <div class="sp-3"><Kennzahl titel="Offen" wert={k.offen ?? 0} fuss={`${k.in_arbeit ?? 0} in Arbeit · ${k.pruefung ?? 0} Prüfung`} Icon={FileText} /></div>
      <div class="sp-3"><Kennzahl titel="Freigaben offen" wert={k.freigaben_offen ?? 0} fuss={`${k.freigaben_entschieden ?? 0} entschieden`} Icon={FileText} ton="gold" /></div>
      <div class="sp-3"><Kennzahl titel="Blockiert" wert={k.blockiert ?? 0} fuss={`${k.wartend ?? 0} wartend`} Icon={AlertTriangle} ton={k.blockiert ? 'krit' : undefined} /></div>
      <div class="sp-12">
        <Karte akzent={b.projekt_farbe ?? 'var(--gold)'}>
          <Markdown text={b.inhalt} />
          <p class="zeitstempel" style={{ marginTop: 12 }}>Erstellt {datum(b.erstellt_am)} · Zeitraum {datum(b.von)} – {datum(b.bis)}</p>
        </Karte>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Aktivitätsprotokoll

const BEREICHE: Record<string, string> = {
  aufgabe: 'Aufgaben',
  freigabe: 'Freigaben',
  entscheidung: 'Entscheidungen',
  wissen: 'Wissen',
  projekt: 'Projekte',
  nachricht: 'Nachrichten',
  sperre: 'Sperren',
  github: 'GitHub',
  zugang: 'KI-Zugänge',
  anmeldung: 'Anmeldungen',
  mitarbeiter: 'Mitarbeiter',
  bericht: 'Berichte',
};

function Protokoll() {
  const [bereich, setBereich] = useState('');
  const [akteur, setAkteur] = useState('');
  const [seiten, setSeiten] = useState<Aktivitaet[][]>([]);
  const [weiter, setWeiter] = useState<number | null>(null);
  const q = new URLSearchParams();
  if (bereich) q.set('bereich', bereich);
  if (akteur) q.set('akteur_typ', akteur);
  const erste = useDaten<{ eintraege: Aktivitaet[]; weiter: number | null }>(`/berichte/protokoll?${q}`);
  const zeilen = [...(erste.daten?.eintraege ?? []), ...seiten.flat()];
  const naechste = seiten.length ? weiter : (erste.daten?.weiter ?? null);

  async function mehr() {
    if (!naechste) return;
    const r = await api.get<{ eintraege: Aktivitaet[]; weiter: number | null }>(`/berichte/protokoll?${q}&vor=${naechste}`);
    setSeiten([...seiten, r.eintraege]);
    setWeiter(r.weiter);
  }

  return (
    <Karte titel="Aktivitätsprotokoll" kicker="Unveränderlich · Audit">
      <div class="werkzeugleiste" style={{ marginBottom: 12 }}>
        <select class="eingabe" value={bereich} onChange={(e) => { setBereich((e.target as HTMLSelectElement).value); setSeiten([]); }} aria-label="Bereich">
          <option value="">Alle Bereiche</option>
          {Object.entries(BEREICHE).map(([k, v]) => <option value={k} key={k}>{v}</option>)}
        </select>
        <select class="eingabe" value={akteur} onChange={(e) => { setAkteur((e.target as HTMLSelectElement).value); setSeiten([]); }} aria-label="Akteur">
          <option value="">Alle Akteure</option>
          <option value="benutzer">Geschäftsführung</option>
          <option value="mitarbeiter">KI-Mitarbeiter (MCP)</option>
          <option value="system">System</option>
        </select>
      </div>
      {!erste.daten ? <Ladebalken /> : (
        <div class="md-tabelle protokoll markdown">
          <table>
            <thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Objekt</th></tr></thead>
            <tbody>
              {zeilen.map((a) => {
                const link = aktivitaetLink(a);
                return (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(a.zeit).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{a.akteur_name ?? 'System'}{a.akteur_typ === 'mitarbeiter' ? ' 🤖' : ''}</td>
                    <td>{aktivitaetText(a)}</td>
                    <td>{a.objekt_id ? (link ? <a href={link}>{a.objekt_id}</a> : a.objekt_id) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {naechste && <button class="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={mehr}>Ältere laden</button>}
    </Karte>
  );
}

// ------------------------------------------------------------------ Kosten

interface KostenDaten {
  eingerichtet: boolean;
  tarif: string;
  heute: string;
  grenzen: { dienst: string; metrik: string; grenze: number; text: string }[];
  sparmodus: boolean;
  fehler: string | null;
  aktuell: { dienst: string; metrik: string; wert: number; grenze: number; erfasst_am: string }[];
}

export function KostenBalken({ werte, grenzen }: { werte: KostenDaten['aktuell']; grenzen: KostenDaten['grenzen'] }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {grenzen.map((g) => {
        const w = werte.find((x) => x.dienst === g.dienst && x.metrik === g.metrik);
        const anteil = w ? w.wert / w.grenze : 0;
        return (
          <div class="balken" key={`${g.dienst}.${g.metrik}`}>
            <div class="balken-kopf">
              <b>{g.text}</b>
              <span class="zahl">{w ? `${Math.round(anteil * 100)} % · ${w.wert.toLocaleString('de-DE')} / ${g.grenze.toLocaleString('de-DE')}` : '–'}</span>
            </div>
            <div class="balken-spur" role="img" aria-label={`${Math.round(anteil * 100)} Prozent`}>
              <i class={anteil >= 0.95 ? 'krit' : anteil >= 0.8 ? 'warn' : ''} style={{ width: `${Math.min(100, anteil * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Kosten({ gf }: { gf: boolean }) {
  const d = useDaten<KostenDaten>('/kosten', 300_000);
  const [laeuft, setLaeuft] = useState(false);
  if (!d.daten) return <Ladebalken />;
  const k = d.daten;

  async function messen() {
    setLaeuft(true);
    try {
      await api.post('/kosten/messen', {});
      toast('Nutzung aktualisiert');
      await d.neuLaden();
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Fehler');
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div class="raster">
      <div class="sp-7">
        <Karte titel="Nutzung heute" kicker={`${k.tarif} · Cloudflare-Konto (alle TE-Apps)`}>
          {!k.eingerichtet ? (
            <div class="hinweis info">
              <Cloud size={18} aria-hidden="true" />
              <p>
                <b>Kostenwächter noch nicht eingerichtet.</b> Benötigt werden die Cloudflare-Konto-ID (<code>CF_ACCOUNT_ID</code>) und ein API-Token nur mit dem Recht
                „Account Analytics: Lesen“ (<code>CF_ANALYTICS_TOKEN</code>) als Worker-Secrets. Siehe README.
              </p>
            </div>
          ) : (
            <>
              {k.sparmodus && (
                <div class="hinweis warn" style={{ marginBottom: 12 }}>
                  <AlertTriangle size={18} aria-hidden="true" />
                  <p><b>Sparmodus aktiv:</b> über 70 % der täglichen Worker-Anfragen. Der stündliche GitHub-Abgleich ist bis 01:00 Uhr ausgesetzt.</p>
                </div>
              )}
              <KostenBalken werte={k.aktuell} grenzen={k.grenzen} />
              <p class="zeitstempel" style={{ margin: '12px 0 0' }}>Stand {k.aktuell[0] ? relativeZeit(k.aktuell[0].erfasst_am) : '–'} · Messung stündlich · Grenzen gelten je UTC-Tag.</p>
            </>
          )}
          {k.fehler && <p class="feld-fehler" style={{ marginTop: 10 }}>Letzte Messung fehlgeschlagen: {k.fehler}</p>}
          {gf && k.eingerichtet && (
            <button class="btn btn-ghost btn-sm" style={{ marginTop: 12 }} disabled={laeuft} onClick={messen}><RefreshCw size={15} aria-hidden="true" /> Jetzt messen</button>
          )}
        </Karte>
      </div>
      <div class="sp-5">
        <Karte titel="So schützt die Zentrale vor Kosten" kicker="Pflichtenheft 13">
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
            <li>Tarif <b>Workers Free</b>: Beim Überschreiten entstehen keine Kosten – Anfragen schlagen bis zum Tageswechsel (01:00 Uhr) fehl.</li>
            <li>Warnung ab <b>80 %</b> (wichtig) und <b>95 %</b> (kritisch) per Push, mit Ursache.</li>
            <li>Ab <b>70 %</b> der Worker-Anfragen: Sparmodus (GitHub-Abgleich ausgesetzt).</li>
            <li>Ein Wechsel auf <b>Workers Paid</b> (5 USD/Monat) ist eine Stufe-3-Freigabe – die Zentrale selbst kann keine Tarife ändern.</li>
            <li>KI-Kosten: keine – nur Claude-Abo und kostenlose Web-Zugänge, keine APIs.</li>
          </ul>
        </Karte>
      </div>
    </div>
  );
}
