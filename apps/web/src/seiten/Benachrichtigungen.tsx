import { useEffect, useState } from 'preact/hooks';
import { BellOff, BellRing, CheckCheck, Inbox, Save, Send, Smartphone, Trash2 } from 'lucide-preact';
import { Auswahl } from '../komponenten/Auswahl';
import { Karte, Ladebalken, Leer, Pill } from '../komponenten/Bausteine';
import { toast } from '../komponenten/Toast';
import { ApiFehler, api } from '../lib/api';
import { useDaten } from '../lib/daten';
import { relativeZeit } from '../lib/format';
import { useKopf } from '../lib/kopf';
import { pushAktivieren, pushDeaktivieren, pushZustand, type PushZustand } from '../lib/push';

interface Einstellungen {
  kritisch: 'sofort' | 'aus';
  wichtig: 'sofort' | 'gebuendelt' | 'aus';
  tagesbericht: number;
  tagesbericht_zeit: string;
  ruhe_von: string | null;
  ruhe_bis: string | null;
}
interface Geraet { id: number; geraet: string; dienst: string; erstellt_am: string; zuletzt_ok: string | null; fehler_zahl: number; endpoint_ende: string }
interface Meldung { id: number; kategorie: 'kritisch' | 'wichtig' | 'tagesbericht'; titel: string; text: string; url: string; erstellt_am: string; push_status: string; gelesen_am: string | null }

const KAT = { kritisch: { text: 'Kritisch', ton: 'krit' }, wichtig: { text: 'Wichtig', ton: 'gold' }, tagesbericht: { text: 'Tagesbericht', ton: 'info' } } as const;
const PUSH_STATUS: Record<string, string> = {
  gesendet: 'per Push zugestellt',
  gebuendelt: 'gebündelt zugestellt',
  offen: 'wartet (Ruhezeit/Bündel)',
  unterdrueckt: 'ohne Push',
  kein_geraet: 'kein Gerät angemeldet',
};

export function Benachrichtigungen({ gelesen }: { gelesen: () => void }) {
  useKopf('Benachrichtigungen', 'Push & Posteingang');
  const cfg = useDaten<{ einstellungen: Einstellungen; vapidSchluessel: string; geraete: Geraet[] }>('/benachrichtigungen/einstellungen', 0);
  const liste = useDaten<{ benachrichtigungen: Meldung[]; ungelesen: number }>('/benachrichtigungen');
  const [geraet, setGeraet] = useState<PushZustand | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const pruefen = () => pushZustand().then(setGeraet, () => setGeraet({ art: 'nicht_unterstuetzt', grund: 'Prüfung fehlgeschlagen.' }));
  useEffect(() => void pruefen(), []);

  async function aktivieren() {
    if (!cfg.daten) return;
    setLaeuft(true);
    try {
      await pushAktivieren(cfg.daten.vapidSchluessel);
      toast('Push auf diesem Gerät aktiv');
      await Promise.all([pruefen(), cfg.neuLaden()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Nicht möglich');
    } finally {
      setLaeuft(false);
    }
  }

  async function deaktivieren() {
    setLaeuft(true);
    await pushDeaktivieren();
    toast('Push auf diesem Gerät aus');
    await Promise.all([pruefen(), cfg.neuLaden()]);
    setLaeuft(false);
  }

  async function test() {
    try {
      const r = await api.post<{ zugestellt: number }>('/benachrichtigungen/test');
      toast(r.zugestellt ? `Test an ${r.zugestellt} Gerät(e) gesendet` : 'Kein Gerät erreichbar');
    } catch (e) {
      toast(e instanceof ApiFehler ? e.message : 'Fehler');
    }
  }

  async function alleGelesen() {
    await api.post('/benachrichtigungen/gelesen', {});
    await liste.neuLaden();
    gelesen();
  }

  return (
    <div class="raster">
      <div class="sp-5" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <Karte titel="Dieses Gerät" kicker="Push">
          {!geraet ? (
            <Ladebalken />
          ) : geraet.art === 'an' ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div class="hinweis ok"><BellRing size={18} aria-hidden="true" /><p><b>Push ist aktiv.</b> Dieses Gerät erhält Meldungen nach den Einstellungen unten.</p></div>
              <div class="reihe">
                <button class="btn btn-ghost btn-sm" onClick={test}><Send size={16} aria-hidden="true" /> Testnachricht</button>
                <button class="btn btn-text btn-sm" disabled={laeuft} onClick={deaktivieren}><BellOff size={16} aria-hidden="true" /> Auf diesem Gerät abschalten</button>
              </div>
            </div>
          ) : geraet.art === 'aus' ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <p class="anm-text" style={{ margin: 0 }}>Meldungen kommen als Push aufs Handy – Freigaben, fertige Ergebnisse, Limit-Ende und der Tagesbericht.</p>
              <div><button class="btn btn-primary" disabled={laeuft || !cfg.daten} onClick={aktivieren}><BellRing size={17} aria-hidden="true" /> Push aktivieren</button></div>
            </div>
          ) : geraet.art === 'ios_installieren' ? (
            <div class="hinweis info">
              <Smartphone size={18} aria-hidden="true" />
              <p>
                <b>iPhone/iPad:</b> Push funktioniert nur, wenn die Zentrale zum Home-Bildschirm hinzugefügt ist (ab iOS 16.4). In Safari auf
                „Teilen“ → „Zum Home-Bildschirm“ tippen, die Zentrale von dort öffnen und hier aktivieren.
              </p>
            </div>
          ) : geraet.art === 'blockiert' ? (
            <div class="hinweis warn">
              <BellOff size={18} aria-hidden="true" />
              <p><b>Im Browser blockiert.</b> Bitte in den Website-Einstellungen des Browsers Benachrichtigungen für die Zentrale erlauben.</p>
            </div>
          ) : (
            <div class="hinweis warn"><BellOff size={18} aria-hidden="true" /><p>{geraet.grund}</p></div>
          )}
        </Karte>

        {cfg.daten && <EinstellungenKarte e={cfg.daten.einstellungen} fertig={cfg.neuLaden} />}

        <Karte titel="Angemeldete Geräte" kicker="Push-Empfänger">
          {!cfg.daten ? <Ladebalken /> : cfg.daten.geraete.length === 0 ? (
            <p class="textblock leer">Noch kein Gerät angemeldet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {cfg.daten.geraete.map((g) => (
                <li key={g.id} class="hinweis" style={{ alignItems: 'center' }}>
                  <Smartphone size={18} aria-hidden="true" />
                  <p style={{ flex: 1 }}>
                    <b>{g.geraet || 'Gerät'}</b>
                    <br />
                    <span class="zeitstempel">
                      {g.dienst} · seit {relativeZeit(g.erstellt_am)} · zuletzt zugestellt {relativeZeit(g.zuletzt_ok)}
                      {g.fehler_zahl > 0 ? ` · ${g.fehler_zahl} Fehlversuche` : ''}
                    </span>
                  </p>
                  <button
                    class="btn btn-text btn-sm"
                    aria-label="Gerät entfernen"
                    onClick={async () => {
                      await api.post('/benachrichtigungen/abo/abmelden', { id: g.id });
                      await Promise.all([cfg.neuLaden(), pruefen()]);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Karte>
      </div>

      <div class="sp-7">
        <Karte titel="Posteingang" kicker="Alle Meldungen">
          {liste.daten && liste.daten.ungelesen > 0 && (
            <button class="btn btn-text btn-sm" style={{ marginBottom: 8 }} onClick={alleGelesen}>
              <CheckCheck size={16} aria-hidden="true" /> Alle als gelesen markieren ({liste.daten.ungelesen})
            </button>
          )}
          {!liste.daten ? <Ladebalken /> : liste.daten.benachrichtigungen.length === 0 ? (
            <Leer Icon={Inbox} titel="Noch keine Meldungen" text="Hier landen alle Meldungen – auch die, die ohne Push zugestellt wurden." />
          ) : (
            <ul class="verlauf">
              {liste.daten.benachrichtigungen.map((m) => (
                <li key={m.id} class={`nachricht ${m.gelesen_am ? '' : 'ungelesen'}`}>
                  <a href={m.url} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                    <div class="nachricht-kopf">
                      <Pill ton={KAT[m.kategorie].ton}>{KAT[m.kategorie].text}</Pill>
                      <b>{m.titel}</b>
                      <span style={{ marginLeft: 'auto' }}>{relativeZeit(m.erstellt_am)}</span>
                    </div>
                    {m.text && <div class="nachricht-text">{m.text}</div>}
                    <div class="zeitstempel" style={{ marginTop: 4 }}>{PUSH_STATUS[m.push_status] ?? m.push_status}</div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Karte>
      </div>
    </div>
  );
}

function EinstellungenKarte({ e, fertig }: { e: Einstellungen; fertig: () => Promise<void> }) {
  const [ruhe, setRuhe] = useState(!!e.ruhe_von);
  const [fehler, setFehler] = useState<string | null>(null);

  async function speichern(ev: Event) {
    ev.preventDefault();
    const f = new FormData(ev.target as HTMLFormElement);
    const t = (k: string) => String(f.get(k) ?? '');
    try {
      await api.put('/benachrichtigungen/einstellungen', {
        kritisch: t('kritisch'),
        wichtig: t('wichtig'),
        tagesbericht: f.get('tagesbericht') === 'on',
        tagesbericht_zeit: t('tagesbericht_zeit'),
        ruhe_von: ruhe ? t('ruhe_von') : null,
        ruhe_bis: ruhe ? t('ruhe_bis') : null,
      });
      setFehler(null);
      toast('Einstellungen gespeichert');
      await fertig();
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : 'Fehler');
    }
  }

  return (
    <Karte titel="Kategorien & Häufigkeit" kicker="Einstellungen">
      <form onSubmit={speichern} style={{ display: 'grid', gap: 12 }}>
        <label class="feld">
          <span>Kritisch</span>
          <Auswahl class="eingabe" name="kritisch" defaultValue={e.kritisch}>
            <option value="sofort">Sofort (auch in der Ruhezeit)</option>
            <option value="aus">Aus</option>
          </Auswahl>
          <small>Sicherheitsprobleme, blockierte wichtige Aufgaben, dringende Freigaben.</small>
        </label>
        <label class="feld">
          <span>Wichtig</span>
          <Auswahl class="eingabe" name="wichtig" defaultValue={e.wichtig}>
            <option value="sofort">Sofort</option>
            <option value="gebuendelt">Gebündelt (stündlich)</option>
            <option value="aus">Aus</option>
          </Auswahl>
          <small>Fertige Ergebnisse, Freigabeanträge, Rückfragen, Limit-Ende.</small>
        </label>
        <div class="formular-raster">
          <label class="reihe" style={{ fontSize: 14 }}>
            <input type="checkbox" name="tagesbericht" defaultChecked={!!e.tagesbericht} /> Tagesbericht
          </label>
          <label class="feld">
            <span>um</span>
            <input class="eingabe" type="time" name="tagesbericht_zeit" defaultValue={e.tagesbericht_zeit} required />
          </label>
        </div>
        <label class="reihe" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={ruhe} onChange={(ev) => setRuhe((ev.target as HTMLInputElement).checked)} /> Ruhezeit (wichtige Meldungen warten bis zum Ende)
        </label>
        {ruhe && (
          <div class="formular-raster">
            <label class="feld"><span>von</span><input class="eingabe" type="time" name="ruhe_von" defaultValue={e.ruhe_von ?? '22:00'} required /></label>
            <label class="feld"><span>bis</span><input class="eingabe" type="time" name="ruhe_bis" defaultValue={e.ruhe_bis ?? '07:00'} required /></label>
          </div>
        )}
        <p class="zeitstempel" style={{ margin: 0 }}>Für eigene Aktionen gibt es keinen Push – sie stehen nur im Posteingang. Zeiten in deutscher Zeit.</p>
        {fehler && <p class="feld-fehler">{fehler}</p>}
        <div><button class="btn btn-primary btn-sm"><Save size={16} aria-hidden="true" /> Speichern</button></div>
      </form>
    </Karte>
  );
}
