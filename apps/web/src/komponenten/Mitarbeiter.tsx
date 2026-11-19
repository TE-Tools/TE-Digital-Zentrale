import { Clock } from 'lucide-preact';
import { ARBEITSWEG_TEXT, STATUS_TEXT, ZUGANG_TEXT, istVeraltet, relativeZeit } from '../lib/format';
import type { Mitarbeiter } from '../lib/typen';
import { Pill } from './Bausteine';

const KUERZEL: Record<Mitarbeiter['anbieter'], string> = {
  chatgpt: 'GP',
  claude: 'CL',
  gemini: 'GE',
  grok: 'GR',
  flexibel: '··',
};

export function MitarbeiterKarte({ m, ausfuehrlich = false }: { m: Mitarbeiter; ausfuehrlich?: boolean }) {
  const st = STATUS_TEXT[m.status];
  const veraltet = istVeraltet(m.status_bestaetigt_am);
  const textfarbe = m.farbe.toLowerCase() === '#c8912a' ? 'var(--on-gold)' : '#fff';
  return (
    <article class="ma-karte">
      <div class="ma-kopf">
        <span class="ma-ic" style={{ background: m.farbe, color: textfarbe }} aria-hidden="true">
          {KUERZEL[m.anbieter]}
        </span>
        <div style={{ minWidth: 0 }}>
          <b>{m.rolle}</b>
          <span>{m.name}</span>
        </div>
      </div>
      <div class="ma-zeile">
        <Pill ton={st.ton}>
          {m.status === 'arbeitet' && <span class="puls" style={{ '--puls': 'var(--info)', width: 7, height: 7 }} />}
          {st.text}
        </Pill>
        <Pill ton={m.zugang === 'abo' ? 'gold' : ''}>{ZUGANG_TEXT[m.zugang]}</Pill>
      </div>
      {m.status === 'wartend_limit' && m.limit_bis && (
        <div class="zeitstempel">Wieder verfügbar {relativeZeit(m.limit_bis)}</div>
      )}
      {m.aktuelle_aufgabe && <div class="ma-aufgabe" title={m.aktuelle_aufgabe}>{m.aktuelle_aufgabe}</div>}
      <div class="zeitstempel reihe" style={{ gap: 5 }}>
        <Clock size={12} aria-hidden="true" />
        {m.status_bestaetigt_am ? `Zuletzt bestätigt ${relativeZeit(m.status_bestaetigt_am)}` : 'Noch keine Statusmeldung'}
        {veraltet && m.status_bestaetigt_am && <Pill ton="warn">veraltet</Pill>}
      </div>
      {ausfuehrlich && <div class="zeitstempel">Arbeitsweg: {ARBEITSWEG_TEXT[m.arbeitsweg]}</div>}
    </article>
  );
}
