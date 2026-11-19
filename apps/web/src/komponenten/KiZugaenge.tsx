import { useState } from 'preact/hooks';
import { Bot, ClipboardCopy, KeyRound, Plus, Trash2 } from 'lucide-preact';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { relativeZeit } from '../lib/format';
import { mitBestaetigung } from '../lib/stepup';
import type { Mitarbeiter, Projekt } from '../lib/typen';
import { Karte, Ladebalken, Pill } from './Bausteine';
import { Dialog } from './Dialog';
import { toast } from './Toast';

interface Zugang {
  id: number;
  mitarbeiter_id: string;
  mitarbeiter_name: string;
  mitarbeiter_rolle: string;
  bezeichnung: string;
  token_anfang: string;
  projekte: string[] | null;
  erstellt_am: string;
  zuletzt_am: string | null;
  widerrufen_am: string | null;
}

async function kopieren(text: string, was: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${was} kopiert`);
  } catch {
    toast('Kopieren nicht erlaubt – bitte markieren');
  }
}

/** KI-Zugänge (MCP-Token) für Claude Code / Claude. Anlegen = Rechtevergabe (Passkey). */
export function KiZugaenge() {
  const liste = useDaten<{ zugaenge: Zugang[] }>('/zugaenge', 0);
  const [neu, setNeu] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  async function widerrufen(z: Zugang) {
    if (!confirm(`Zugang „${z.bezeichnung}“ sofort sperren?`)) return;
    await api.post(`/zugaenge/${z.id}/widerrufen`, {});
    toast('Zugang gesperrt');
    await liste.neuLaden();
  }

  const mcpUrl = `${location.origin}/mcp`;

  return (
    <Karte titel="KI-Zugänge (MCP)" kicker="Claude Code · Claude">
      <div style={{ display: 'grid', gap: 12 }}>
        <p class="anm-text" style={{ margin: 0 }}>
          Mit einem Zugang arbeitet Claude Code (über Ihr Claude-Abo) direkt mit der Zentrale: Aufgaben lesen, Zwischenstände und Ergebnisse melden, Freigaben
          beantragen. Freigaben erteilen kann ein KI-Zugang nie.
        </p>
        {!liste.daten ? <Ladebalken /> : liste.daten.zugaenge.length === 0 ? (
          <p class="textblock leer">Noch kein Zugang.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {liste.daten.zugaenge.map((z) => (
              <li key={z.id} class="hinweis" style={{ alignItems: 'center', opacity: z.widerrufen_am ? 0.6 : 1 }}>
                <Bot size={18} aria-hidden="true" />
                <p style={{ flex: 1, minWidth: 0 }}>
                  <b>{z.bezeichnung}</b> · {z.mitarbeiter_rolle} ({z.mitarbeiter_name})
                  <br />
                  <span class="zeitstempel">
                    <code>{z.token_anfang}…</code> · {z.projekte ? z.projekte.join(', ') : 'alle Projekte'} · zuletzt benutzt {relativeZeit(z.zuletzt_am)}
                  </span>
                </p>
                {z.widerrufen_am ? (
                  <Pill>gesperrt</Pill>
                ) : (
                  <button class="btn btn-text btn-sm" onClick={() => widerrufen(z)} aria-label="Zugang sperren"><Trash2 size={15} /></button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div>
          <button class="btn btn-primary btn-sm" onClick={() => setNeu(true)}><Plus size={16} aria-hidden="true" /> Zugang erstellen</button>
        </div>
      </div>

      {neu && (
        <NeuerZugang
          schliessen={() => setNeu(false)}
          erstellt={(t) => {
            setNeu(false);
            setToken(t);
            void liste.neuLaden();
          }}
        />
      )}

      {token && (
        <Dialog titel="Zugang erstellt – Token jetzt sichern" schliessen={() => setToken(null)}>
          <div class="hinweis warn">
            <KeyRound size={18} aria-hidden="true" />
            <p>Das Token wird <b>nur jetzt</b> angezeigt. Wie ein Passwort behandeln: nicht in Repositories einchecken, nicht in Chats einfügen.</p>
          </div>
          <pre class="paket" style={{ maxHeight: 120 }}>{token}</pre>
          <p class="zeitstempel" style={{ margin: 0 }}><b>Claude Code (lokal)</b> – einmal im Terminal ausführen:</p>
          <pre class="paket" style={{ maxHeight: 140 }}>{`claude mcp add --transport http --scope user te-zentrale ${mcpUrl} --header "Authorization: Bearer ${token}"`}</pre>
          <p class="zeitstempel" style={{ margin: 0 }}>
            <b>Claude Code in der Cloud:</b> In der Cloud-Umgebung die Variable <code>TE_ZENTRALE_TOKEN</code> mit diesem Token anlegen und im Projekt-Repository
            diese <code>.mcp.json</code> einchecken (enthält kein Geheimnis):
          </p>
          <pre class="paket" style={{ maxHeight: 180 }}>{JSON.stringify({ mcpServers: { 'te-zentrale': { type: 'http', url: mcpUrl, headers: { Authorization: 'Bearer ${TE_ZENTRALE_TOKEN}' } } } }, null, 2)}</pre>
          <div class="reihe">
            <button class="btn btn-primary btn-sm" onClick={() => kopieren(token, 'Token')}><ClipboardCopy size={16} aria-hidden="true" /> Token kopieren</button>
            <button
              class="btn btn-ghost btn-sm"
              onClick={() => kopieren(`claude mcp add --transport http --scope user te-zentrale ${mcpUrl} --header "Authorization: Bearer ${token}"`, 'Befehl')}
            >
              <ClipboardCopy size={16} aria-hidden="true" /> Befehl kopieren
            </button>
            <button class="btn btn-text btn-sm" onClick={() => setToken(null)}>Gesichert, schließen</button>
          </div>
        </Dialog>
      )}
    </Karte>
  );
}

function NeuerZugang({ schliessen, erstellt }: { schliessen: () => void; erstellt: (token: string) => void }) {
  const ma = useDaten<{ mitarbeiter: Mitarbeiter[] }>('/mitarbeiter', 0);
  const pj = useDaten<{ projekte: Projekt[] }>('/projekte', 0);
  const [alle, setAlle] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  async function absenden(e: Event) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const projekte = alle ? null : f.getAll('projekte').map(String);
    if (projekte && projekte.length === 0) {
      setFehler('Bitte mindestens ein Projekt wählen.');
      return;
    }
    try {
      const r = await mitBestaetigung(() =>
        api.post<{ token: string }>('/zugaenge', { mitarbeiter_id: String(f.get('mitarbeiter_id')), bezeichnung: String(f.get('bezeichnung') ?? '').trim(), projekte }),
      );
      erstellt(r.token);
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : 'Abgebrochen');
    }
  }

  return (
    <Dialog titel="KI-Zugang erstellen" schliessen={schliessen}>
      <form onSubmit={absenden} style={{ display: 'grid', gap: 12 }}>
        <label class="feld">
          <span>Für Mitarbeiter</span>
          <select class="eingabe" name="mitarbeiter_id" required>
            {ma.daten?.mitarbeiter.filter((m) => m.anbieter !== 'flexibel').map((m) => (
              <option value={m.id} key={m.id} selected={m.id === 'technik'}>{m.rolle} – {m.name}</option>
            ))}
          </select>
          <small>Sinnvoll für Claude Code (technische Leitung). ChatGPT, Gemini und Grok können MCP mit kostenlosen Zugängen nicht nutzen.</small>
        </label>
        <label class="feld">
          <span>Bezeichnung</span>
          <input class="eingabe" name="bezeichnung" required minLength={2} maxLength={60} defaultValue="Claude Code – Büro-PC" />
        </label>
        <label class="reihe" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={alle} onChange={(e) => setAlle((e.target as HTMLInputElement).checked)} /> Zugriff auf alle Projekte
        </label>
        {!alle && (
          <div style={{ display: 'grid', gap: 6, maxHeight: 200, overflow: 'auto' }}>
            {pj.daten?.projekte.map((p) => (
              <label class="reihe" key={p.slug} style={{ fontSize: 14, gap: 8 }}>
                <input type="checkbox" name="projekte" value={p.slug} />
                <span class="projekt-punkt" style={{ background: p.farbe }} /> {p.name}
              </label>
            ))}
          </div>
        )}
        {fehler && <p class="feld-fehler">{fehler}</p>}
        <div class="reihe">
          <button class="btn btn-primary"><KeyRound size={17} aria-hidden="true" /> Erstellen (Passkey)</button>
          <button type="button" class="btn btn-ghost" onClick={schliessen}>Abbrechen</button>
        </div>
      </form>
    </Dialog>
  );
}
