/**
 * Echtzeit-Verteiler (Pflichtenheft 4.2 „möglichst in Echtzeit“).
 * Ein einziges SQLite-basiertes Durable Object (Free-Tarif) hält die WebSocket-Verbindungen aller
 * Geräte mit Hibernation – es kostet nur, wenn tatsächlich eine Nachricht verteilt wird.
 * Inhalt der Nachrichten: nur „etwas hat sich geändert“ + Pfad, keine Daten. Die Geräte laden
 * daraufhin über die normale, berechtigte API nach.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { cronAusfuehren } from './cron';
import { laeufeAbarbeiten } from './lib/automatik';

/** Takt der zeitgesteuerten Aufgaben (wie bisher „*\/15 * * * *“). */
export const TAKT_MS = 15 * 60 * 1000;

/** Nächster Viertelstunden-Zeitpunkt nach `ab` (00, 15, 30, 45). */
export function naechsterTakt(ab: number): number {
  return Math.floor(ab / TAKT_MS) * TAKT_MS + TAKT_MS;
}

/**
 * Zweite Rolle derselben Klasse (eigene Instanz „takt“): Taktgeber per Alarm.
 * - alle 15 Minuten die zeitgesteuerten Aufgaben (cron.ts) – der Free-Tarif erlaubt nur 5 Cron-Trigger
 *   je Konto (durch andere TE-Apps belegt), Durable-Object-Alarme zählen dort nicht mit
 * - sofort nach „anstossen“: wartende Automatik-Läufe abarbeiten (Workers AI, GitHub-Start).
 *   Alarme dürfen bis zu 15 Minuten laufen – genug für eine KI-Antwort, anders als waitUntil.
 * Eigene Instanz, damit die Automatik den Echtzeit-Verteiler („zentrale“) normal ansprechen kann.
 */
export class ZentraleLive extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Ping/Pong ohne das Objekt aufzuwecken
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private async alsTakt(): Promise<void> {
    await this.ctx.storage.put('rolle', 'takt');
    if ((await this.ctx.storage.get<number>('takt')) === undefined) await this.ctx.storage.put('takt', naechsterTakt(Date.now()));
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm((await this.ctx.storage.get<number>('takt'))!);
  }

  override async alarm(): Promise<void> {
    if ((await this.ctx.storage.get('rolle')) !== 'takt') return; // nur die Takt-Instanz arbeitet
    const jetzt = Date.now();
    let faellig = await this.ctx.storage.get<number>('takt');
    const taktJetzt = faellig === undefined || jetzt >= faellig - 1000;
    if (taktJetzt) {
      faellig = naechsterTakt(jetzt);
      await this.ctx.storage.put('takt', faellig);
    }
    // Zuerst neu planen – fällt ein Lauf aus, läuft der Takt trotzdem weiter
    await this.ctx.storage.setAlarm(faellig!);
    try {
      const weitere = await laeufeAbarbeiten(this.env);
      if (weitere) await this.ctx.storage.setAlarm(Date.now() + 1000);
    } catch (e) {
      console.error('Automatik', e);
    }
    if (taktJetzt) console.log('Takt', JSON.stringify(await cronAusfuehren(this.env)));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/takt' || url.pathname === '/anstossen') {
      await this.alsTakt();
      if (url.pathname === '/anstossen') await this.ctx.storage.setAlarm(Date.now());
      return Response.json({ naechster: new Date((await this.ctx.storage.getAlarm()) ?? 0).toISOString() });
    }
    if (url.pathname === '/senden' && request.method === 'POST') {
      const text = await request.text();
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(text);
        } catch {
          /* Verbindung bereits geschlossen */
        }
      }
      return new Response(null, { status: 204 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Erwartet WebSocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(): Promise<void> {
    /* Clients senden nur „ping“ (automatisch beantwortet) */
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'Ende');
    } catch {
      /* bereits zu */
    }
  }
}

function stub(env: Env, name: string): DurableObjectStub {
  // EU-Jurisdiktion: das Objekt läuft und speichert ausschließlich in der EU
  let ns: DurableObjectNamespace = env.LIVE;
  try {
    ns = env.LIVE.jurisdiction('eu');
  } catch {
    /* lokal (Miniflare) ggf. nicht unterstützt */
  }
  return ns.get(ns.idFromName(name));
}

export function liveStub(env: Env): DurableObjectStub {
  return stub(env, 'zentrale');
}

export function taktStub(env: Env): DurableObjectStub {
  return stub(env, 'takt');
}

/** Wartende Automatik-Läufe sofort abarbeiten lassen (statt bis zum nächsten Takt zu warten). */
export async function automatikAnstossen(env: Env): Promise<void> {
  try {
    await taktStub(env).fetch('https://takt/anstossen', { method: 'POST' });
  } catch (e) {
    console.error('Automatik nicht erreichbar', e);
  }
}

export async function liveSenden(env: Env, nachricht: Record<string, unknown>): Promise<void> {
  try {
    await liveStub(env).fetch('https://live/senden', {
      method: 'POST',
      body: JSON.stringify({ ...nachricht, zeit: new Date().toISOString() }),
    });
  } catch (e) {
    console.error('Live-Verteilung fehlgeschlagen', e);
  }
}
