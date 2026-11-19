import { useState } from 'preact/hooks';
import { startRegistration } from '@simplewebauthn/browser';
import { GitBranch, KeyRound, LogOut, Monitor, Moon, Sun } from 'lucide-preact';
import { Karte, Pill } from '../komponenten/Bausteine';
import { GithubVerbindung } from '../komponenten/GithubVerbindung';
import { KiZugaenge } from '../komponenten/KiZugaenge';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { datum, relativeZeit } from '../lib/format';
import { useKopf } from '../lib/kopf';
import { type ThemaWahl, themaLesen, themaSetzen } from '../lib/theme';
import type { Benutzer } from '../lib/typen';

interface PasskeyListe {
  passkeys: { id: string; geraet: string | null; erstellt_am: string; zuletzt_am: string | null }[];
  offeneCodes: number;
}

export function Einstellungen({ benutzer, abgemeldet }: { benutzer: Benutzer; abgemeldet: () => void }) {
  useKopf('Einstellungen & Verwaltung', 'Verwaltung');
  const [thema, setThema] = useState<ThemaWahl>(themaLesen());
  const pk = useDaten<PasskeyListe>('/auth/passkeys', 0);
  const [meldung, setMeldung] = useState<string | null>(null);

  const waehle = (t: ThemaWahl) => {
    themaSetzen(t);
    setThema(t);
  };

  async function passkeyHinzufuegen() {
    setMeldung(null);
    try {
      const geraet = prompt('Name des neuen Geräts (z. B. „iPad“):')?.trim();
      if (geraet === undefined) return;
      const { challengeId, optionen } = await api.post<{ challengeId: string; optionen: any }>('/auth/passkey/optionen');
      const antwort = await startRegistration({ optionsJSON: optionen });
      await api.post('/auth/passkey/abschluss', { challengeId, antwort, geraet });
      setMeldung('Passkey hinzugefügt.');
      void pk.neuLaden();
    } catch (e) {
      setMeldung(e instanceof ApiFehler ? e.message : 'Abgebrochen oder nicht möglich.');
    }
  }

  async function abmelden() {
    await api.post('/auth/abmelden').catch(() => undefined);
    try {
      localStorage.removeItem('te-cache:auth');
      localStorage.removeItem('te-cache:dashboard');
    } catch {
      /* ignorieren */
    }
    abgemeldet();
  }

  const THEMEN: { wert: ThemaWahl; text: string; Icon: typeof Sun }[] = [
    { wert: 'system', text: 'Wie System', Icon: Monitor },
    { wert: 'hell', text: 'Hell', Icon: Sun },
    { wert: 'dunkel', text: 'Dunkel', Icon: Moon },
  ];

  return (
    <div class="raster">
      <div class="sp-6">
        <Karte titel="Darstellung" kicker="Persönlich">
          <div class="reihe" role="radiogroup" aria-label="Farbschema">
            {THEMEN.map(({ wert, text, Icon }) => (
              <button key={wert} role="radio" aria-checked={thema === wert} class={`btn btn-sm ${thema === wert ? 'btn-primary' : 'btn-ghost'}`} onClick={() => waehle(wert)}>
                <Icon size={16} aria-hidden="true" /> {text}
              </button>
            ))}
          </div>
        </Karte>
        <div class="abstand" />
        <Karte titel="Konto" kicker="Sitzung">
          <dl class="daten">
            <dt>Name</dt>
            <dd>{benutzer.name}</dd>
            <dt>Rolle</dt>
            <dd>{benutzer.rolle === 'gf' ? 'Geschäftsführung (alle Rechte)' : 'Lesezugriff'}</dd>
          </dl>
          <div class="abstand" />
          <button class="btn btn-ghost" onClick={abmelden}>
            <LogOut size={17} aria-hidden="true" /> Abmelden
          </button>
        </Karte>
      </div>

      <div class="sp-6">
        <Karte titel="Passkeys" kicker="Sicherheit">
          {pk.daten && (
            <>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {pk.daten.passkeys.map((p) => (
                  <li key={p.id} class="hinweis" style={{ alignItems: 'center' }}>
                    <KeyRound size={18} aria-hidden="true" />
                    <p style={{ flex: 1 }}>
                      <b>{p.geraet || 'Gerät'}</b>
                      <br />
                      <span class="zeitstempel">angelegt {datum(p.erstellt_am)} · zuletzt {relativeZeit(p.zuletzt_am)}</span>
                    </p>
                  </li>
                ))}
                {pk.daten.passkeys.length === 0 && <li class="zeitstempel">Kein Passkey registriert (lokaler Entwicklungszugang).</li>}
              </ul>
              <p class="zeitstempel" style={{ margin: '12px 0' }}>
                Unbenutzte Wiederherstellungscodes: <Pill ton={pk.daten.offeneCodes > 2 ? 'ok' : 'warn'}>{pk.daten.offeneCodes}</Pill>
              </p>
            </>
          )}
          {benutzer.rolle === 'gf' && (
            <button class="btn btn-primary" onClick={passkeyHinzufuegen}>
              <KeyRound size={17} aria-hidden="true" /> Weiteres Gerät hinzufügen
            </button>
          )}
          {meldung && <p class="zeitstempel" role="status" style={{ marginTop: 10 }}>{meldung}</p>}
        </Karte>
        <div class="abstand" />
        {benutzer.rolle === 'gf' ? (
          <div style={{ display: 'grid', gap: 18 }}>
            <GithubVerbindung />
            <KiZugaenge />
          </div>
        ) : null}
      </div>
    </div>
  );
}
