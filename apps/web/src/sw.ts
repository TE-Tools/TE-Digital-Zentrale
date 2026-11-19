/// <reference lib="webworker" />
/**
 * Service Worker der TE-Digital Zentrale
 * - Offline-Hülle (App-Dateien vorgehalten; API-Daten bewusst nicht – immer zentraler Stand)
 * - Web Push anzeigen und beim Antippen die passende Seite öffnen
 * - Teilen-Ziel (Android): geteilten Text aus ChatGPT/Gemini/Grok annehmen, ohne ihn in die URL zu schreiben
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// ------------------------------------------------------------------ Teilen-Ziel

const GETEILT_CACHE = 'te-geteilt';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/teilen') {
    event.respondWith(
      (async () => {
        const daten = await event.request.formData();
        const inhalt = {
          titel: String(daten.get('title') ?? ''),
          text: String(daten.get('text') ?? ''),
          url: String(daten.get('url') ?? ''),
          zeit: new Date().toISOString(),
        };
        const cache = await caches.open(GETEILT_CACHE);
        await cache.put('/geteilt', new Response(JSON.stringify(inhalt), { headers: { 'content-type': 'application/json' } }));
        return Response.redirect('/teilen?geteilt=1', 303);
      })(),
    );
  }
});

// ------------------------------------------------------------------ Push

interface PushDaten {
  titel: string;
  text: string;
  url: string;
  kategorie: 'kritisch' | 'wichtig' | 'tagesbericht';
  tag?: string;
}

self.addEventListener('push', (event) => {
  let d: PushDaten;
  try {
    d = event.data?.json() as PushDaten;
  } catch {
    d = { titel: 'TE-Digital Zentrale', text: event.data?.text() ?? '', url: '/', kategorie: 'wichtig' };
  }
  event.waitUntil(
    self.registration.showNotification(d.titel, {
      body: d.text,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: d.tag,
      data: { url: d.url },
      requireInteraction: d.kategorie === 'kritisch',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const roh = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  // Nur Ziele der eigenen App öffnen
  const ziel = new URL(roh, self.location.origin);
  const url = ziel.origin === self.location.origin ? ziel.href : self.location.origin + '/';
  event.waitUntil(
    (async () => {
      const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const f of fenster) {
        if (new URL(f.url).origin === self.location.origin && 'focus' in f) {
          await f.focus();
          await (f as WindowClient).navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// Browser hat das Abo erneuert → beim Server nachtragen
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as Event & { oldSubscription?: PushSubscription; waitUntil(p: Promise<unknown>): void };
  e.waitUntil(
    (async () => {
      const schluessel = e.oldSubscription?.options.applicationServerKey;
      if (!schluessel) return;
      const neu = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: schluessel });
      await fetch('/api/benachrichtigungen/abo', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-te-anfrage': '1' },
        body: JSON.stringify({ ...neu.toJSON(), geraet: '' }),
      });
    })(),
  );
});
