import { useEffect, useState } from 'preact/hooks';
import { CheckCircle2, ExternalLink, GitBranch, Link2Off, ShieldCheck } from 'lucide-preact';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { relativeZeit } from '../lib/format';
import { mitBestaetigung } from '../lib/stepup';
import { Karte, Ladebalken, Pill } from './Bausteine';
import { toast } from './Toast';

interface Status {
  verbindung: {
    status: 'getrennt' | 'eingerichtet' | 'installiert';
    organisation: string;
    app_slug: string | null;
    app_url: string | null;
    eingerichtet_am: string | null;
    installiert_am: string | null;
    letzter_abgleich: string | null;
    schluessel_vorhanden: boolean;
    installieren_url: string | null;
  };
  rechte: Record<string, string>;
  repos: unknown[];
}

const RECHTE_TEXT: Record<string, string> = {
  metadata: 'Metadaten der Repositories',
  pull_requests: 'Pull Requests',
  checks: 'Checks (CI-Ergebnisse)',
  issues: 'Issues und Kommentare',
};

const MELDUNG: Record<string, string> = {
  eingerichtet: 'GitHub-App angelegt. Jetzt installieren und Repositories auswählen.',
  ungueltig: 'Die Rückmeldung von GitHub war ungültig oder abgelaufen – bitte erneut starten.',
  fehler: 'GitHub hat die Einrichtung nicht bestätigt – bitte erneut versuchen.',
};

/**
 * GitHub-Verbindung (Kap. 8.4): Die Geschäftsführung richtet sie selbst ein.
 * 1) Passkey bestätigen → Manifest wird an github.com übergeben (Formular, kein Hintergrundaufruf)
 * 2) Auf GitHub App-Namen bestätigen → Rückkehr, Schlüssel werden verschlüsselt gespeichert
 * 3) App in TE-Tools installieren und Repositories auswählen (= die eigentliche Freigabe)
 */
export function GithubVerbindung() {
  const st = useDaten<Status>('/github/status', 0);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('github');
    if (q && MELDUNG[q]) toast(MELDUNG[q]);
  }, []);

  async function einrichten() {
    setLaeuft(true);
    try {
      const r = await mitBestaetigung(() => api.post<{ aktion: string; manifest: unknown }>('/github/einrichten', {}));
      // GitHub erwartet das Manifest als Formularfeld (POST, oberste Ebene)
      const f = document.createElement('form');
      f.method = 'post';
      f.action = r.aktion;
      const feld = document.createElement('input');
      feld.type = 'hidden';
      feld.name = 'manifest';
      feld.value = JSON.stringify(r.manifest);
      f.appendChild(feld);
      document.body.appendChild(f);
      f.submit();
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Abgebrochen');
      setLaeuft(false);
    }
  }

  async function trennen() {
    if (!confirm('GitHub-Verbindung trennen? Gespeicherte Schlüssel werden gelöscht. Die App selbst entfernen Sie danach auf GitHub.')) return;
    setLaeuft(true);
    try {
      const slug = st.daten?.verbindung.app_slug;
      const org = st.daten?.verbindung.organisation ?? 'TE-Tools';
      await mitBestaetigung(() => api.post('/github/trennen', {}));
      toast('Verbindung getrennt – App jetzt auf GitHub löschen');
      if (slug) window.open(`https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/${encodeURIComponent(slug)}/advanced`, '_blank', 'noopener');
      await st.neuLaden();
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Abgebrochen');
    } finally {
      setLaeuft(false);
    }
  }

  if (!st.daten) return <Karte titel="GitHub-Verbindung" kicker="Integration"><Ladebalken /></Karte>;
  const v = st.daten.verbindung;

  return (
    <section id="github">
      <Karte titel="GitHub-Verbindung" kicker={`Organisation ${v.organisation}`}>
        <div style={{ display: 'grid', gap: 12 }}>
          {v.status === 'getrennt' && (
            <>
              <p class="anm-text" style={{ margin: 0 }}>
                Sie legen eine eigene GitHub-App für die Zentrale an. Rechte – ausschließlich Lesen, außer Issues/Kommentare:
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {Object.entries(st.daten.rechte).map(([k, r]) => (
                  <li key={k}>{RECHTE_TEXT[k] ?? k}: <b>{r === 'read' ? 'lesen' : 'lesen & schreiben'}</b></li>
                ))}
                <li>Code: <b>kein Zugriff zum Schreiben</b> – zusammengeführt wird nur auf GitHub, nach Freigabe.</li>
              </ul>
              {!v.schluessel_vorhanden && (
                <div class="hinweis warn">
                  <ShieldCheck size={18} aria-hidden="true" />
                  <p>Auf dem Server fehlt noch das Secret <code>ZENTRALE_SCHLUESSEL</code> (verschlüsselt die GitHub-Schlüssel). Siehe README → Produktivsetzung.</p>
                </div>
              )}
              <div>
                <button class="btn btn-primary" disabled={laeuft || !v.schluessel_vorhanden} onClick={einrichten}>
                  <GitBranch size={17} aria-hidden="true" /> Verbindung einrichten (Passkey)
                </button>
              </div>
            </>
          )}
          {v.status === 'eingerichtet' && (
            <>
              <div class="hinweis info">
                <GitBranch size={18} aria-hidden="true" />
                <p><b>App „{v.app_slug}“ angelegt.</b> Jetzt in {v.organisation} installieren und <b>selbst die Repositories auswählen</b> – das ist die eigentliche Freigabe und jederzeit auf GitHub änderbar.</p>
              </div>
              <div class="reihe">
                {v.installieren_url && (
                  <a class="btn btn-primary" href={v.installieren_url}><ExternalLink size={16} aria-hidden="true" /> Auf GitHub installieren</a>
                )}
                <button class="btn btn-text btn-sm" disabled={laeuft} onClick={trennen}><Link2Off size={15} aria-hidden="true" /> Abbrechen & trennen</button>
              </div>
            </>
          )}
          {v.status === 'installiert' && (
            <>
              <div class="reihe">
                <Pill ton="ok"><CheckCircle2 size={13} aria-hidden="true" /> Verbunden</Pill>
                <span class="zeitstempel">App {v.app_slug} · seit {relativeZeit(v.installiert_am)} · {st.daten.repos.length} Repositories · Abgleich {relativeZeit(v.letzter_abgleich)}</span>
              </div>
              <div class="reihe">
                <a class="btn btn-ghost btn-sm" href="/entwicklung">Zur Entwicklungsübersicht</a>
                {v.installieren_url && <a class="btn btn-ghost btn-sm" href={v.installieren_url} target="_blank" rel="noopener noreferrer">Repositories ändern (GitHub)</a>}
                <button class="btn btn-text btn-sm" disabled={laeuft} onClick={trennen}><Link2Off size={15} aria-hidden="true" /> Trennen</button>
              </div>
            </>
          )}
          <p class="zeitstempel" style={{ margin: 0 }}>Einrichten und Trennen sind Stufe-3-Aktionen und werden im Audit-Protokoll vermerkt.</p>
        </div>
      </Karte>
    </section>
  );
}
