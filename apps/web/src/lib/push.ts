import { api } from './api';

export type PushZustand =
  | { art: 'nicht_unterstuetzt'; grund: string }
  | { art: 'ios_installieren' }
  | { art: 'blockiert' }
  | { art: 'aus' }
  | { art: 'an'; endpoint: string };

export function istIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function istInstalliert(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function vonBase64url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function pushZustand(): Promise<PushZustand> {
  if (!('serviceWorker' in navigator)) return { art: 'nicht_unterstuetzt', grund: 'Dieser Browser hat keinen Service Worker.' };
  if (istIos() && !istInstalliert()) return { art: 'ios_installieren' };
  if (!('PushManager' in window) || !('Notification' in window)) {
    return { art: 'nicht_unterstuetzt', grund: 'Dieser Browser unterstützt keine Push-Benachrichtigungen.' };
  }
  if (Notification.permission === 'denied') return { art: 'blockiert' };
  const reg = await navigator.serviceWorker.getRegistration();
  const abo = await reg?.pushManager.getSubscription();
  return abo ? { art: 'an', endpoint: abo.endpoint } : { art: 'aus' };
}

export function geraeteName(): string {
  const ua = navigator.userAgent;
  const system = /Android/.test(ua) ? 'Android' : istIos() ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Gerät';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${system}${browser ? ' · ' + browser : ''}`;
}

/** Fragt die Berechtigung (muss aus einem Klick heraus geschehen) und meldet das Gerät an. */
export async function pushAktivieren(vapidSchluessel: string): Promise<void> {
  const erlaubnis = await Notification.requestPermission();
  if (erlaubnis !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt.');
  const reg = await navigator.serviceWorker.ready;
  let abo = await reg.pushManager.getSubscription();
  // Abo mit anderem Server-Schlüssel (z. B. nach Schlüsselwechsel) ersetzen
  if (abo) {
    const alt = abo.options.applicationServerKey ? new Uint8Array(abo.options.applicationServerKey) : null;
    const neu = vonBase64url(vapidSchluessel);
    if (!alt || alt.length !== neu.length || alt.some((b, i) => b !== neu[i])) {
      await abo.unsubscribe();
      abo = null;
    }
  }
  abo ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vonBase64url(vapidSchluessel) });
  await api.post('/benachrichtigungen/abo', { ...abo.toJSON(), geraet: geraeteName() });
}

export async function pushDeaktivieren(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const abo = await reg?.pushManager.getSubscription();
  if (!abo) return;
  await api.post('/benachrichtigungen/abo/abmelden', { endpoint: abo.endpoint }).catch(() => undefined);
  await abo.unsubscribe();
}
