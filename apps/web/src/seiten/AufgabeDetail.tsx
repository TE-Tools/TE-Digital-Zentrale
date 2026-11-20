import { useEffect, useState } from 'preact/hooks';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCopy,
  ClipboardPaste,
  Hourglass,
  Link2,
  Pencil,
  Play,
  Save,
  Send,
  Share2,
  ShieldCheck,
  Trash2,
} from 'lucide-preact';
import { Fragment } from 'preact';
import { useRef } from 'preact/hooks';
import { Diktat } from '../komponenten/Diktat';
import { BookOpen, GitBranch, GitPullRequest, Lock } from 'lucide-preact';
import { navigiere } from '../lib/router';
import { branchVorschlag, CHECKS, PR_ZUSTAND } from '../lib/entwicklung';
import { Karte, Ladebalken, Pill } from '../komponenten/Bausteine';
import { Dialog } from '../komponenten/Dialog';
import { toast } from '../komponenten/Toast';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { datum, relativeZeit } from '../lib/format';
import { useKopf } from '../lib/kopf';
import { AUFGABEN_STATUS, FREIGABE_TYP, NACHRICHTEN_ART, PRIORITAET, PRUEFSTATUS, UEBERGAENGE, teilnehmerName, zuLokalFeld } from '../lib/texte';
import { Auswahl } from '../komponenten/Auswahl';
import { AutomatikKarte } from '../komponenten/Automatik';
import type { AufgabeDetailDaten, AufgabenStatus, Benutzer, Mitarbeiter, NachrichtenArt, Paket } from '../lib/typen';

const UEBERGABE_TEXTE: [keyof NonNullable<AufgabeDetailDaten['uebergabe']>, string][] = [
  ['ziel', 'Ziel'],
  ['ausgangslage', 'Ausgangslage'],
  ['dateien', 'Relevante Dateien und Informationen'],
  ['ergebnis_soll', 'Gewünschtes Ergebnis'],
  ['einschraenkungen', 'Einschränkungen'],
  ['akzeptanzkriterien', 'Akzeptanzkriterien'],
  ['freigaben', 'Erforderliche Freigaben'],
];

function meldung(e: unknown): string {
  return e instanceof ApiFehler ? e.message : 'Das hat nicht geklappt.';
}

export function AufgabeDetail({ id, benutzer }: { id: string; benutzer: Benutzer }) {
  const { daten, fehler, neuLaden } = useDaten<AufgabeDetailDaten>(`/aufgaben/${id}`, 60_000);
  const ma = useDaten<{ mitarbeiter: Mitarbeiter[] }>('/mitarbeiter', 0);
  const [dialog, setDialog] = useState<null | 'limit' | 'freigabe' | 'bearbeiten'>(null);
  const [laeuft, setLaeuft] = useState(false);
  useKopf(daten ? `${daten.aufgabe.id} · ${daten.aufgabe.titel}` : id, 'Aufgabe');

  if (!daten) {
    return fehler ? (
      <div class="hinweis krit"><AlertTriangle size={18} /><p>{fehler.message} <a href="/aufgaben">Zur Aufgabenliste</a></p></div>
    ) : (
      <Ladebalken />
    );
  }

  const a = daten.aufgabe;
  const gf = benutzer.rolle === 'gf';
  const mitarbeiter = ma.daten?.mitarbeiter ?? [];
  const beendet = a.status === 'abgeschlossen' || a.status === 'abgebrochen';
  // Automatische Mitarbeiter brauchen kein Kopieren → Paket und Einfügen ausblenden
  const automatisch = !!mitarbeiter.find((m) => m.id === a.zustaendig_id)?.automatik;
  const st = AUFGABEN_STATUS[a.status];

  async function aktion(fn: () => Promise<unknown>, erfolg: string) {
    setLaeuft(true);
    try {
      await fn();
      toast(erfolg);
      await neuLaden();
    } catch (e) {
      toast(meldung(e));
      await neuLaden();
    } finally {
      setLaeuft(false);
    }
  }

  const status = (nach: AufgabenStatus, extra: Record<string, unknown> = {}) =>
    aktion(() => api.patch(`/aufgaben/${id}`, { version: a.version, status: nach, ...extra }), `Status: ${AUFGABEN_STATUS[nach].text}`);

  return (
    <div class="raster" style={{ '--akzent': a.projekt_farbe }}>
      {/* Kopf */}
      <div class="sp-12">
        <Karte akzent={a.projekt_farbe}>
          <div class="detail-kopf">
            <a class="btn btn-text btn-sm" href="/aufgaben" style={{ marginLeft: -10 }}><ArrowLeft size={16} aria-hidden="true" /> Aufgaben</a>
            <span class="zeitstempel" style={{ marginLeft: 'auto' }}>angelegt {datum(a.erstellt_am)} · aktualisiert {relativeZeit(a.aktualisiert_am)}</span>
            <h2>
              <span class="zeitstempel" style={{ fontSize: '0.6em', marginRight: 8 }}>{a.id}</span>
              {a.titel}
            </h2>
            <Pill ton={st.ton}>{st.text}</Pill>
            <Pill ton={PRIORITAET[a.prioritaet].ton}>Priorität {PRIORITAET[a.prioritaet].text}</Pill>
            <Pill ton={PRUEFSTATUS[a.pruefstatus].ton}>{PRUEFSTATUS[a.pruefstatus].text}</Pill>
            <a class="pill" href={`/projekte/${a.projekt_slug}`} style={{ textDecoration: 'none' }}>
              <span class="projekt-punkt" style={{ background: a.projekt_farbe }} />{a.projekt_name}
            </a>
            <span class="pill">{a.zustaendig_rolle ? `${a.zustaendig_rolle} · ${a.zustaendig_name}` : 'Nicht zugewiesen'}</span>
          </div>

          {a.status === 'wartend' && a.zustaendig_status === 'wartend_limit' && a.zustaendig_limit_bis && (
            <div class="hinweis warn" style={{ marginTop: 14 }}>
              <Hourglass size={18} aria-hidden="true" />
              <p>
                <b>Limit-Pause.</b> {a.zustaendig_name} ist voraussichtlich {Date.parse(a.zustaendig_limit_bis) <= Date.now() ? 'wieder verfügbar' : `wieder verfügbar ${relativeZeit(a.zustaendig_limit_bis)}`}.
                Fortsetzen erzeugt ein kurzes Paket ab dem letzten Zwischenstand.
              </p>
            </div>
          )}
          {a.status === 'freigabe_erforderlich' && (
            <div class="hinweis" style={{ marginTop: 14 }}>
              <ShieldCheck size={18} aria-hidden="true" />
              <p><b>Angehalten bis zur Freigabe.</b> Entscheiden Sie im Bereich <a href="/freigaben">Freigaben</a> – erteilt läuft die Aufgabe weiter, abgelehnt wird sie blockiert.</p>
            </div>
          )}

          {gf && (
            <div class="aktionsleiste" style={{ marginTop: 16 }}>
              {a.status === 'pruefung' && (
                <button class="btn btn-primary btn-sm" disabled={laeuft} onClick={() => status('abgeschlossen', { pruefstatus: 'bestanden' })}>
                  <CheckCircle2 size={16} aria-hidden="true" /> Prüfung bestanden & abschließen
                </button>
              )}
              {a.status === 'wartend' && (
                <button class="btn btn-primary btn-sm" disabled={laeuft} onClick={() => aktion(() => api.post(`/aufgaben/${id}/fortsetzen`), 'Fortgesetzt – Fortsetzungspaket bereit')}>
                  <Play size={16} aria-hidden="true" /> Fortsetzen
                </button>
              )}
              {(a.status === 'zugewiesen' || a.status === 'neu' || a.status === 'geplant' || a.status === 'blockiert') && (
                <button class="btn btn-primary btn-sm" disabled={laeuft} onClick={() => status('in_bearbeitung')}>
                  <Play size={16} aria-hidden="true" /> Starten
                </button>
              )}
              {!beendet && a.zustaendig_id && a.status !== 'wartend' && a.status !== 'freigabe_erforderlich' && (
                <button class="btn btn-ghost btn-sm" disabled={laeuft} onClick={() => setDialog('limit')}>
                  <Hourglass size={16} aria-hidden="true" /> Limit erreicht
                </button>
              )}
              {!beendet && (
                <button class="btn btn-ghost btn-sm" disabled={laeuft} onClick={() => setDialog('freigabe')}>
                  <ShieldCheck size={16} aria-hidden="true" /> Freigabe beantragen
                </button>
              )}
              <button class="btn btn-ghost btn-sm" disabled={laeuft} onClick={() => setDialog('bearbeiten')}>
                <Pencil size={16} aria-hidden="true" /> Bearbeiten
              </button>
              <select
                class="eingabe"
                style={{ width: 'auto', minHeight: 36, padding: '6px 10px', fontSize: 13.5 }}
                value=""
                disabled={laeuft || UEBERGAENGE[a.status].length === 0}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value as AufgabenStatus;
                  if (v) void status(v, v === 'abgeschlossen' && a.pruefstatus === 'offen' ? { pruefstatus: 'nicht_noetig' } : {});
                }}
                aria-label="Status ändern"
              >
                <option value="">Status ändern …</option>
                {UEBERGAENGE[a.status].map((s) => (
                  <option value={s} key={s}>{AUFGABEN_STATUS[s].text}</option>
                ))}
              </select>
            </div>
          )}
        </Karte>
      </div>

      {/* Links: Paket + Ergebnis */}
      <div class="sp-7" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        {!beendet && <AutomatikKarte id={id} gf={gf} status={a.status} />}
        {!beendet && !automatisch && <PaketKarte id={id} fortsetzung={a.status === 'wartend' || daten.checkpoints.some((c) => c.grund === 'limit')} version={a.version} />}
        {gf && !beendet && !automatisch && <ErgebnisEinfuegen id={id} fertig={neuLaden} />}
        <Karte titel="Ergebnis" kicker="Aktueller Stand">
          {a.ergebnis ? <p class="textblock">{a.ergebnis}</p> : <p class="textblock leer">Noch kein Ergebnis zurückgeführt.</p>}
          {gf && a.ergebnis && (
            <button
              class="btn btn-ghost btn-sm"
              style={{ marginTop: 12 }}
              disabled={laeuft}
              onClick={() =>
                aktion(async () => {
                  const r = await api.post<{ id: number }>(`/wissen/aus-aufgabe/${id}`, {});
                  navigiere(`/wissen/${r.id}`);
                }, 'Als Wissen gespeichert')
              }
            >
              <BookOpen size={15} aria-hidden="true" /> Als Wissen speichern
            </button>
          )}
        </Karte>
        <Verlauf daten={daten} mitarbeiter={mitarbeiter} gf={gf} neuLaden={neuLaden} />
      </div>

      {/* Rechts: Auftrag, Zwischenstände, Abhängigkeiten, Freigaben */}
      <div class="sp-5" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Karte titel="Auftrag & Übergabe" kicker="Pflichtenheft 6.3">
          {a.beschreibung ? <p class="textblock" style={{ marginBottom: 14 }}>{a.beschreibung}</p> : null}
          <dl class="daten" style={{ gridTemplateColumns: '1fr' }}>
            {UEBERGABE_TEXTE.filter(([k]) => daten.uebergabe?.[k]).map(([k, t]) => (
              <Fragment key={k}>
                <dt>{t}</dt>
                <dd class="textblock" style={{ marginBottom: 6 }}>{daten.uebergabe![k]}</dd>
              </Fragment>
            ))}
          </dl>
          {!UEBERGABE_TEXTE.some(([k]) => daten.uebergabe?.[k]) && !a.beschreibung && <p class="textblock leer">Keine Übergabedetails hinterlegt.</p>}
        </Karte>

        {(a.zustaendig_id === 'technik' || a.branch || daten.pull_requests.length > 0 || daten.sperren.length > 0) && <EntwicklungKarte daten={daten} />}
        <Zwischenstaende daten={daten} gf={gf} id={id} neuLaden={neuLaden} />
        <Abhaengigkeiten daten={daten} gf={gf} id={id} neuLaden={neuLaden} />

        <Karte titel="Freigaben & Entscheidungen" kicker="Stufe 2–3">
          {daten.freigaben.length === 0 && daten.entscheidungen.length === 0 ? (
            <p class="textblock leer">Keine.</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {daten.freigaben.map((f) => (
                <a key={f.id} href="/freigaben" class={`freigabe ${f.dringend ? 'dringend' : ''} ${f.status !== 'offen' ? 'entschieden' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div class="reihe" style={{ gap: 6 }}>
                    <b style={{ color: 'var(--ink)', fontSize: 14 }}>{f.id}</b>
                    <Pill ton={f.status === 'offen' ? 'gold' : f.status === 'erteilt' ? 'ok' : f.status === 'abgelehnt' ? 'krit' : ''}>{f.status}</Pill>
                    <span class="zeitstempel">{FREIGABE_TYP[f.typ] ?? f.typ}</span>
                  </div>
                  <span style={{ fontSize: 14 }}>{f.titel}</span>
                </a>
              ))}
              {daten.entscheidungen.map((e) => (
                <div key={e.id} class="zeitstempel">
                  <b style={{ color: 'var(--ink-2)' }}>{e.id}</b> Stufe {e.stufe}: {e.titel} · {relativeZeit(e.zeit)}
                </div>
              ))}
            </div>
          )}
        </Karte>
      </div>

      {dialog === 'limit' && <LimitDialog id={id} wer={a.zustaendig_name ?? ''} schliessen={() => setDialog(null)} fertig={neuLaden} />}
      {dialog === 'freigabe' && <FreigabeDialog id={id} schliessen={() => setDialog(null)} fertig={neuLaden} />}
      {dialog === 'bearbeiten' && <BearbeitenDialog daten={daten} mitarbeiter={mitarbeiter} schliessen={() => setDialog(null)} fertig={neuLaden} />}
    </div>
  );
}

// ------------------------------------------------------------------ Übergabepaket

function PaketKarte({ id, fortsetzung, version }: { id: string; fortsetzung: boolean; version: number }) {
  const [modus, setModus] = useState<'voll' | 'fortsetzung'>(fortsetzung ? 'fortsetzung' : 'voll');
  const [paket, setPaket] = useState<Paket | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => setModus(fortsetzung ? 'fortsetzung' : 'voll'), [fortsetzung]);
  useEffect(() => {
    setPaket(null);
    api.get<Paket>(`/aufgaben/${id}/paket?modus=${modus}`).then(setPaket, (e) => setFehler(meldung(e)));
  }, [id, modus, version]);

  async function kopieren() {
    if (!paket) return;
    if (paket.warnungen.length && !confirm(`Bitte prüfen:\n\n• ${paket.warnungen.join('\n• ')}\n\nTrotzdem kopieren?`)) return;
    try {
      await navigator.clipboard.writeText(paket.text);
      toast('Paket kopiert – jetzt im KI-Tool einfügen');
    } catch {
      toast('Kopieren nicht erlaubt – bitte Text markieren');
    }
  }

  async function teilen() {
    if (!paket) return;
    if (paket.warnungen.length && !confirm(`Bitte prüfen:\n\n• ${paket.warnungen.join('\n• ')}\n\nTrotzdem teilen?`)) return;
    try {
      await navigator.share({ title: `Auftrag ${id}`, text: paket.text });
    } catch {
      /* abgebrochen */
    }
  }

  return (
    <Karte titel="Übergabepaket" kicker="Für ChatGPT, Gemini, Grok oder Claude">
      <div class="reiter" role="group" aria-label="Paketart" style={{ marginBottom: 12 }}>
        <button aria-pressed={modus === 'voll'} onClick={() => setModus('voll')}>Vollständig</button>
        <button aria-pressed={modus === 'fortsetzung'} onClick={() => setModus('fortsetzung')}>Fortsetzung (kurz)</button>
      </div>
      {fehler && <p class="feld-fehler">{fehler}</p>}
      {!paket ? (
        <Ladebalken />
      ) : (
        <>
          <pre class="paket" tabIndex={0} aria-label="Paketinhalt">{paket.text}</pre>
          {paket.warnungen.map((w) => (
            <p class="hinweis warn" key={w} style={{ marginTop: 8 }}>
              <AlertTriangle size={16} aria-hidden="true" />
              <span style={{ fontSize: 13.5 }}>{w}</span>
            </p>
          ))}
          <div class="paket-fuss">
            <button class="btn btn-primary btn-sm" onClick={kopieren}>
              <ClipboardCopy size={16} aria-hidden="true" /> Kopieren
            </button>
            {'share' in navigator && (
              <button class="btn btn-ghost btn-sm" onClick={teilen}>
                <Share2 size={16} aria-hidden="true" /> Teilen
              </button>
            )}
            <span class="zeichen">{paket.zeichen.toLocaleString('de-DE')} Zeichen (Schätzung, keine Tokenzahl)</span>
          </div>
        </>
      )}
    </Karte>
  );
}

// ------------------------------------------------------------------ Ergebnis einfügen

function ErgebnisEinfuegen({ id, fertig }: { id: string; fertig: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  async function einfuegenAusZwischenablage() {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      toast('Zwischenablage nicht lesbar – bitte manuell einfügen');
    }
  }

  async function uebernehmen() {
    setLaeuft(true);
    try {
      const r = await api.post<{ status: string; erkannt: { strukturiert: boolean; zwischenstand: boolean; rueckfragen: boolean; freigabe: string | null } }>(
        `/aufgaben/${id}/ergebnis`,
        { text },
      );
      const teile = [
        r.erkannt.strukturiert ? 'Abschnitte erkannt' : 'als Ergebnis übernommen',
        r.erkannt.zwischenstand && 'Zwischenstand gespeichert',
        r.erkannt.rueckfragen && 'Rückfrage erfasst',
        r.erkannt.freigabe && `Freigabe ${r.erkannt.freigabe} beantragt`,
      ].filter(Boolean);
      toast(teile.join(' · '));
      setText('');
      await fertig();
    } catch (e) {
      toast(meldung(e));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Karte titel="Antwort zurückführen" kicker="Ergebnis aus dem KI-Tool">
      <p class="zeitstempel" style={{ margin: '0 0 10px' }}>
        Antwort kopieren und hier einfügen. ERGEBNIS, OFFENE FRAGEN, FREIGABEANTRÄGE und ZWISCHENSTAND werden automatisch zugeordnet.
      </p>
      <textarea class="eingabe" rows={6} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="Antwort hier einfügen …" aria-label="Antwort" />
      <div class="reihe" style={{ marginTop: 10 }}>
        <button class="btn btn-primary btn-sm" disabled={laeuft || !text.trim()} onClick={uebernehmen}>
          <Save size={16} aria-hidden="true" /> Übernehmen
        </button>
        {'clipboard' in navigator && 'readText' in navigator.clipboard && (
          <button class="btn btn-ghost btn-sm" onClick={einfuegenAusZwischenablage}>
            <ClipboardPaste size={16} aria-hidden="true" /> Aus Zwischenablage
          </button>
        )}
      </div>
    </Karte>
  );
}

// ------------------------------------------------------------------ Verlauf (Nachrichten)

function Verlauf({ daten, mitarbeiter, gf, neuLaden }: { daten: AufgabeDetailDaten; mitarbeiter: Mitarbeiter[]; gf: boolean; neuLaden: () => Promise<void> }) {
  const a = daten.aufgabe;
  const [inhalt, setInhalt] = useState('');
  const [art, setArt] = useState<NachrichtenArt>('information');
  const [von, setVon] = useState('gf');
  const [laeuft, setLaeuft] = useState(false);
  const feld = useRef<HTMLTextAreaElement>(null);

  async function senden() {
    setLaeuft(true);
    try {
      await api.post('/nachrichten', { art, von, an: von === 'gf' ? a.zustaendig_id : 'gf', aufgabe_id: a.id, inhalt });
      setInhalt('');
      toast('Nachricht gespeichert');
      await neuLaden();
    } catch (e) {
      toast(meldung(e));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Karte titel="Verlauf" kicker="Kommunikation zu dieser Aufgabe">
      {daten.nachrichten.length === 0 ? (
        <p class="textblock leer">Noch keine Nachrichten.</p>
      ) : (
        <ul class="verlauf">
          {daten.nachrichten.map((n) => (
            <li key={n.id} class={`nachricht ${n.von === 'gf' ? 'von-gf' : ''}`}>
              <div class="nachricht-kopf">
                <b>{teilnehmerName(n.von, mitarbeiter)}</b>→ {teilnehmerName(n.an, mitarbeiter)}
                <Pill ton={NACHRICHTEN_ART[n.art].ton}>{NACHRICHTEN_ART[n.art].text}</Pill>
                <span style={{ marginLeft: 'auto' }}>{relativeZeit(n.zeit)}</span>
              </div>
              <Aufklappbar text={n.inhalt} />
            </li>
          ))}
        </ul>
      )}
      {gf && (
        <details class="aufklapp" style={{ marginTop: 14 }}>
          <summary>Nachricht erfassen (z. B. Antwort auf Rückfrage)</summary>
          <div style={{ display: 'grid', gap: 10 }}>
            <div class="formular-raster">
              <label class="feld">
                <span>Von</span>
                <select class="eingabe" value={von} onChange={(e) => setVon((e.target as HTMLSelectElement).value)}>
                  <option value="gf">Geschäftsführung</option>
                  {mitarbeiter.map((m) => <option value={m.id} key={m.id}>{m.rolle}</option>)}
                </select>
              </label>
              <label class="feld">
                <span>Art</span>
                <select class="eingabe" value={art} onChange={(e) => setArt((e.target as HTMLSelectElement).value as NachrichtenArt)}>
                  {Object.entries(NACHRICHTEN_ART).map(([k, v]) => <option value={k} key={k}>{v.text}</option>)}
                </select>
              </label>
            </div>
            <textarea ref={feld} class="eingabe" rows={3} value={inhalt} onInput={(e) => setInhalt((e.target as HTMLTextAreaElement).value)} aria-label="Nachricht" placeholder="Antworten der Geschäftsführung fließen ins nächste Übergabepaket ein." />
            <div>
              <button class="btn btn-primary btn-sm" disabled={laeuft || !inhalt.trim()} onClick={senden}>
                <Send size={16} aria-hidden="true" /> Speichern
              </button>
              <span style={{ marginLeft: 8 }}><Diktat ziel={() => feld.current} /></span>
            </div>
          </div>
        </details>
      )}
    </Karte>
  );
}

export function Aufklappbar({ text }: { text: string }) {
  const lang = text.length > 600 || text.split('\n').length > 8;
  const [offen, setOffen] = useState(false);
  return (
    <>
      <div class={`nachricht-text ${lang && !offen ? 'gekuerzt' : ''}`}>{text}</div>
      {lang && (
        <button class="btn btn-text btn-sm" style={{ marginTop: 4, paddingLeft: 0 }} onClick={() => setOffen(!offen)}>
          {offen ? 'Weniger anzeigen' : 'Ganz anzeigen'}
        </button>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Zwischenstände

function Zwischenstaende({ daten, gf, id, neuLaden }: { daten: AufgabeDetailDaten; gf: boolean; id: string; neuLaden: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  async function speichern() {
    setLaeuft(true);
    try {
      await api.post(`/aufgaben/${id}/checkpoint`, { zusammenfassung: text });
      setText('');
      toast('Zwischenstand gespeichert');
      await neuLaden();
    } catch (e) {
      toast(meldung(e));
    } finally {
      setLaeuft(false);
    }
  }
  const GRUND: Record<string, string> = { zwischenstand: 'Zwischenstand', limit: 'Limit-Pause', abschluss: 'Abschluss', uebergabe: 'Übergabe' };
  return (
    <Karte titel="Zwischenstände" kicker="Checkpoints">
      {daten.checkpoints.length === 0 ? (
        <p class="textblock leer">Noch keiner. Wird aus dem Abschnitt ZWISCHENSTAND einer Antwort automatisch übernommen.</p>
      ) : (
        <ul class="zeitleiste">
          {daten.checkpoints.map((c) => (
            <li key={c.id}>
              <span class="punkt" aria-hidden="true" style={c.grund === 'limit' ? { borderColor: 'var(--warn)' } : undefined} />
              <div class="text">
                <Pill ton={c.grund === 'limit' ? 'warn' : ''}>{GRUND[c.grund]}</Pill> <span class="zeitstempel">{relativeZeit(c.zeit)}</span>
                <p class="textblock" style={{ marginTop: 4, fontSize: 13.5 }}>{c.zusammenfassung}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {gf && (
        <details class="aufklapp" style={{ marginTop: 10 }}>
          <summary>Zwischenstand von Hand speichern</summary>
          <div style={{ display: 'grid', gap: 8 }}>
            <textarea class="eingabe" rows={3} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} aria-label="Zwischenstand" />
            <div><button class="btn btn-ghost btn-sm" disabled={laeuft || text.trim().length < 3} onClick={speichern}>Speichern</button></div>
          </div>
        </details>
      )}
    </Karte>
  );
}

// ------------------------------------------------------------------ Abhängigkeiten

function Abhaengigkeiten({ daten, gf, id, neuLaden }: { daten: AufgabeDetailDaten; gf: boolean; id: string; neuLaden: () => Promise<void> }) {
  const [neu, setNeu] = useState('');
  async function hinzufuegen() {
    const ziel = neu.trim().toUpperCase().replace(/^(\d+)$/, (m) => `TD-${m.padStart(4, '0')}`);
    try {
      await api.post(`/aufgaben/${id}/abhaengigkeiten`, { haengt_ab_von: ziel });
      setNeu('');
      await neuLaden();
    } catch (e) {
      toast(meldung(e));
    }
  }
  async function entfernen(von: string) {
    try {
      await api.delete(`/aufgaben/${id}/abhaengigkeiten/${von}`);
      await neuLaden();
    } catch (e) {
      toast(meldung(e));
    }
  }
  if (!gf && daten.abhaengig_von.length === 0 && daten.blockiert_fuer.length === 0) return null;
  return (
    <Karte titel="Abhängigkeiten" kicker="Reihenfolge">
      {daten.abhaengig_von.length === 0 && daten.blockiert_fuer.length === 0 && <p class="textblock leer">Keine.</p>}
      {daten.abhaengig_von.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          <span class="zeitstempel">Wartet auf:</span>
          {daten.abhaengig_von.map((d) => (
            <div class="reihe" key={d.id} style={{ gap: 6 }}>
              <Link2 size={14} aria-hidden="true" />
              <a href={`/aufgaben/${d.id}`}>{d.id}</a> {d.titel}
              <Pill ton={AUFGABEN_STATUS[d.status].ton}>{AUFGABEN_STATUS[d.status].text}</Pill>
              {gf && (
                <button class="btn btn-text btn-sm" aria-label={`Abhängigkeit ${d.id} entfernen`} onClick={() => entfernen(d.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {daten.blockiert_fuer.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          <span class="zeitstempel">Wird gebraucht von:</span>
          {daten.blockiert_fuer.map((d) => (
            <div class="reihe" key={d.id} style={{ gap: 6 }}>
              <a href={`/aufgaben/${d.id}`}>{d.id}</a> {d.titel}
            </div>
          ))}
        </div>
      )}
      {gf && (
        <div class="reihe">
          <input class="eingabe" style={{ maxWidth: 160, minHeight: 36, padding: '6px 10px' }} placeholder="TD-0001" value={neu} onInput={(e) => setNeu((e.target as HTMLInputElement).value)} aria-label="Aufgabennummer" />
          <button class="btn btn-ghost btn-sm" disabled={!neu.trim()} onClick={hinzufuegen}>Hinzufügen</button>
        </div>
      )}
    </Karte>
  );
}

// ------------------------------------------------------------------ Dialoge

function LimitDialog({ id, wer, schliessen, fertig }: { id: string; wer: string; schliessen: () => void; fertig: () => Promise<void> }) {
  const [bis, setBis] = useState(zuLokalFeld(new Date(Date.now() + 3 * 3_600_000).toISOString()));
  const [notiz, setNotiz] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  async function speichern() {
    try {
      await api.post(`/aufgaben/${id}/limit`, { bis: new Date(bis).toISOString(), notiz });
      toast(`Pausiert – Erinnerung ab ${new Date(bis).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`);
      schliessen();
      await fertig();
    } catch (e) {
      setFehler(meldung(e));
    }
  }
  return (
    <Dialog titel="Nutzungslimit erreicht" schliessen={schliessen}>
      <p class="anm-text" style={{ margin: 0 }}>
        Die Aufgabe wird sicher pausiert, {wer || 'der Mitarbeiter'} als „Limit – Pause“ markiert. Den Zeitpunkt nennt das KI-Tool meist in seiner Meldung.
      </p>
      <label class="feld">
        <span>Wieder verfügbar ab</span>
        <input class="eingabe" type="datetime-local" value={bis} onInput={(e) => setBis((e.target as HTMLInputElement).value)} />
      </label>
      <label class="feld">
        <span>Letzter Arbeitsstand (optional)</span>
        <textarea class="eingabe" rows={3} value={notiz} onInput={(e) => setNotiz((e.target as HTMLTextAreaElement).value)} placeholder="z. B. Abschnitt 2 von 3 fertig, Bilder fehlen noch." />
      </label>
      {fehler && <p class="feld-fehler">{fehler}</p>}
      <div class="reihe">
        <button class="btn btn-primary" onClick={speichern}><Hourglass size={17} aria-hidden="true" /> Pausieren</button>
        <button class="btn btn-ghost" onClick={schliessen}>Abbrechen</button>
      </div>
    </Dialog>
  );
}

export function FreigabeDialog({ id, schliessen, fertig }: { id?: string; schliessen: () => void; fertig: () => Promise<void> | void }) {
  const [fehler, setFehler] = useState<string | null>(null);
  async function absenden(e: Event) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    try {
      await api.post('/freigaben', {
        typ: String(f.get('typ')),
        titel: String(f.get('titel') ?? '').trim(),
        begruendung: String(f.get('begruendung') ?? '').trim(),
        aufgabe_id: id ?? null,
        dringend: f.get('dringend') === 'on',
      });
      toast('Freigabe beantragt');
      schliessen();
      await fertig();
    } catch (err) {
      setFehler(meldung(err));
    }
  }
  return (
    <Dialog titel="Freigabe beantragen (Stufe 3)" schliessen={schliessen}>
      <form onSubmit={absenden} style={{ display: 'grid', gap: 12 }}>
        <label class="feld">
          <span>Art</span>
          <select class="eingabe" name="typ" required>
            {Object.entries(FREIGABE_TYP).map(([k, v]) => <option value={k} key={k}>{v}</option>)}
          </select>
        </label>
        <label class="feld">
          <span>Was soll freigegeben werden?</span>
          <input class="eingabe" name="titel" required minLength={3} maxLength={160} />
        </label>
        <label class="feld">
          <span>Begründung, Kosten, Risiken</span>
          <textarea class="eingabe" name="begruendung" rows={4} maxLength={8000} />
        </label>
        <label class="reihe" style={{ fontSize: 14 }}><input type="checkbox" name="dringend" /> Dringend</label>
        {id && <p class="zeitstempel" style={{ margin: 0 }}>Die Aufgabe {id} wird bis zur Entscheidung angehalten.</p>}
        {fehler && <p class="feld-fehler">{fehler}</p>}
        <div class="reihe">
          <button class="btn btn-primary"><ShieldCheck size={17} aria-hidden="true" /> Beantragen</button>
          <button type="button" class="btn btn-ghost" onClick={schliessen}>Abbrechen</button>
        </div>
      </form>
    </Dialog>
  );
}

function BearbeitenDialog({ daten, mitarbeiter, schliessen, fertig }: { daten: AufgabeDetailDaten; mitarbeiter: Mitarbeiter[]; schliessen: () => void; fertig: () => Promise<void> }) {
  const a = daten.aufgabe;
  const u = daten.uebergabe;
  const [fehler, setFehler] = useState<string | null>(null);
  async function speichern(e: Event) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const t = (k: string) => String(f.get(k) ?? '').trim();
    try {
      await api.patch(`/aufgaben/${a.id}`, {
        version: a.version,
        titel: t('titel'),
        beschreibung: t('beschreibung'),
        prioritaet: t('prioritaet'),
        zustaendig_id: t('zustaendig_id') || null,
        uebergabe: Object.fromEntries(UEBERGABE_TEXTE.map(([k]) => [k, t(k)])),
      });
      toast('Gespeichert');
      schliessen();
      await fertig();
    } catch (err) {
      setFehler(meldung(err));
    }
  }
  return (
    <Dialog titel={`${a.id} bearbeiten`} schliessen={schliessen}>
      <form onSubmit={speichern} style={{ display: 'grid', gap: 12 }}>
        <label class="feld"><span>Titel</span><input class="eingabe" name="titel" defaultValue={a.titel} required minLength={3} maxLength={160} /></label>
        <label class="feld"><span>Beschreibung</span><textarea class="eingabe" name="beschreibung" rows={4} defaultValue={a.beschreibung} /></label>
        <div class="formular-raster">
          <label class="feld">
            <span>Priorität</span>
            <Auswahl class="eingabe" name="prioritaet" defaultValue={a.prioritaet}>
              {Object.entries(PRIORITAET).map(([k, v]) => <option value={k} key={k}>{v.text}</option>)}
            </Auswahl>
          </label>
          <label class="feld">
            <span>Zuständig</span>
            <Auswahl class="eingabe" name="zustaendig_id" defaultValue={a.zustaendig_id ?? ''}>
              <option value="">Nicht zugewiesen</option>
              {mitarbeiter.map((m) => <option value={m.id} key={m.id}>{m.rolle}</option>)}
            </Auswahl>
          </label>
        </div>
        {UEBERGABE_TEXTE.map(([k, t]) => (
          <label class="feld" key={k}><span>{t}</span><textarea class="eingabe" name={k} rows={2} defaultValue={u?.[k] ?? ''} style={{ minHeight: 60 }} /></label>
        ))}
        {fehler && <p class="feld-fehler">{fehler}</p>}
        <div class="reihe">
          <button class="btn btn-primary"><Save size={17} aria-hidden="true" /> Speichern</button>
          <button type="button" class="btn btn-ghost" onClick={schliessen}>Abbrechen</button>
        </div>
      </form>
    </Dialog>
  );
}


// ------------------------------------------------------------------ Entwicklung: Claude-Code-Übergabe, PRs, Sperren

export function EntwicklungKarte({ daten }: { daten: AufgabeDetailDaten }) {
  const a = daten.aufgabe;
  const branch = a.branch ?? branchVorschlag(a.id, a.titel);
  const auftrag =
    `Bearbeite die Aufgabe ${a.id} aus der TE-Digital Zentrale. Lies sie mit dem MCP-Werkzeug aufgabe_lesen, ` +
    `starte sie mit aufgabe_starten, arbeite im Branch ${branch} (branch_melden), sperre konfliktträchtige Dateien mit sperre_setzen, ` +
    `speichere Zwischenstände und melde am Ende mit ergebnis_melden. Kein Merge in main ohne Freigabe.`;
  const kopieren = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast('Kopiert');
    } catch {
      toast('Kopieren nicht erlaubt');
    }
  };
  const beendet = a.status === 'abgeschlossen' || a.status === 'abgebrochen';
  return (
    <Karte titel="Entwicklung" kicker="Claude Code · GitHub">
      <div style={{ display: 'grid', gap: 12 }}>
        <dl class="daten" style={{ gridTemplateColumns: '90px 1fr' }}>
          <dt>Branch</dt>
          <dd>
            <code style={{ wordBreak: 'break-all' }}>{branch}</code> {!a.branch && <span class="zeitstempel">(Vorschlag)</span>}
          </dd>
          {a.pr_url && (
            <>
              <dt>PR</dt>
              <dd><a href={a.pr_url} target="_blank" rel="noopener noreferrer">{a.pr_url.replace('https://github.com/', '')}</a></dd>
            </>
          )}
        </dl>
        {daten.pull_requests.map((p) => (
          <a key={`${p.repo}#${p.nummer}`} class="hinweis" href={p.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
            <GitPullRequest size={16} aria-hidden="true" />
            <p style={{ flex: 1, minWidth: 0 }}>
              <b>{p.repo.split('/')[1]} #{p.nummer}</b> {p.titel}
            </p>
            <Pill ton={PR_ZUSTAND[p.zustand].ton}>{PR_ZUSTAND[p.zustand].text}</Pill>
            {(p.zustand === 'offen' || p.zustand === 'entwurf') && <Pill ton={CHECKS[p.checks].ton}>{CHECKS[p.checks].text}</Pill>}
          </a>
        ))}
        {daten.sperren.map((s) => (
          <div key={s.id} class="zeitstempel reihe" style={{ gap: 5 }}>
            <Lock size={13} aria-hidden="true" /> {s.repo}: <code>{s.pfade.join(', ')}</code>
          </div>
        ))}
        {!beendet && a.zustaendig_id === 'technik' && (
          <details class="aufklapp">
            <summary>Auftrag an Claude Code übergeben</summary>
            <div style={{ display: 'grid', gap: 8 }}>
              <p class="zeitstempel" style={{ margin: 0 }}>
                In Claude Code (lokal im Projektordner oder als Cloud-Sitzung im Repository) diesen Auftrag einfügen. Voraussetzung: ein KI-Zugang unter Einstellungen.
              </p>
              <pre class="paket" style={{ maxHeight: 160 }}>{auftrag}</pre>
              <div class="reihe">
                <button class="btn btn-primary btn-sm" onClick={() => kopieren(auftrag)}><ClipboardCopy size={15} aria-hidden="true" /> Auftrag kopieren</button>
                <button class="btn btn-ghost btn-sm" onClick={() => kopieren(branch)}><GitBranch size={15} aria-hidden="true" /> Branch kopieren</button>
              </div>
            </div>
          </details>
        )}
      </div>
    </Karte>
  );
}
