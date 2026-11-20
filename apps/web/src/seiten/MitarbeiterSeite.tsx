import { useState } from 'preact/hooks';
import { AUTOMATIK_TEXT } from '../komponenten/Automatik';
import { AlertTriangle, Info } from 'lucide-preact';
import { Karte, Ladebalken, Pill } from '../komponenten/Bausteine';
import { Dialog } from '../komponenten/Dialog';
import { MitarbeiterKarte } from '../komponenten/Mitarbeiter';
import { toast } from '../komponenten/Toast';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { useKopf } from '../lib/kopf';
import { zuLokalFeld } from '../lib/texte';
import type { Benutzer, Mitarbeiter } from '../lib/typen';

type MitZahlen = Mitarbeiter & { offene_aufgaben: number; erledigte_aufgaben: number };

export function MitarbeiterSeite({ benutzer }: { benutzer: Benutzer }) {
  useKopf('KI-Mitarbeiter', 'Team');
  const { daten, fehler, neuLaden } = useDaten<{ mitarbeiter: MitZahlen[] }>('/mitarbeiter');
  const [limitFuer, setLimitFuer] = useState<MitZahlen | null>(null);
  if (!daten) return fehler ? <p class="hinweis krit"><AlertTriangle size={18} />{fehler.message}</p> : <Ladebalken />;
  const gf = benutzer.rolle === 'gf';

  async function setzen(m: MitZahlen, status: string, limit_bis?: string) {
    try {
      await api.post(`/mitarbeiter/${m.id}/status`, { status, limit_bis });
      toast(`${m.rolle}: Status gespeichert`);
      await neuLaden();
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Fehler');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div class="hinweis info">
        <Info size={18} aria-hidden="true" />
        <p>
          <b>Arbeitsweise:</b> <b>Automatisch</b> (ohne Kopieren) arbeiten Claude Code – auf GitHub mit Ihrem Claude-Abo – und der Assistent
          (Workers AI, kostenlos im eigenen Cloudflare-Konto). ChatGPT, Gemini und Grok arbeiten über kostenlose Web-Zugänge mit Übergabepaketen
          – nur während Sie das Paket im Chat einfügen. Ist ein Kontingent aufgebraucht, pausiert die Aufgabe; automatische Mitarbeiter machen danach selbst weiter.
        </p>
      </div>
      <Karte titel="Besetzung" kicker="Organisation laut Pflichtenheft">
        <div class="ma-liste" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))' }}>
          {daten.mitarbeiter.map((m) => (
            <div key={m.id} style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
              <MitarbeiterKarte m={m} ausfuehrlich />
              <div class="reihe" style={{ gap: 6, fontSize: 12.5 }}>
                <a href={`/aufgaben?zustaendig=${m.id}`} class="zeitstempel">{m.offene_aufgaben} offen · {m.erledigte_aufgaben} erledigt →</a>
                {m.automatik ? <Pill ton="ok" titel={AUTOMATIK_TEXT[m.automatik]}>arbeitet automatisch</Pill> : <Pill>per Kopieren</Pill>}
              </div>
              {gf && m.anbieter !== 'flexibel' && (
                <div class="reihe" style={{ gap: 6 }}>
                  <button class="btn btn-ghost btn-sm" onClick={() => setzen(m, 'verfuegbar')}>Verfügbar</button>
                  <button class="btn btn-ghost btn-sm" onClick={() => setLimitFuer(m)}>Limit erreicht</button>
                  <button class="btn btn-text btn-sm" onClick={() => setzen(m, 'pausiert')}>Pausieren</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Karte>
      {limitFuer && (
        <LimitStatusDialog
          m={limitFuer}
          schliessen={() => setLimitFuer(null)}
          speichern={async (bis) => {
            await setzen(limitFuer, 'wartend_limit', bis);
            setLimitFuer(null);
          }}
        />
      )}
    </div>
  );
}

function LimitStatusDialog({ m, schliessen, speichern }: { m: Mitarbeiter; schliessen: () => void; speichern: (bis: string) => Promise<void> }) {
  const [bis, setBis] = useState(zuLokalFeld(new Date(Date.now() + 3 * 3_600_000).toISOString()));
  return (
    <Dialog titel={`${m.name}: Limit erreicht`} schliessen={schliessen}>
      <p class="anm-text" style={{ margin: 0 }}>
        Gilt für den Mitarbeiter allgemein. Für eine laufende Aufgabe besser direkt in der Aufgabe „Limit erreicht“ wählen – dann wird auch der Zwischenstand gesichert.
      </p>
      <label class="feld">
        <span>Wieder verfügbar ab</span>
        <input class="eingabe" type="datetime-local" value={bis} onInput={(e) => setBis((e.target as HTMLInputElement).value)} />
      </label>
      <div class="reihe">
        <button class="btn btn-primary" onClick={() => speichern(new Date(bis).toISOString())}>Speichern</button>
        <button class="btn btn-ghost" onClick={schliessen}>Abbrechen</button>
      </div>
    </Dialog>
  );
}
