import { useState } from 'preact/hooks';
import { Save } from 'lucide-preact';
import { ApiFehler, api } from '../lib/api';
import { Auswahl } from '../komponenten/Auswahl';
import type { Projekt } from '../lib/typen';

const FARBEN = ['#C8912A', '#047857', '#1B4D3E', '#6B1F2A', '#5A3CE0', '#9B1C1F', '#1D4ED8', '#14161A'];

export function ProjektFormular(props: {
  projekt?: Projekt;
  abbrechen: () => void;
  gespeichert: (slug: string) => void;
}) {
  const p = props.projekt;
  const [farbe, setFarbe] = useState(p?.farbe ?? '#C8912A');
  const [fehler, setFehler] = useState<string | null>(null);
  const [feldFehler, setFeldFehler] = useState<Record<string, string>>({});
  const [laeuft, setLaeuft] = useState(false);

  async function speichern(e: Event) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    const daten = {
      name: text('name'),
      kurz: text('kurz'),
      beschreibung: text('beschreibung'),
      ziele: text('ziele'),
      repo_url: text('repo_url'),
      website_url: text('website_url'),
      hosting: text('hosting'),
      stack: text('stack'),
      farbe,
      status: text('status') || 'aktiv',
    };
    setLaeuft(true);
    setFehler(null);
    setFeldFehler({});
    try {
      if (p) {
        await api.patch(`/projekte/${p.slug}`, { ...daten, version: p.version });
        props.gespeichert(p.slug);
      } else {
        const r = await api.post<{ slug: string }>('/projekte', { ...daten, slug: text('slug') });
        props.gespeichert(r.slug);
      }
    } catch (err) {
      const a = err as ApiFehler;
      setFehler(a.message);
      if (Array.isArray(a.details)) {
        setFeldFehler(Object.fromEntries((a.details as { feld: string; meldung: string }[]).map((d) => [d.feld, d.meldung])));
      }
    } finally {
      setLaeuft(false);
    }
  }

  const F = ({ k }: { k: string }) => (feldFehler[k] ? <span class="feld-fehler">{feldFehler[k]}</span> : null);

  return (
    <form onSubmit={speichern} class="formular-raster">
      <label class="feld">
        <span>Name</span>
        <input class="eingabe" name="name" required minLength={2} maxLength={80} defaultValue={p?.name} />
        <F k="name" />
      </label>
      {!p ? (
        <label class="feld">
          <span>Kürzel (URL)</span>
          <input class="eingabe" name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,39}" placeholder="z. B. neue-app" />
          <small>Kleinbuchstaben, Ziffern, Bindestrich. Später nicht änderbar.</small>
          <F k="slug" />
        </label>
      ) : (
        <label class="feld">
          <span>Status</span>
          <Auswahl class="eingabe" name="status" defaultValue={p.status}>
            <option value="aktiv">aktiv</option>
            <option value="geplant">geplant</option>
            <option value="pausiert">pausiert</option>
            <option value="archiviert">archiviert</option>
          </Auswahl>
        </label>
      )}
      <label class="feld breit">
        <span>Kurzbeschreibung</span>
        <input class="eingabe" name="kurz" maxLength={120} defaultValue={p?.kurz} />
      </label>
      <label class="feld breit">
        <span>Beschreibung</span>
        <textarea class="eingabe" name="beschreibung" maxLength={4000} defaultValue={p?.beschreibung} />
      </label>
      <label class="feld breit">
        <span>Ziele</span>
        <textarea class="eingabe" name="ziele" maxLength={4000} defaultValue={p?.ziele} placeholder="Ein Ziel pro Zeile" />
      </label>
      <label class="feld">
        <span>GitHub-Repository</span>
        <input class="eingabe" name="repo_url" type="url" placeholder="https://github.com/TE-Tools/…" defaultValue={p?.repo_url ?? ''} />
        <small>Wird nach Einrichtung der GitHub-Verbindung (Phase 5) automatisch verknüpft.</small>
        <F k="repo_url" />
      </label>
      <label class="feld">
        <span>Website</span>
        <input class="eingabe" name="website_url" type="url" placeholder="https://…" defaultValue={p?.website_url ?? ''} />
        <F k="website_url" />
      </label>
      <label class="feld">
        <span>Hosting</span>
        <input class="eingabe" name="hosting" maxLength={300} defaultValue={p?.hosting} />
      </label>
      <label class="feld">
        <span>Technologie-Stack</span>
        <input class="eingabe" name="stack" maxLength={300} defaultValue={p?.stack} />
      </label>
      <fieldset class="feld breit" style={{ border: 0, padding: 0, margin: 0 }}>
        <span>Hausfarbe</span>
        <div class="reihe" style={{ gap: 8 }}>
          {FARBEN.map((c) => (
            <button
              type="button"
              key={c}
              aria-label={`Farbe ${c}`}
              aria-pressed={farbe.toLowerCase() === c.toLowerCase()}
              onClick={() => setFarbe(c)}
              style={{
                width: 32, height: 32, borderRadius: 9, background: c, cursor: 'pointer',
                border: farbe.toLowerCase() === c.toLowerCase() ? '3px solid var(--ink)' : '1px solid var(--line-2)',
              }}
            />
          ))}
          <input type="color" value={farbe} onInput={(e) => setFarbe((e.target as HTMLInputElement).value.toUpperCase())} aria-label="Eigene Farbe" style={{ width: 40, height: 34, border: 0, background: 'none' }} />
          <code style={{ fontSize: 13 }}>{farbe}</code>
        </div>
      </fieldset>
      {fehler && <p class="feld-fehler breit" role="alert">{fehler}</p>}
      <div class="reihe breit">
        <button class="btn btn-primary" disabled={laeuft}>
          <Save size={17} aria-hidden="true" /> {p ? 'Änderungen speichern' : 'Projekt anlegen'}
        </button>
        <button type="button" class="btn btn-ghost" onClick={props.abbrechen}>Abbrechen</button>
      </div>
    </form>
  );
}
