import { useCallback, useEffect, useState } from 'preact/hooks';
import { Ladebalken } from './komponenten/Bausteine';
import { BEREICHE } from './komponenten/navigation';
import { Rahmen } from './komponenten/Rahmen';
import { ApiFehler, api } from './lib/api';
import { useDaten } from './lib/daten';
import { type Kopf, KopfKontext } from './lib/kopf';
import { passt, usePfad } from './lib/router';
import type { AuthStatus, Benutzer, Dashboard as DashboardDaten } from './lib/typen';
import { ToastHost } from './komponenten/Toast';
import { setzeDevLogin } from './lib/stepup';
import { Anmeldung } from './seiten/Anmeldung';
import { AufgabeDetail } from './seiten/AufgabeDetail';
import { AufgabeNeu } from './seiten/AufgabeNeu';
import { Aufgaben } from './seiten/Aufgaben';
import { Freigaben } from './seiten/Freigaben';
import { Kommunikation } from './seiten/Kommunikation';
import { Benachrichtigungen } from './seiten/Benachrichtigungen';
import { Teilen } from './seiten/Teilen';
import { Entwicklung } from './seiten/Entwicklung';
import { Wissen, WissenDetail } from './seiten/Wissen';
import { BerichtDetail, Berichte } from './seiten/Berichte';
import { liveBeenden, liveStarten } from './lib/live';
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
      const st = await api.get<AuthStatus>('/auth/status');
      setzeDevLogin(st.devLogin);
      setStatus(st);
      setFehler(null);
      try {
        // Für die Offline-Anzeige: nur Name und Rolle, keine Geheimnisse
        if (st.angemeldet) localStorage.setItem('te-cache:auth', JSON.stringify({ ...st, devLogin: false }));
        else localStorage.removeItem('te-cache:auth');
      } catch {
        /* Speicher gesperrt */
      }
    } catch (e) {
      // Offline: mit dem zuletzt bekannten Anmeldestand weiterarbeiten (nur Anzeige, Änderungen scheitern sauber)
      let gemerkt: AuthStatus | null = null;
      try {
        gemerkt = e instanceof ApiFehler && e.code === 'offline' ? (JSON.parse(localStorage.getItem('te-cache:auth') ?? 'null') as AuthStatus | null) : null;
      } catch {
        gemerkt = null;
      }
      if (gemerkt) setStatus(gemerkt);
      else setFehler(e instanceof ApiFehler ? e.message : 'Zentrale nicht erreichbar.');
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
  const dash = useDaten<DashboardDaten>('/dashboard', 60_000, projekteVersion, 'dashboard');

  // Echtzeit-Verbindung, solange angemeldet
  useEffect(() => {
    liveStarten();
    return () => liveBeenden();
  }, []);

  // Sitzung abgelaufen → zurück zur Anmeldung
  useEffect(() => {
    if (dash.fehler?.status === 401) abgemeldet();
  }, [dash.fehler, abgemeldet]);

  let seite;
  let m: Record<string, string> | null;
  if (pfad === '/') seite = <Dashboard benutzer={benutzer} daten={dash.daten} fehler={dash.daten ? null : dash.fehler?.message ?? null} />;
  else if (pfad === '/mitarbeiter') seite = <MitarbeiterSeite benutzer={benutzer} />;
  else if (pfad === '/aufgaben') seite = <Aufgaben key={location.search} benutzer={benutzer} />;
  else if (pfad === '/kommunikation') seite = <Kommunikation benutzer={benutzer} gelesen={projekteGeaendert} />;
  else if (pfad === '/freigaben') seite = <Freigaben benutzer={benutzer} geaendert={projekteGeaendert} />;
  else if (pfad === '/projekte') seite = <Projekte benutzer={benutzer} geaendert={projekteGeaendert} />;
  else if ((m = passt('/projekte/:slug', pfad))) seite = <ProjektDetail key={m.slug} slug={m.slug!} benutzer={benutzer} geaendert={projekteGeaendert} />;
  else if (pfad === '/wissen') seite = <Wissen key={location.search} benutzer={benutzer} />;
  else if ((m = passt('/wissen/:id', pfad))) seite = <WissenDetail key={m.id + location.search} id={m.id!} benutzer={benutzer} />;
  else if (pfad === '/berichte') seite = <Berichte key={location.search} benutzer={benutzer} />;
  else if ((m = passt('/berichte/:id', pfad))) seite = <BerichtDetail key={m.id} id={m.id!} />;
  else if (pfad === '/entwicklung') seite = <Entwicklung key={location.search} benutzer={benutzer} />;
  else if (pfad === '/benachrichtigungen') seite = <Benachrichtigungen gelesen={projekteGeaendert} />;
  else if (pfad === '/teilen') seite = benutzer.rolle === 'gf' ? <Teilen /> : <NichtGefunden />;
  else if (pfad === '/einstellungen') seite = <Einstellungen benutzer={benutzer} abgemeldet={abgemeldet} />;
  else if (pfad === '/aufgaben/neu') seite = benutzer.rolle === 'gf' ? <AufgabeNeu key={location.search} /> : <NichtGefunden />;
  else if ((m = passt('/aufgaben/:id', pfad))) seite = <AufgabeDetail key={m.id} id={m.id!} benutzer={benutzer} />;
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
        ungelesen={dash.daten?.zahlen.ungelesen}
        meldungen={dash.daten?.zahlen.meldungen_ungelesen}
        stand={dash.stand}
        projekteVersion={projekteVersion}
      >
        {seite}
      </Rahmen>
      <ToastHost />
    </KopfKontext.Provider>
  );
}
