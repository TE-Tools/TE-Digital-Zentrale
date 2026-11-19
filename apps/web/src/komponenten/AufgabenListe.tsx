import { Link2 } from 'lucide-preact';
import { relativeZeit } from '../lib/format';
import { AUFGABEN_STATUS, PRIORITAET } from '../lib/texte';
import type { AufgabeKurz } from '../lib/typen';
import { Pill } from './Bausteine';

export function AufgabenListe({ aufgaben, ohneProjekt = false }: { aufgaben: AufgabeKurz[]; ohneProjekt?: boolean }) {
  return (
    <ul class="aufgaben-liste">
      {aufgaben.map((a) => {
        const st = AUFGABEN_STATUS[a.status];
        const pr = PRIORITAET[a.prioritaet];
        return (
          <li key={a.id}>
            <a class="aufgabe-zeile" href={`/aufgaben/${a.id}`} style={{ '--akzent': a.projekt_farbe }}>
              <span class="leiste" aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <div class="titel">
                  <span class="id">{a.id}</span>
                  {a.titel}
                </div>
                <div class="meta">
                  {!ohneProjekt && <span>{a.projekt_name}</span>}
                  <span>{a.zustaendig_rolle ? `${a.zustaendig_rolle} · ${a.zustaendig_name}` : 'Nicht zugewiesen'}</span>
                  <span>aktualisiert {relativeZeit(a.aktualisiert_am)}</span>
                  {a.offene_abhaengigkeiten > 0 && (
                    <span class="reihe" style={{ gap: 3 }}>
                      <Link2 size={12} aria-hidden="true" /> wartet auf {a.offene_abhaengigkeiten}
                    </span>
                  )}
                </div>
              </div>
              <div class="rechts">
                <Pill ton={st.ton}>{st.text}</Pill>
                {(a.prioritaet === 'hoch' || a.prioritaet === 'kritisch') && <Pill ton={pr.ton}>{pr.text}</Pill>}
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
