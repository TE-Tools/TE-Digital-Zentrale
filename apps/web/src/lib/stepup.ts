import { startAuthentication } from '@simplewebauthn/browser';
import { ApiFehler, api } from './api';

let devLogin = false;
export function setzeDevLogin(wert: boolean): void {
  devLogin = wert;
}

/** Fragt den Passkey erneut ab (Step-up für Stufe-3-Aktionen). */
export async function passkeyBestaetigen(): Promise<void> {
  if (devLogin) {
    await api.post('/auth/dev-anmeldung');
    return;
  }
  const { challengeId, optionen } = await api.post<{ challengeId: string; optionen: any }>('/auth/anmelden/optionen');
  const antwort = await startAuthentication({ optionsJSON: optionen });
  await api.post('/auth/anmelden/abschluss', { challengeId, antwort });
}

/** Führt eine Aktion aus und holt bei Bedarf vorher die Passkey-Bestätigung ein. */
export async function mitBestaetigung<T>(aktion: () => Promise<T>): Promise<T> {
  try {
    return await aktion();
  } catch (e) {
    if (e instanceof ApiFehler && e.code === 'bestaetigung_noetig') {
      await passkeyBestaetigen();
      return aktion();
    }
    throw e;
  }
}
