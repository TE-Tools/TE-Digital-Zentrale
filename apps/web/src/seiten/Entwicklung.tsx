import { useEffect, useState } from 'preact/hooks';
import { AlertTriangle, CheckCircle2, ExternalLink, GitBranch, GitPullRequest, Lock, RefreshCw, Unlock } from 'lucide-preact';
import { Karte, Ladebalken, Leer, Pill } from '../komponenten/Bausteine';
import { toast } from '../komponenten/Toast';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { CHECKS, PR_ZUSTAND, type PullRequest, type Sperre } from '../lib/entwicklung';
import { relativeZeit } from '../lib/format';
import { useKopf } from '../lib/kopf';
import { AUFGABEN_STATUS } from '../lib/texte';
import type { AufgabenStatus, Benutzer, Projekt } from '../lib/typen';

interface Status {
  verbindung: {
    status: 'getrennt' | 'eingerichtet' | 'installiert';
    organisation: string;
    app_slug: string | null;
    installieren_url: string | null;
    letzter_abgleich: string | null;
    letzter_fehler: string | null;
  };
  repos: { full_name: string; privat: number; standard_branch: string; url: string; projekt_slug: string | null; projekt_name: string | null; projekt_farbe: string | null; offene_prs: number }[];
}
interface Uebersicht {
  prs: PullRequest[];
  sperren: Sperre[];
  konflikte: { art: 'pr_pr' | 'pr_sperre'; repo: string; a: string; b: string; dateien: string[] }[];
  aufgaben: { id: string; titel: string; status: AufgabenStatus; branch: string | null; pr_url: string | null; projekt_farbe: string }[];
}

const MELDUNG: Record<string, string> = {
  installiert: 'GitHub-App installiert – Repositories werden abgeglichen.',
  ungueltig: 'Die Rückmeldung von GitHub war ungültig oder abgelaufen.',
  falsche_organisation: 'Die App wurde in einer anderen Organisation installiert.',
};

export function Entwicklung({ benutzer }: { benutzer: Benutzer }) {
  useKopf('Entwicklung', 'GitHub · Branches · Pull Requests');
  const status = useDaten<Status>('/github/status', 300_000);
  const u = useDaten<Uebersicht>('/entwicklung');
  const projekte = useDaten<{ projekte: Projekt[] }>('/projekte', 0);
  const [laeuft, setLaeuft] = useState(false);
  const gf = benutzer.rolle === 'gf';

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('github');
    if (q && MELDUNG[q]) toast(MELDUNG[q]);
  }, []);

  async function abgleich() {
    setLaeuft(true);
    try {
      const r = await api.post<{ repos: number; prs: number }>('/github/abgleich');
      toast(`${r.repos} Repositories, ${r.prs} offene Pull Requests`);
      await Promise.all([status.neuLaden(), u.neuLaden()]);
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Abgleich fehlgeschlagen');
    } finally {
      setLaeuft(false);
    }
  }

  async function freigeben(s: Sperre) {
    if (!confirm(`Sperre ${s.id} (${s.aufgabe_id}) lösen? Andere Aufgaben können die Dateien dann ändern.`)) return;
    try {
      await api.post(`/sperren/${s.id}/freigeben`, {});
      await u.neuLaden();
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Fehler');
    }
  }

  async function zuordnen(repo: string, slug: string) {
    try {
      await api.patch(`/github/repos/${repo}`, { projekt_slug: slug || null });
      await status.neuLaden();
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Fehler');
    }
  }

  const v = status.daten?.verbindung;
  const offenePrs = (u.daten?.prs ?? []).filter((p) => p.zustand === 'offen' || p.zustand === 'entwurf');

  return (
    <div class="raster">
      {/* Verbindung */}
      <div class="sp-12">
        {!v ? (
          <Ladebalken />
        ) : v.status !== 'installiert' ? (
          <div class="hinweis info">
            <GitBranch size={18} aria-hidden="true" />
            <p style={{ flex: 1 }}>
              <b>{v.status === 'getrennt' ? 'GitHub ist noch nicht verbunden.' : 'GitHub-App angelegt – noch nicht installiert.'}</b>{' '}
              {v.status === 'getrennt'
                ? 'Die Verbindung richten Sie selbst unter Einstellungen ein. Bis dahin funktionieren Sperren, Branch-Namen und die Claude-Code-Übergabe trotzdem.'
                : 'Installieren Sie die App in TE-Tools und wählen Sie dort die Repositories aus.'}
            </p>
            {v.status === 'getrennt' ? (
              <a class="btn btn-primary btn-sm" href="/einstellungen#github">Zur Einrichtung</a>
            ) : (
              v.installieren_url && <a class="btn btn-primary btn-sm" href={v.installieren_url} target="_blank" rel="noopener noreferrer">App installieren</a>
            )}
          </div>
        ) : (
          <div class="reihe">
            <Pill ton="ok"><CheckCircle2 size={13} aria-hidden="true" /> GitHub verbunden · {v.organisation}</Pill>
            <span class="zeitstempel">Abgleich {relativeZeit(v.letzter_abgleich)} · stündlich und per Webhook</span>
            {v.letzter_fehler && <Pill ton="krit" titel={v.letzter_fehler}>Fehler beim letzten Abgleich</Pill>}
            {gf && (
              <button class="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={laeuft} onClick={abgleich}>
                <RefreshCw size={15} aria-hidden="true" /> Jetzt abgleichen
              </button>
            )}
          </div>
        )}
      </div>

      {/* Konflikte */}
      {(u.daten?.konflikte.length ?? 0) > 0 && (
        <div class="sp-12" style={{ display: 'grid', gap: 8 }}>
          {u.daten!.konflikte.map((k, i) => (
            <div class="hinweis krit" key={i}>
              <AlertTriangle size={18} aria-hidden="true" />
              <p>
                <b>Möglicher Konflikt in {k.repo}:</b> {k.a} und {k.b} ändern {k.dateien.join(', ')}.
                {k.art === 'pr_sperre' ? ' Die Dateien sind für eine andere Aufgabe gesperrt.' : ' Erst einen der beiden zusammenführen, dann den anderen anpassen.'}
              </p>
            </div>
          ))}
        </div>
      )}

      <div class="sp-7" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Karte titel="Pull Requests" kicker={`${offenePrs.length} offen`}>
          {!u.daten ? <Ladebalken /> : u.daten.prs.length === 0 ? (
            <Leer Icon={GitPullRequest} titel="Keine Pull Requests" text="Sobald GitHub verbunden ist, erscheinen hier offene PRs mit Checks und der verknüpften Aufgabe (über den Branch-Namen aufgabe/td-0007-…)." />
          ) : (
            <ul class="aufgaben-liste">
              {u.daten.prs.map((p) => (
                <li key={`${p.repo}#${p.nummer}`}>
                  <div class="aufgabe-zeile" style={{ '--akzent': p.projekt_farbe ?? 'var(--line-2)' }}>
                    <span class="leiste" aria-hidden="true" />
                    <div style={{ minWidth: 0 }}>
                      <div class="titel">
                        <span class="id">{p.repo.split('/')[1]} #{p.nummer}</span>
                        <a href={p.url} target="_blank" rel="noopener noreferrer">{p.titel}</a>
                      </div>
                      <div class="meta">
                        <span class="reihe" style={{ gap: 3 }}><GitBranch size={12} aria-hidden="true" />{p.branch}</span>
                        {p.aufgabe_id ? <a href={`/aufgaben/${p.aufgabe_id}`}>{p.aufgabe_id}</a> : <span>keine Aufgabe</span>}
                        {p.dateien != null && <span>{p.dateien} Dateien</span>}
                        <span>{relativeZeit(p.aktualisiert_am)}</span>
                      </div>
                    </div>
                    <div class="rechts">
                      <Pill ton={PR_ZUSTAND[p.zustand].ton}>{PR_ZUSTAND[p.zustand].text}</Pill>
                      {(p.zustand === 'offen' || p.zustand === 'entwurf') && <Pill ton={CHECKS[p.checks].ton}>{CHECKS[p.checks].text}</Pill>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p class="zeitstempel" style={{ margin: '12px 0 0' }}>
            Zusammenführen in main geschieht auf GitHub – erst nach Prüfung und Freigabe in der Zentrale. Die App hat bewusst kein Schreibrecht auf Code.
          </p>
        </Karte>

        <Karte titel="Entwicklungsaufgaben" kicker="Branches">
          {!u.daten ? <Ladebalken /> : u.daten.aufgaben.length === 0 ? (
            <p class="textblock leer">Keine offenen Entwicklungsaufgaben.</p>
          ) : (
            <ul class="aufgaben-liste">
              {u.daten.aufgaben.map((a) => (
                <li key={a.id}>
                  <a class="aufgabe-zeile" href={`/aufgaben/${a.id}`} style={{ '--akzent': a.projekt_farbe }}>
                    <span class="leiste" aria-hidden="true" />
                    <div style={{ minWidth: 0 }}>
                      <div class="titel"><span class="id">{a.id}</span>{a.titel}</div>
                      <div class="meta"><span class="reihe" style={{ gap: 3 }}><GitBranch size={12} aria-hidden="true" />{a.branch ?? 'noch kein Branch'}</span></div>
                    </div>
                    <div class="rechts"><Pill ton={AUFGABEN_STATUS[a.status].ton}>{AUFGABEN_STATUS[a.status].text}</Pill></div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Karte>
      </div>

      <div class="sp-5" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Karte titel="Aktive Sperren" kicker="Konfliktschutz">
          {!u.daten ? <Ladebalken /> : u.daten.sperren.length === 0 ? (
            <p class="textblock leer">Keine. Claude Code sperrt Dateien vor konfliktträchtigen Änderungen selbst (Werkzeug sperre_setzen).</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {u.daten.sperren.map((s) => (
                <li key={s.id} class="hinweis" style={{ alignItems: 'center' }}>
                  <Lock size={16} aria-hidden="true" />
                  <p style={{ flex: 1, minWidth: 0 }}>
                    <b>{s.repo}</b> · <a href={`/aufgaben/${s.aufgabe_id}`}>{s.aufgabe_id}</a>
                    <br />
                    <code style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{s.pfade.join(', ')}</code>
                    <br />
                    <span class="zeitstempel">{s.inhaber_id} · seit {relativeZeit(s.seit)}</span>
                  </p>
                  {gf && (
                    <button class="btn btn-text btn-sm" onClick={() => freigeben(s)} aria-label="Sperre lösen"><Unlock size={15} /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Karte>

        <Karte titel="Repositories" kicker="Zuordnung zu Projekten">
          {!status.daten ? <Ladebalken /> : status.daten.repos.length === 0 ? (
            <p class="textblock leer">Noch keine – die Auswahl treffen Sie bei der Installation auf GitHub.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
              {status.daten.repos.map((r) => (
                <li key={r.full_name} style={{ display: 'grid', gap: 4 }}>
                  <div class="reihe" style={{ gap: 6 }}>
                    <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.full_name}</a>
                    <ExternalLink size={12} aria-hidden="true" />
                    {r.offene_prs > 0 && <Pill ton="info">{r.offene_prs} PR</Pill>}
                  </div>
                  {gf ? (
                    <select class="eingabe" style={{ minHeight: 36, padding: '6px 10px' }} value={r.projekt_slug ?? ''} onChange={(e) => zuordnen(r.full_name, (e.target as HTMLSelectElement).value)} aria-label={`Projekt für ${r.full_name}`}>
                      <option value="">– kein Projekt –</option>
                      {projekte.daten?.projekte.map((p) => <option value={p.slug} key={p.slug}>{p.name}</option>)}
                    </select>
                  ) : (
                    <span class="zeitstempel">{r.projekt_name ?? 'kein Projekt'}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Karte>
      </div>
    </div>
  );
}
