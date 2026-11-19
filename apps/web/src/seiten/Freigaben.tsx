import { useState } from 'preact/hooks';
import { AlertTriangle, Check, FileSignature, Plus, ShieldCheck, Undo2, X } from 'lucide-preact';
import { Karte, Ladebalken, Leer, Pill } from '../komponenten/Bausteine';
import { Dialog } from '../komponenten/Dialog';
import { toast } from '../komponenten/Toast';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { relativeZeit } from '../lib/format';
import { useKopf } from '../lib/kopf';
import { mitBestaetigung } from '../lib/stepup';
import { FREIGABE_TYP, teilnehmerName } from '../lib/texte';
import type { Benutzer, Entscheidung, FreigabeVoll, Mitarbeiter, Projekt } from '../lib/typen';
import { Auswahl } from '../komponenten/Auswahl';
import { Aufklappbar, FreigabeDialog } from './AufgabeDetail';

const STATUS_TON = { offen: 'gold', erteilt: 'ok', abgelehnt: 'krit', zurueckgezogen: '' } as const;
const STATUS_TEXT = { offen: 'Offen', erteilt: 'Erteilt', abgelehnt: 'Abgelehnt', zurueckgezogen: 'Zurückgezogen' } as const;

export function Freigaben({ benutzer, geaendert }: { benutzer: Benutzer; geaendert: () => void }) {
  useKopf('Entscheidungen & Freigaben', 'Stufe 3 · Geschäftsführung');
  const [reiter, setReiter] = useState<'offen' | 'entschieden' | 'protokoll'>('offen');
  const [dialog, setDialog] = useState<null | 'freigabe' | 'entscheidung'>(null);
  const fg = useDaten<{ freigaben: FreigabeVoll[] }>('/freigaben');
  const en = useDaten<{ entscheidungen: Entscheidung[] }>('/entscheidungen');
  const ma = useDaten<{ mitarbeiter: Mitarbeiter[] }>('/mitarbeiter', 0);
  const mitarbeiter = ma.daten?.mitarbeiter ?? [];
  const gf = benutzer.rolle === 'gf';
  const [laeuft, setLaeuft] = useState<string | null>(null);

  async function neuLaden() {
    await Promise.all([fg.neuLaden(), en.neuLaden()]);
    geaendert();
  }

  async function entscheiden(f: FreigabeVoll, entscheidung: 'erteilt' | 'abgelehnt') {
    let kommentar = '';
    if (entscheidung === 'abgelehnt') {
      const k = prompt('Begründung der Ablehnung (optional):');
      if (k === null) return;
      kommentar = k;
    }
    setLaeuft(f.id);
    try {
      await mitBestaetigung(() => api.post(`/freigaben/${f.id}/entscheiden`, { entscheidung, kommentar }));
      toast(entscheidung === 'erteilt' ? `${f.id} freigegeben` : `${f.id} abgelehnt`);
      await neuLaden();
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Bestätigung abgebrochen');
    } finally {
      setLaeuft(null);
    }
  }

  async function zurueckziehen(f: FreigabeVoll) {
    if (!confirm(`Freigabeantrag ${f.id} zurückziehen?`)) return;
    try {
      await api.post(`/freigaben/${f.id}/zurueckziehen`);
      await neuLaden();
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Fehler');
    }
  }

  const offen = (fg.daten?.freigaben ?? []).filter((f) => f.status === 'offen');
  const entschieden = (fg.daten?.freigaben ?? []).filter((f) => f.status !== 'offen');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div class="reihe" style={{ justifyContent: 'space-between' }}>
        <div class="reiter" role="group" aria-label="Ansicht" style={{ flex: 1, minWidth: 0 }}>
          <button aria-pressed={reiter === 'offen'} onClick={() => setReiter('offen')}>Offen <span class="zahl-klein">{offen.length}</span></button>
          <button aria-pressed={reiter === 'entschieden'} onClick={() => setReiter('entschieden')}>Entschieden</button>
          <button aria-pressed={reiter === 'protokoll'} onClick={() => setReiter('protokoll')}>Entscheidungsprotokoll</button>
        </div>
        {gf && (
          <div class="reihe">
            <button class="btn btn-ghost btn-sm" onClick={() => setDialog('entscheidung')}><FileSignature size={16} aria-hidden="true" /> Entscheidung dokumentieren</button>
            <button class="btn btn-gold btn-sm" onClick={() => setDialog('freigabe')}><Plus size={16} aria-hidden="true" /> Freigabe beantragen</button>
          </div>
        )}
      </div>

      {fg.fehler && <p class="hinweis krit"><AlertTriangle size={18} />{fg.fehler.message}</p>}

      {reiter !== 'protokoll' && (
        !fg.daten ? <Ladebalken /> : (reiter === 'offen' ? offen : entschieden).length === 0 ? (
          <Karte>
            <Leer Icon={ShieldCheck} titel={reiter === 'offen' ? 'Keine offenen Freigaben' : 'Noch nichts entschieden'} text="Kosten, Veröffentlichungen, Produktivsetzungen, Löschungen, Sicherheits- und Vertragsfragen landen hier zur Entscheidung." />
          </Karte>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {(reiter === 'offen' ? offen : entschieden).map((f) => (
              <article key={f.id} class={`freigabe ${f.dringend ? 'dringend' : ''} ${f.status !== 'offen' ? 'entschieden' : ''}`}>
                <div class="reihe" style={{ gap: 6 }}>
                  <b style={{ color: 'var(--ink)' }}>{f.id}</b>
                  <Pill ton={STATUS_TON[f.status]}>{STATUS_TEXT[f.status]}</Pill>
                  <Pill>{FREIGABE_TYP[f.typ] ?? f.typ}</Pill>
                  {f.dringend ? <Pill ton="krit">Dringend</Pill> : null}
                  {f.projekt_name && (
                    <span class="pill"><span class="projekt-punkt" style={{ background: f.projekt_farbe ?? 'var(--gold)' }} />{f.projekt_name}</span>
                  )}
                  <span class="zeitstempel" style={{ marginLeft: 'auto' }}>
                    {f.status === 'offen' ? `beantragt ${relativeZeit(f.angefragt_am)}` : `entschieden ${relativeZeit(f.entschieden_am)}`}
                  </span>
                </div>
                <h3>{f.titel}</h3>
                {f.begruendung && <Aufklappbar text={f.begruendung} />}
                <div class="zeitstempel">
                  Beantragt von {teilnehmerName(f.angefragt_von, mitarbeiter)}
                  {f.aufgabe_id && <> · Aufgabe <a href={`/aufgaben/${f.aufgabe_id}`}>{f.aufgabe_id}</a>{f.aufgabe_titel ? ` ${f.aufgabe_titel}` : ''}</>}
                </div>
                {f.kommentar && <div class="hinweis"><p><b>Kommentar:</b> {f.kommentar}</p></div>}
                {gf && f.status === 'offen' && (
                  <div class="aktionsleiste">
                    <button class="btn btn-primary btn-sm" disabled={laeuft === f.id} onClick={() => entscheiden(f, 'erteilt')}>
                      <Check size={16} aria-hidden="true" /> Freigeben
                    </button>
                    <button class="btn btn-ghost btn-sm" disabled={laeuft === f.id} onClick={() => entscheiden(f, 'abgelehnt')}>
                      <X size={16} aria-hidden="true" /> Ablehnen
                    </button>
                    <button class="btn btn-text btn-sm" onClick={() => zurueckziehen(f)}>
                      <Undo2 size={15} aria-hidden="true" /> Zurückziehen
                    </button>
                    <span class="zeitstempel" style={{ alignSelf: 'center' }}>Freigeben und Ablehnen verlangen Ihren Passkey.</span>
                  </div>
                )}
              </article>
            ))}
          </div>
        )
      )}

      {reiter === 'protokoll' && (
        <Karte titel="Entscheidungsprotokoll" kicker="Unveränderlich">
          {!en.daten ? <Ladebalken /> : en.daten.entscheidungen.length === 0 ? (
            <Leer Icon={FileSignature} titel="Noch keine Entscheidungen" />
          ) : (
            <ul class="zeitleiste">
              {en.daten.entscheidungen.map((e) => (
                <li key={e.id}>
                  <span class="punkt" aria-hidden="true" style={e.stufe === 3 ? { borderColor: 'var(--gold)', background: 'var(--gold)' } : undefined} />
                  <div class="text">
                    <div class="reihe" style={{ gap: 6 }}>
                      <b>{e.id}</b>
                      <Pill ton={e.stufe === 3 ? 'gold' : e.stufe === 2 ? 'info' : ''}>Stufe {e.stufe}</Pill>
                      {e.projekt_name && <span class="zeitstempel">{e.projekt_name}</span>}
                      {e.aufgabe_id && <a class="zeitstempel" href={`/aufgaben/${e.aufgabe_id}`}>{e.aufgabe_id}</a>}
                      <span class="zeitstempel" style={{ marginLeft: 'auto' }}>{relativeZeit(e.zeit)} · {teilnehmerName(e.von, mitarbeiter)}</span>
                    </div>
                    <div style={{ color: 'var(--ink)', fontWeight: 600, marginTop: 2 }}>{e.titel}</div>
                    {e.begruendung && <p class="textblock" style={{ fontSize: 13.5, marginTop: 4 }}>{e.begruendung}</p>}
                    {e.alternativen && <p class="zeitstempel" style={{ marginTop: 4 }}>Alternativen: {e.alternativen}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Karte>
      )}

      {dialog === 'freigabe' && <FreigabeDialog schliessen={() => setDialog(null)} fertig={neuLaden} />}
      {dialog === 'entscheidung' && <EntscheidungDialog mitarbeiter={mitarbeiter} schliessen={() => setDialog(null)} fertig={neuLaden} />}
    </div>
  );
}

function EntscheidungDialog({ mitarbeiter, schliessen, fertig }: { mitarbeiter: Mitarbeiter[]; schliessen: () => void; fertig: () => Promise<void> }) {
  const projekte = useDaten<{ projekte: Projekt[] }>('/projekte', 0);
  const [fehler, setFehler] = useState<string | null>(null);
  async function absenden(e: Event) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const t = (k: string) => String(f.get(k) ?? '').trim();
    const aufgabe = t('aufgabe_id').toUpperCase().replace(/^(\d+)$/, (m) => `TD-${m.padStart(4, '0')}`);
    try {
      await api.post('/entscheidungen', {
        stufe: Number(t('stufe')),
        titel: t('titel'),
        begruendung: t('begruendung'),
        alternativen: t('alternativen'),
        von: t('von'),
        projekt_slug: t('projekt_slug') || null,
        aufgabe_id: aufgabe || null,
      });
      toast('Entscheidung dokumentiert');
      schliessen();
      await fertig();
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : 'Fehler');
    }
  }
  return (
    <Dialog titel="Entscheidung dokumentieren" schliessen={schliessen}>
      <form onSubmit={absenden} style={{ display: 'grid', gap: 12 }}>
        <div class="formular-raster">
          <label class="feld">
            <span>Stufe</span>
            <Auswahl class="eingabe" name="stufe" defaultValue="1">
              <option value="1">1 – selbstständig</option>
              <option value="2">2 – mit Informationspflicht</option>
            </Auswahl>
            <small>Stufe 3 entsteht nur über eine Freigabe.</small>
          </label>
          <label class="feld">
            <span>Entschieden von</span>
            <Auswahl class="eingabe" name="von" defaultValue="gf">
              <option value="gf">Geschäftsführung</option>
              {mitarbeiter.map((m) => <option value={m.id} key={m.id}>{m.rolle}</option>)}
            </Auswahl>
          </label>
        </div>
        <label class="feld"><span>Entscheidung</span><input class="eingabe" name="titel" required minLength={3} maxLength={200} /></label>
        <label class="feld"><span>Begründung</span><textarea class="eingabe" name="begruendung" rows={3} /></label>
        <label class="feld"><span>Verworfene Alternativen</span><textarea class="eingabe" name="alternativen" rows={2} style={{ minHeight: 60 }} /></label>
        <div class="formular-raster">
          <label class="feld">
            <span>Projekt</span>
            <Auswahl class="eingabe" name="projekt_slug" defaultValue="">
              <option value="">–</option>
              {projekte.daten?.projekte.map((p) => <option value={p.slug} key={p.slug}>{p.name}</option>)}
            </Auswahl>
          </label>
          <label class="feld"><span>Aufgabe</span><input class="eingabe" name="aufgabe_id" placeholder="TD-0001" /></label>
        </div>
        {fehler && <p class="feld-fehler">{fehler}</p>}
        <div class="reihe">
          <button class="btn btn-primary"><FileSignature size={17} aria-hidden="true" /> Dokumentieren</button>
          <button type="button" class="btn btn-ghost" onClick={schliessen}>Abbrechen</button>
        </div>
      </form>
    </Dialog>
  );
}
