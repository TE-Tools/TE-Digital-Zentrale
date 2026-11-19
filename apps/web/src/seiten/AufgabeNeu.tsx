import { useRef, useState } from 'preact/hooks';
import { Diktat } from '../komponenten/Diktat';
import { NEUER_AUFTRAG_VORLAGE } from './Teilen';
import { Send } from 'lucide-preact';
import { Karte, Ladebalken } from '../komponenten/Bausteine';
import { toast } from '../komponenten/Toast';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { ZUGANG_TEXT } from '../lib/format';
import { useKopf } from '../lib/kopf';
import { navigiere } from '../lib/router';
import { Auswahl } from '../komponenten/Auswahl';
import type { AufgabeKurz, Mitarbeiter, Projekt } from '../lib/typen';

const UEBERGABE_FELDER: { k: string; text: string; hilfe: string }[] = [
  { k: 'ziel', text: 'Ziel', hilfe: 'Was soll am Ende erreicht sein?' },
  { k: 'ausgangslage', text: 'Ausgangslage', hilfe: 'Was ist der aktuelle Stand?' },
  { k: 'dateien', text: 'Relevante Dateien und Informationen', hilfe: 'Pfade, Links, Fakten – keine Zugangsdaten, keine Kundendaten.' },
  { k: 'ergebnis_soll', text: 'Gewünschtes Ergebnis', hilfe: 'Form und Umfang, z. B. „3 Textvarianten“, „Pull Request“.' },
  { k: 'einschraenkungen', text: 'Einschränkungen', hilfe: 'Was darf nicht passieren / ist tabu?' },
  { k: 'akzeptanzkriterien', text: 'Akzeptanzkriterien', hilfe: 'Woran erkennen wir, dass es fertig ist?' },
  { k: 'freigaben', text: 'Erforderliche Freigaben', hilfe: 'Stufe-3-Schritte, z. B. „Veröffentlichung“.' },
];

export function AufgabeNeu() {
  useKopf('Neuer Auftrag', 'Arbeit');
  const projekte = useDaten<{ projekte: Projekt[] }>('/projekte', 0);
  const ma = useDaten<{ mitarbeiter: Mitarbeiter[] }>('/mitarbeiter', 0);
  const offene = useDaten<{ aufgaben: AufgabeKurz[] }>('/aufgaben?gruppe=offen', 0);
  const vorProjekt = new URLSearchParams(location.search).get('projekt') ?? '';
  const [projekt, setProjekt] = useState(vorProjekt);
  const [fehler, setFehler] = useState<string | null>(null);
  const [feldFehler, setFeldFehler] = useState<Record<string, string>>({});
  const [laeuft, setLaeuft] = useState(false);
  const beschreibungRef = useRef<HTMLTextAreaElement>(null);
  const titelRef = useRef<HTMLInputElement>(null);
  // Vorlage aus dem Teilen-Ziel (einmalig)
  const [vorlage] = useState<{ titel?: string; beschreibung?: string }>(() => {
    try {
      const v = sessionStorage.getItem(NEUER_AUFTRAG_VORLAGE);
      sessionStorage.removeItem(NEUER_AUFTRAG_VORLAGE);
      return v ? JSON.parse(v) : {};
    } catch {
      return {};
    }
  });

  if (!projekte.daten || !ma.daten) return <Ladebalken />;

  async function absenden(e: Event) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const t = (k: string) => String(f.get(k) ?? '').trim();
    const uebergabe = Object.fromEntries(UEBERGABE_FELDER.map(({ k }) => [k, t(k)]));
    setLaeuft(true);
    setFehler(null);
    setFeldFehler({});
    try {
      const r = await api.post<{ id: string }>('/aufgaben', {
        titel: t('titel'),
        beschreibung: t('beschreibung'),
        projekt_slug: t('projekt_slug'),
        zustaendig_id: t('zustaendig_id') || null,
        prioritaet: t('prioritaet') || 'normal',
        uebergabe,
        abhaengig_von: f.getAll('abhaengig_von').map(String),
      });
      toast(`Auftrag ${r.id} angelegt`);
      navigiere(`/aufgaben/${r.id}`, true);
    } catch (err) {
      const a = err as ApiFehler;
      setFehler(a.message);
      if (Array.isArray(a.details)) setFeldFehler(Object.fromEntries((a.details as { feld: string; meldung: string }[]).map((d) => [d.feld, d.meldung])));
    } finally {
      setLaeuft(false);
    }
  }

  const kandidaten = (offene.daten?.aufgaben ?? []).filter((a) => !projekt || a.projekt_slug === projekt);

  return (
    <form onSubmit={absenden} class="raster">
      <div class="sp-7">
        <Karte titel="Auftrag" kicker="Was ist zu tun?">
          <div class="formular-raster">
            <label class="feld breit">
              <span>Titel</span>
              <div class="reihe" style={{ flexWrap: 'nowrap' }}>
                <input ref={titelRef} class="eingabe" name="titel" required minLength={3} maxLength={160} placeholder="z. B. Landingpage für den Familienplaner texten" defaultValue={vorlage.titel?.slice(0, 160)} autoFocus />
                <Diktat ziel={() => titelRef.current} label="" />
              </div>
              {feldFehler.titel && <span class="feld-fehler">{feldFehler.titel}</span>}
            </label>
            <label class="feld breit">
              <span>Beschreibung</span>
              <textarea ref={beschreibungRef} class="eingabe" name="beschreibung" maxLength={8000} rows={5} defaultValue={vorlage.beschreibung} placeholder="Auftrag beschreiben oder diktieren." />
              <div><Diktat ziel={() => beschreibungRef.current} label="Beschreibung diktieren" /></div>
            </label>
            <label class="feld">
              <span>Projekt</span>
              <select class="eingabe" name="projekt_slug" required value={projekt} onChange={(e) => setProjekt((e.target as HTMLSelectElement).value)}>
                <option value="" disabled>Bitte wählen</option>
                {projekte.daten.projekte.filter((p) => p.status !== 'archiviert').map((p) => (
                  <option value={p.slug} key={p.slug}>{p.name}</option>
                ))}
              </select>
            </label>
            <label class="feld">
              <span>Priorität</span>
              <Auswahl class="eingabe" name="prioritaet" defaultValue="normal">
                <option value="niedrig">Niedrig</option>
                <option value="normal">Normal</option>
                <option value="hoch">Hoch</option>
                <option value="kritisch">Kritisch</option>
              </Auswahl>
            </label>
            <label class="feld breit">
              <span>Zuständig</span>
              <Auswahl class="eingabe" name="zustaendig_id" defaultValue="">
                <option value="">Noch offen – später zuweisen</option>
                {ma.daten.mitarbeiter.filter((m) => m.anbieter !== 'flexibel').map((m) => (
                  <option value={m.id} key={m.id}>{m.rolle} – {m.name} ({ZUGANG_TEXT[m.zugang]})</option>
                ))}
              </Auswahl>
            </label>
            {kandidaten.length > 0 && (
              <fieldset class="feld breit" style={{ border: 0, padding: 0, margin: 0 }}>
                <span>Hängt ab von (optional)</span>
                <div style={{ display: 'grid', gap: 6, maxHeight: 160, overflow: 'auto' }}>
                  {kandidaten.slice(0, 30).map((a) => (
                    <label class="reihe" key={a.id} style={{ fontSize: 13.5, gap: 8 }}>
                      <input type="checkbox" name="abhaengig_von" value={a.id} /> <b style={{ fontWeight: 600 }}>{a.id}</b> {a.titel}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        </Karte>
      </div>

      <div class="sp-5">
        <Karte titel="Übergabepaket" kicker="Für den KI-Mitarbeiter">
          <p class="zeitstempel" style={{ margin: '0 0 12px' }}>
            Je klarer, desto weniger Rückfragen – und desto weniger Kontingent verbraucht. Alle Felder sind optional.
          </p>
          <div style={{ display: 'grid', gap: 12 }}>
            {UEBERGABE_FELDER.map(({ k, text, hilfe }) => (
              <label class="feld" key={k}>
                <span>{text}</span>
                <textarea class="eingabe" name={k} rows={2} maxLength={4000} placeholder={hilfe} style={{ minHeight: 64 }} />
              </label>
            ))}
          </div>
        </Karte>
      </div>

      <div class="sp-12 reihe">
        {fehler && <p class="feld-fehler" role="alert" style={{ width: '100%', margin: 0 }}>{fehler}</p>}
        <button class="btn btn-primary" disabled={laeuft}>
          <Send size={17} aria-hidden="true" /> Auftrag erteilen
        </button>
        <a class="btn btn-ghost" href="/aufgaben">Abbrechen</a>
      </div>
    </form>
  );
}
