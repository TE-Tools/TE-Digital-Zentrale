import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FolderKanban,
  Hourglass,
  ListChecks,
  MessageCircleQuestion,
  OctagonX,
  PlayCircle,
  Plus,
  ShieldCheck,
  Sparkles,
} from 'lucide-preact';
import { FREIGABE_TYP } from '../lib/texte';
import { KostenBalken } from './Berichte';

const KOSTEN_GRENZEN = [
  { dienst: 'workers', metrik: 'anfragen', grenze: 100_000, text: 'Worker-Anfragen' },
  { dienst: 'd1', metrik: 'zeilen_geschrieben', grenze: 100_000, text: 'D1 geschriebene Zeilen' },
];

function kurzbericht(k: Record<string, number>): string {
  return [`${k.erledigt ?? 0} erledigt`, `${k.offen ?? 0} offen`, k.pruefung ? `${k.pruefung} zur Prüfung` : '', k.freigaben_offen ? `${k.freigaben_offen} Freigaben offen` : '', k.blockiert ? `${k.blockiert} blockiert` : '']
    .filter(Boolean)
    .join(' · ');
}
import { vorlesen } from '../komponenten/Diktat';
import { Volume2 } from 'lucide-preact';
import { Karte, Kennzahl, Ladebalken, Leer, Pill } from '../komponenten/Bausteine';
import { MitarbeiterKarte } from '../komponenten/Mitarbeiter';
import { aktivitaetLink, aktivitaetText, begruessung, datumLang, relativeZeit, toenung } from '../lib/format';
import { useKopf } from '../lib/kopf';
import type { Benutzer, Dashboard as DashboardDaten } from '../lib/typen';

const STATUS = {
  ok: { text: 'Alles im grünen Bereich', sub: 'Keine Blockaden, keine offenen Freigaben', farbe: '#4CC38A' },
  warnung: { text: 'Aufmerksamkeit nötig', sub: 'Offene Freigaben, Rückfragen oder Blockaden', farbe: '#E9A23B' },
  kritisch: { text: 'Kritisch', sub: 'Dringende Freigabe oder wichtige Aufgabe blockiert', farbe: '#F0607A' },
} as const;

export function Dashboard({ benutzer, daten, fehler }: { benutzer: Benutzer; daten: DashboardDaten | null; fehler: string | null }) {
  useKopf('Dashboard', 'Unternehmensübersicht');

  if (!daten) return fehler ? <p class="hinweis krit"><AlertTriangle size={18} />{fehler}</p> : <Ladebalken />;

  const z = daten.zahlen;
  const st = STATUS[daten.status];
  const vorname = benutzer.name.split(' ')[0];

  return (
    <div class="raster dashboard">
      {/* 1 – Statusband */}
      <section class="statusband sp-12 db-status" aria-label="Unternehmensstatus">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <p class="kicker">TE-Digital · Unternehmensstatus</p>
          <h2>{begruessung()}, {vorname}.</h2>
          <div class="datum">{datumLang()} · Stand {relativeZeit(daten.stand)}</div>
        </div>
        <div class="status-signal" style={{ position: 'relative', zIndex: 1 }}>
          <span class="puls" style={{ '--puls': st.farbe }} aria-hidden="true" />
          <div>
            <b>{st.text}</b>
            <span>{st.sub}</span>
          </div>
        </div>
        <div class="statusband-aktionen">
          {'speechSynthesis' in window && (
            <button
              class="btn btn-ghost"
              onClick={() =>
                vorlesen(
                  [
                    `${begruessung()}. ${st.text}.`,
                    `${z.in_arbeit} ${z.in_arbeit === 1 ? 'Aufgabe' : 'Aufgaben'} in Bearbeitung, ${z.in_pruefung} zur Prüfung.`,
                    z.offene_freigaben ? `${z.offene_freigaben} offene ${z.offene_freigaben === 1 ? 'Freigabe' : 'Freigaben'}.` : 'Keine offenen Freigaben.',
                    daten.rueckfragen.length ? `${daten.rueckfragen.length} ${daten.rueckfragen.length === 1 ? 'Rückfrage wartet' : 'Rückfragen warten'} auf Sie.` : '',
                    daten.fortsetzbar.length ? `${daten.fortsetzbar.length} pausierte ${daten.fortsetzbar.length === 1 ? 'Aufgabe kann' : 'Aufgaben können'} fortgesetzt werden.` : '',
                    z.blockiert ? `${z.blockiert} blockiert.` : '',
                  ].filter(Boolean).join(' '),
                )
              }
              title="Status vorlesen"
            >
              <Volume2 size={18} aria-hidden="true" /> Vorlesen
            </button>
          )}
          <a class="btn btn-gold" href="/aufgaben/neu">
            <Plus size={18} aria-hidden="true" /> Neuer Auftrag
          </a>
        </div>
      </section>

      {/* 3 – Wartet auf Sie (mobil direkt nach dem Status) */}
      <div class="sp-12 db-wartet">
        <Karte titel="Wartet auf Sie" kicker="Freigaben & Eskalationen" mehr={{ text: 'Alle Freigaben', href: '/freigaben' }}>
          {daten.freigaben.length === 0 && daten.fortsetzbar.length === 0 && daten.rueckfragen.length === 0 && z.in_pruefung === 0 ? (
            <div class="hinweis ok">
              <CheckCircle2 size={18} aria-hidden="true" />
              <p><b>Nichts offen.</b> Es liegen keine Freigaben, Rückfragen oder Prüfungen vor.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {daten.freigaben.map((f) => (
                <a class={`hinweis ${f.dringend ? 'krit' : ''}`} key={f.id} href="/freigaben" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <ShieldCheck size={18} aria-hidden="true" />
                  <p style={{ flex: 1 }}>
                    <b>{f.titel}</b>
                    <br />
                    <span class="zeitstempel">{FREIGABE_TYP[f.typ] ?? f.typ} · {f.id} · beantragt {relativeZeit(f.angefragt_am)}</span>
                  </p>
                  {f.dringend ? <Pill ton="krit">Dringend</Pill> : <Pill ton="gold">Freigabe</Pill>}
                </a>
              ))}
              {daten.fortsetzbar.map((f) => (
                <a class="hinweis warn" key={f.id} href={`/aufgaben/${f.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <PlayCircle size={18} aria-hidden="true" />
                  <p style={{ flex: 1 }}>
                    <b>{f.id} fortsetzen:</b> {f.titel}
                    <br />
                    <span class="zeitstempel">{f.mitarbeiter} ist seit {relativeZeit(f.limit_bis).replace('vor ', '')} wieder verfügbar</span>
                  </p>
                  <Pill ton="warn">Limit vorbei</Pill>
                </a>
              ))}
              {daten.rueckfragen.map((r) => (
                <a class="hinweis info" key={r.id} href={r.aufgabe_id ? `/aufgaben/${r.aufgabe_id}` : '/kommunikation'} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <MessageCircleQuestion size={18} aria-hidden="true" />
                  <p style={{ flex: 1, minWidth: 0 }}>
                    <b>Rückfrage{r.aufgabe_id ? ` zu ${r.aufgabe_id}` : ''}:</b> {r.inhalt.length > 140 ? r.inhalt.slice(0, 140) + ' …' : r.inhalt}
                    <br />
                    <span class="zeitstempel">{relativeZeit(r.zeit)}</span>
                  </p>
                </a>
              ))}
              {z.in_pruefung > 0 && (
                <a class="hinweis" href="/aufgaben?gruppe=pruefung" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <ListChecks size={18} aria-hidden="true" />
                  <p><b>{z.in_pruefung} Ergebnis{z.in_pruefung === 1 ? '' : 'se'} zur Prüfung</b> – abnehmen oder zurückgeben.</p>
                </a>
              )}
            </div>
          )}
        </Karte>
      </div>

      {/* 2 – Kennzahlen */}
      <div class="sp-3 db-zahl"><Kennzahl titel="Offene Freigaben" wert={z.offene_freigaben} fuss={z.dringende_freigaben ? `${z.dringende_freigaben} dringend` : 'Stufe-3-Entscheidungen'} Icon={ShieldCheck} ton="gold" /></div>
      <div class="sp-3 db-zahl"><Kennzahl titel="In Bearbeitung" wert={z.in_arbeit} fuss={`${z.in_pruefung} in Prüfung · ${z.wartend} wartend`} Icon={CircleDot} /></div>
      <div class="sp-3 db-zahl"><Kennzahl titel="Blockiert" wert={z.blockiert} fuss="brauchen Klärung" Icon={OctagonX} ton={z.blockiert ? 'krit' : undefined} /></div>
      <div class="sp-3 db-zahl"><Kennzahl titel="Heute erledigt" wert={z.heute_abgeschlossen} fuss={`${z.abgeschlossen} insgesamt`} Icon={CheckCircle2} ton="ok" /></div>

      {/* 4 – KI-Mitarbeiter */}
      <div class="sp-12 db-ma">
        <Karte titel="KI-Mitarbeiter" kicker="Team" mehr={{ text: 'Alle Mitarbeiter', href: '/mitarbeiter' }}>
          <div class="ma-liste">
            {daten.mitarbeiter.map((m) => (
              <MitarbeiterKarte m={m} key={m.id} />
            ))}
          </div>
        </Karte>
      </div>

      {/* 5 – Projekte */}
      <div class="sp-8 db-pj">
        <Karte titel="Projekte" kicker="Portfolio" mehr={{ text: 'Projektverwaltung', href: '/projekte' }}>
          {daten.projekte.length === 0 ? (
            <Leer Icon={FolderKanban} titel="Noch keine Projekte" />
          ) : (
            <div class="pj-liste">
              {daten.projekte.map((p) => {
                const gesamt = p.offen + p.fertig;
                const anteil = gesamt ? Math.round((p.fertig / gesamt) * 100) : 0;
                return (
                  <a class="karte akzent pj-karte" href={`/projekte/${p.slug}`} key={p.slug} style={{ '--akzent': p.farbe, boxShadow: 'none' }}>
                    <div class="pj-kopf">
                      <span class="pj-ic" style={{ background: toenung(p.farbe), color: p.farbe }} aria-hidden="true">
                        {p.name.replace(/^TE-(Digital )?/, '').slice(0, 2).toUpperCase()}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <b>{p.name}</b>
                        <span>{p.kurz}</span>
                      </div>
                    </div>
                    <div class="fortschritt" role="img" aria-label={`${anteil} % der Aufgaben erledigt`}>
                      <i style={{ width: `${anteil}%` }} />
                    </div>
                    <div class="pj-zahlen">
                      <span><b>{p.offen}</b> offen</span>
                      <span><b>{p.fertig}</b> erledigt</span>
                      {p.blockiert > 0 && <Pill ton="krit">{p.blockiert} blockiert</Pill>}
                      {p.status !== 'aktiv' && <Pill>{p.status}</Pill>}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </Karte>
      </div>

      {/* 6 – Aktivitäten + Tagesbericht */}
      <div class="sp-4 db-akt" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Karte titel="Letzte Aktivitäten" kicker="Protokoll">
          {daten.aktivitaeten.length === 0 ? (
            <Leer Icon={ListChecks} titel="Noch keine Aktivitäten" />
          ) : (
            <ul class="zeitleiste">
              {daten.aktivitaeten.slice(0, 8).map((a) => (
                <li key={a.id}>
                  <span class="punkt" aria-hidden="true" />
                  <div class="text">
                    <b>{a.akteur_name ?? 'System'}</b> {aktivitaetText(a)}
                    {aktivitaetLink(a) && a.objekt_id ? <> · <a href={aktivitaetLink(a)!}>{a.objekt_id}</a></> : null}
                    <div class="zeitstempel">{relativeZeit(a.zeit)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Karte>
        <Karte titel="Tagesbericht" kicker={daten.tagesbericht ? daten.tagesbericht.datum.split('-').reverse().join('.') : 'Heute'} mehr={{ text: 'Alle Berichte', href: '/berichte' }}>
          {daten.tagesbericht ? (
            <a href={`/berichte/${daten.tagesbericht.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'grid', gap: 6 }}>
              <span class="zeitstempel">{kurzbericht(daten.tagesbericht.kennzahlen)}</span>
              <span style={{ color: 'var(--gold-text)', fontWeight: 600, fontSize: 13.5 }}>Bericht öffnen →</span>
            </a>
          ) : (
            <Leer Icon={Hourglass} titel="Noch kein Tagesbericht" text="Er entsteht automatisch zur eingestellten Uhrzeit und kommt als Push." />
          )}
        </Karte>
        {daten.kosten.length > 0 && (
          <Karte titel="Free-Tarif" kicker="Nutzung heute" mehr={{ text: 'Details', href: '/berichte?ansicht=kosten' }}>
            <KostenBalken werte={daten.kosten.map((k) => ({ ...k, erfasst_am: '' }))} grenzen={KOSTEN_GRENZEN} />
          </Karte>
        )}
        <Karte titel="Hinweis zur Arbeitsweise" kicker="KI-Zugänge">
          <div class="hinweis info">
            <Sparkles size={18} aria-hidden="true" />
            <p>Nur <b>Claude Code</b> läuft über ein Abo. ChatGPT, Gemini und Grok arbeiten über ihre <b>kostenlosen Web-Zugänge</b> – bei aufgebrauchtem Kontingent wird pausiert.</p>
          </div>
        </Karte>
      </div>
    </div>
  );
}
