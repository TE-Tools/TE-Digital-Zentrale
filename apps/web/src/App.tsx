import { useCallback, useEffect, useState } from 'preact/hooks';
import { Ladebalken } from './komponenten/Bausteine';
import { BEREICHE } from './komponenten/navigation';
import { Rahmen } from './komponenten/Rahmen';
import { ApiFehler, api } from './lib/api';
import { useDaten } from './lib/daten';
import { type Kopf, KopfKontext } from './lib/kopf';
import { passt, usePfad } from './lib/router';
import type { AuthStatus, Benutzer, Dashboard as DashboardDaten } from './lib/typen';
import { Anmeldung } from './seiten/Anmeldung';
import { Dashboard } from './seiten/Dashboard';
import { Einstellungen } from './seiten/Einstellungen';
import { MitarbeiterSeite } from './seiten/MitarbeiterSeite';
import { NichtGefunden, Platzhalter } from './seiten/Platzhalter';
import { ProjektDetail } from './seiten/ProjektDetail';
import { Projekte } from './seiten/Projekte';

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const pruefen = useCallback(async () => {
    try {
      setStatus(await api.get<AuthStatus>('/auth/status'));
      setFehler(null);
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : 'Zentrale nicht erreichbar.');
    }
  }, []);

  useEffect(() => void pruefen(), [pruefen]);

  if (!status) {
    return (
      <div style={{ padding: 24 }}>
        {fehler ? (
          <p class="hinweis krit">
            {fehler} <button class="btn btn-ghost btn-sm" onClick={pruefen}>Erneut versuchen</button>
          </p>
        ) : (
          <Ladebalken />
        )}
      </div>
    );
  }

  if (!status.angemeldet || !status.benutzer) return <Anmeldung status={status} fertig={pruefen} />;
  return <Angemeldet benutzer={status.benutzer} abgemeldet={pruefen} />;
}

function Angemeldet({ benutzer, abgemeldet }: { benutzer: Benutzer; abgemeldet: () => void }) {
  const pfad = usePfad();
  const [kopf, setKopf] = useState<Kopf>({ titel: 'Dashboard' });
  const [projekteVersion, setProjekteVersion] = useState(0);
  const projekteGeaendert = useCallback(() => setProjekteVersion((v) => v + 1), []);
  // Dashboard-Daten auch für die Freigaben-Badges im Rahmen; Polling 60 s (Free-Tarif sparsam)
  const dash = useDaten<DashboardDaten>('/dashboard', 60_000, projekteVersion);

  // Sitzung abgelaufen → zurück zur Anmeldung
  useEffect(() => {
    if (dash.fehler?.status === 401) abgemeldet();
  }, [dash.fehler, abgemeldet]);

  let seite;
  let m: Record<string, string> | null;
  if (pfad === '/') seite = <Dashboard benutzer={benutzer} daten={dash.daten} fehler={dash.fehler?.message ?? null} />;
  else if (pfad === '/mitarbeiter') seite = <MitarbeiterSeite />;
  else if (pfad === '/projekte') seite = <Projekte benutzer={benutzer} geaendert={projekteGeaendert} />;
  else if ((m = passt('/projekte/:slug', pfad))) seite = <ProjektDetail key={m.slug} slug={m.slug!} benutzer={benutzer} geaendert={projekteGeaendert} />;
  else if (pfad === '/einstellungen') seite = <Einstellungen benutzer={benutzer} abgemeldet={abgemeldet} />;
  else if (pfad === '/aufgaben/neu') seite = <Platzhalter titel="Neuer Auftrag" phase={3} />;
  else {
    const b = BEREICHE.find((x) => x.pfad === pfad && x.phase);
    seite = b ? <Platzhalter titel={b.text} phase={b.phase!} /> : <NichtGefunden />;
  }

  return (
    <KopfKontext.Provider value={setKopf}>
      <Rahmen
        pfad={pfad}
        benutzer={benutzer}
        titel={kopf.titel}
        kicker={kopf.kicker}
        offeneFreigaben={dash.daten?.zahlen.offene_freigaben}
        projekteVersion={projekteVersion}
      >
        {seite}
      </Rahmen>
    </KopfKontext.Provider>
  );
}
