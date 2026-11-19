import { useState } from 'preact/hooks';
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Check, Copy, KeyRound, LifeBuoy, ShieldCheck, Smartphone, Wrench } from 'lucide-preact';
import { ApiFehler, api } from '../lib/api';
import type { AuthStatus } from '../lib/typen';
import { MarkenKachel } from '../komponenten/Marke';

type Ansicht = 'start' | 'wiederherstellung';

function fehlerText(e: unknown): string {
  if (e instanceof ApiFehler) return e.message;
  if (e instanceof Error && e.name === 'NotAllowedError') return 'Der Vorgang wurde abgebrochen oder ist abgelaufen.';
  if (e instanceof Error && e.name === 'InvalidStateError') return 'Dieser Passkey ist bereits registriert.';
  return 'Das hat nicht geklappt. Bitte erneut versuchen.';
}

export function Anmeldung({ status, fertig }: { status: AuthStatus; fertig: () => void }) {
  const [ansicht, setAnsicht] = useState<Ansicht>('start');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const webauthn = browserSupportsWebAuthn();

  async function ausfuehren(fn: () => Promise<void>) {
    setFehler(null);
    setLaeuft(true);
    try {
      await fn();
    } catch (e) {
      setFehler(fehlerText(e));
    } finally {
      setLaeuft(false);
    }
  }

  const einrichten = (e: Event) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    void ausfuehren(async () => {
      const { challengeId, optionen } = await api.post<{ challengeId: string; optionen: any }>('/auth/einrichtung/optionen', {
        name: String(f.get('name') ?? ''),
        einrichtungscode: String(f.get('code') ?? ''),
      });
      const antwort = await startRegistration({ optionsJSON: optionen });
      const r = await api.post<{ wiederherstellungscodes: string[] }>('/auth/einrichtung/abschluss', {
        challengeId,
        antwort,
        geraet: String(f.get('geraet') ?? ''),
      });
      setCodes(r.wiederherstellungscodes);
    });
  };

  const anmelden = () =>
    ausfuehren(async () => {
      const { challengeId, optionen } = await api.post<{ challengeId: string; optionen: any }>('/auth/anmelden/optionen');
      const antwort = await startAuthentication({ optionsJSON: optionen });
      await api.post('/auth/anmelden/abschluss', { challengeId, antwort });
      fertig();
    });

  const wiederherstellen = (e: Event) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    void ausfuehren(async () => {
      await api.post('/auth/wiederherstellung', { code: String(f.get('code') ?? '') });
      fertig();
    });
  };

  const devAnmelden = () =>
    ausfuehren(async () => {
      await api.post('/auth/dev-anmeldung');
      fertig();
    });

  return (
    <div class="anmeldung">
      <aside class="anm-marke">
        <div class="anm-marke-inhalt">
          <div class="reihe">
            <MarkenKachel groesse={40} />
            <span class="anm-wort">TE-Digital</span>
          </div>
          <p class="kicker" style={{ marginTop: 40 }}>Unternehmenszentrale</p>
          <h1>
            Weniger Chaos.
            <br />
            <em>Mehr Überblick.</em>
          </h1>
          <p class="anm-sub">KI-Mitarbeiter, Projekte, Aufgaben und Freigaben – an einem Ort, auf Handy, Tablet und PC.</p>
          <ul class="anm-fakten">
            <li><Check size={15} aria-hidden="true" /> Daten in der EU</li>
            <li><Check size={15} aria-hidden="true" /> Anmeldung per Passkey, ohne Passwort</li>
            <li><Check size={15} aria-hidden="true" /> Keine kostenpflichtigen KI-APIs</li>
          </ul>
        </div>
      </aside>

      <main class="anm-formular">
        <div class="anm-karte karte">
          <div class="karte-inhalt">
            {codes ? (
              <CodesAnzeigen codes={codes} weiter={fertig} />
            ) : !status.eingerichtet ? (
              <form onSubmit={einrichten} class="anm-stapel">
                <div>
                  <p class="kicker">Ersteinrichtung</p>
                  <h2>Zugang der Geschäftsführung anlegen</h2>
                  <p class="anm-text">Einmalig mit dem Einrichtungscode. Danach melden Sie sich nur noch mit Face ID, Fingerabdruck oder Windows Hello an.</p>
                </div>
                <label class="feld">
                  <span>Ihr Name</span>
                  <input class="eingabe" name="name" required minLength={2} maxLength={60} autoComplete="name" />
                </label>
                <label class="feld">
                  <span>Einrichtungscode</span>
                  <input class="eingabe" name="code" required minLength={8} type="password" autoComplete="off" />
                </label>
                <label class="feld">
                  <span>Name dieses Geräts</span>
                  <input class="eingabe" name="geraet" maxLength={60} placeholder="z. B. iPhone, Büro-PC" />
                </label>
                {fehler && <p class="feld-fehler" role="alert">{fehler}</p>}
                <button class="btn btn-primary btn-block" disabled={laeuft || !webauthn}>
                  <KeyRound size={18} aria-hidden="true" /> Passkey erstellen
                </button>
              </form>
            ) : ansicht === 'start' ? (
              <div class="anm-stapel">
                <div>
                  <p class="kicker">Anmelden</p>
                  <h2>Willkommen zurück</h2>
                  <p class="anm-text">Melden Sie sich mit dem Passkey dieses Geräts an.</p>
                </div>
                {fehler && <p class="feld-fehler" role="alert">{fehler}</p>}
                <button class="btn btn-primary btn-block" onClick={anmelden} disabled={laeuft || !webauthn}>
                  <ShieldCheck size={18} aria-hidden="true" /> Mit Passkey anmelden
                </button>
                <button class="btn btn-text" onClick={() => setAnsicht('wiederherstellung')}>
                  <LifeBuoy size={16} aria-hidden="true" /> Wiederherstellungscode verwenden
                </button>
              </div>
            ) : (
              <form onSubmit={wiederherstellen} class="anm-stapel">
                <div>
                  <p class="kicker">Wiederherstellung</p>
                  <h2>Mit Code anmelden</h2>
                  <p class="anm-text">Jeder Code funktioniert nur einmal. Legen Sie danach in den Einstellungen einen neuen Passkey an.</p>
                </div>
                <label class="feld">
                  <span>Wiederherstellungscode</span>
                  <input class="eingabe" name="code" required placeholder="XXXX-XXXX-XXXX" autoComplete="one-time-code" style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '.08em' }} />
                </label>
                {fehler && <p class="feld-fehler" role="alert">{fehler}</p>}
                <button class="btn btn-primary btn-block" disabled={laeuft}>Anmelden</button>
                <button type="button" class="btn btn-text" onClick={() => setAnsicht('start')}>Zurück</button>
              </form>
            )}

            {!webauthn && !codes && (
              <p class="hinweis warn" style={{ marginTop: 16 }}>
                <Smartphone size={18} aria-hidden="true" />
                <span>Dieser Browser unterstützt keine Passkeys. Bitte einen aktuellen Browser verwenden.</span>
              </p>
            )}

            {status.devLogin && !codes && (
              <div class="anm-dev">
                <button class="btn btn-ghost btn-sm btn-block" onClick={devAnmelden} disabled={laeuft}>
                  <Wrench size={15} aria-hidden="true" /> Lokal anmelden (nur Entwicklung)
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function CodesAnzeigen({ codes, weiter }: { codes: string[]; weiter: () => void }) {
  const [gesichert, setGesichert] = useState(false);
  const [kopiert, setKopiert] = useState(false);
  return (
    <div class="anm-stapel">
      <div>
        <p class="kicker">Wichtig</p>
        <h2>Wiederherstellungscodes sichern</h2>
        <p class="anm-text">Falls Ihr Gerät verloren geht, kommen Sie damit wieder hinein. Jeder Code gilt einmal. Sie werden nur jetzt angezeigt.</p>
      </div>
      <ol class="codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(codes.join('\n'));
            setKopiert(true);
          } catch {
            /* Zwischenablage nicht erlaubt */
          }
        }}
      >
        <Copy size={15} aria-hidden="true" /> {kopiert ? 'Kopiert' : 'Alle kopieren'}
      </button>
      <label class="reihe" style={{ fontSize: 14 }}>
        <input type="checkbox" checked={gesichert} onChange={(e) => setGesichert((e.target as HTMLInputElement).checked)} />
        Ich habe die Codes sicher aufbewahrt.
      </label>
      <button class="btn btn-primary btn-block" disabled={!gesichert} onClick={weiter}>Zur Zentrale</button>
    </div>
  );
}
