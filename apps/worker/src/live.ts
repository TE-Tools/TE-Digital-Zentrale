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

/** Takt der zeitgesteuerten Aufgaben (wie bisher „*\/15 * * * *“). */
export const TAKT_MS = 15 * 60 * 1000;

/** Nächster Viertelstunden-Zeitpunkt nach `ab` (00, 15, 30, 45). */
export function naechsterTakt(ab: number): number {
  return Math.floor(ab / TAKT_MS) * TAKT_MS + TAKT_MS;
}

/**
 * Zusätzlich übernimmt das Objekt den Takt der zeitgesteuerten Aufgaben per Alarm:
 * Der Free-Tarif erlaubt nur 5 Cron-Trigger je Konto (bereits durch andere TE-Apps belegt),
 * Durable-Object-Alarme zählen dort nicht mit und sind kostenlos.
 */
export class ZentraleLive extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Ping/Pong ohne das Objekt aufzuwecken
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    // Takt sicherstellen, sobald das Objekt irgendwann geweckt wird (Alarme überdauern Deploys)
    this.ctx.blockConcurrencyWhile(() => this.taktSichern());
  }

  private async taktSichern(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(naechsterTakt(Date.now()));
  }

  override async alarm(): Promise<void> {
    // Zuerst neu planen – fällt ein Lauf aus, läuft der Takt trotzdem weiter
    await this.ctx.storage.setAlarm(naechsterTakt(Date.now()));
    const stats = await cronAusfuehren(this.env);
    console.log('Takt', JSON.stringify(stats));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/takt') {
      await this.taktSichern();
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

export function liveStub(env: Env): DurableObjectStub {
  // EU-Jurisdiktion: das Objekt läuft und speichert ausschließlich in der EU
  let ns: DurableObjectNamespace = env.LIVE;
  try {
    ns = env.LIVE.jurisdiction('eu');
  } catch {
    /* lokal (Miniflare) ggf. nicht unterstützt */
  }
  return ns.get(ns.idFromName('zentrale'));
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
