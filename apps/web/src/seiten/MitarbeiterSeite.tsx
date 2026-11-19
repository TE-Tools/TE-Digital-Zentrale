import { AlertTriangle, Info } from 'lucide-preact';
import { Karte, Ladebalken } from '../komponenten/Bausteine';
import { MitarbeiterKarte } from '../komponenten/Mitarbeiter';
import { useDaten } from '../lib/daten';
import { useKopf } from '../lib/kopf';
import type { Mitarbeiter } from '../lib/typen';

export function MitarbeiterSeite() {
  useKopf('KI-Mitarbeiter', 'Team');
  const { daten, fehler } = useDaten<{ mitarbeiter: Mitarbeiter[] }>('/mitarbeiter');
  if (!daten) return fehler ? <p class="hinweis krit"><AlertTriangle size={18} />{fehler.message}</p> : <Ladebalken />;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div class="hinweis info">
        <Info size={18} aria-hidden="true" />
        <p>
          <b>Arbeitsweise:</b> Claude Code (Abo) greift ab Phase 5 direkt auf die Zentrale zu. ChatGPT, Gemini und Grok arbeiten über
          kostenlose Web-Zugänge mit Übergabepaketen. Ist ein Kontingent aufgebraucht, wird die Aufgabe pausiert und später ab dem letzten
          Zwischenstand fortgesetzt (Statuspflege ab Phase 3).
        </p>
      </div>
      <Karte titel="Besetzung" kicker="Organisation laut Pflichtenheft">
        <div class="ma-liste" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {daten.mitarbeiter.map((m) => (
            <MitarbeiterKarte m={m} ausfuehrlich key={m.id} />
          ))}
        </div>
      </Karte>
    </div>
  );
}
