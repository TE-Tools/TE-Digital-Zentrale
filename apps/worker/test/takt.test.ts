import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { naechsterTakt, taktStub, TAKT_MS, type ZentraleLive } from '../src/live';
import { anfrage } from './hilfe';

describe('Takt per Durable-Object-Alarm (statt Cron)', () => {
  it('berechnet die nächste Viertelstunde', () => {
    const t = Date.UTC(2026, 10, 19, 11, 7, 30);
    expect(new Date(naechsterTakt(t)).toISOString()).toBe('2026-11-19T11:15:00.000Z');
    expect(naechsterTakt(Date.UTC(2026, 10, 19, 11, 15))).toBe(Date.UTC(2026, 10, 19, 11, 30));
  });

  it('Gesundheitsprüfung startet den Takt, der Alarm plant sich selbst neu', async () => {
    const r = await anfrage('/api/gesundheit');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, takt: true });

    const stub = taktStub(env);
    const geplant = await runInDurableObject(stub, (_o: ZentraleLive, state) => state.storage.getAlarm());
    expect(geplant).not.toBeNull();
    expect(geplant! - Date.now()).toBeLessThanOrEqual(TAKT_MS);

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const danach = await runInDurableObject(stub, (_o: ZentraleLive, state) => state.storage.getAlarm());
    expect(danach).not.toBeNull();
    expect(danach! % TAKT_MS).toBe(0);
  });
});
