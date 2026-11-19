// The long-poll hub (sync-wake.ts): one listener's NOTIFYs fanned out to the waiting requests,
// bounded by a cap, with deadlines, and a health ping that cuts waits short while the listener is deaf.
import { describe, expect, it } from 'vitest';
import { SyncWake, type SyncWakeSource } from './sync-wake';

/** timers a test steps by hand */
function manualClock() {
  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    timers: {
      set: (fn: () => void, ms: number): unknown => { const id = ++seq; due.set(id, { at: now + ms, fn }); return id; },
      clear: (handle: unknown): void => { due.delete(handle as number); },
    },
    advance(ms: number): void {
      const until = now + ms;
      for (;;) {
        const next = [...due.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        due.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = until;
    },
  };
}

/** a source whose listen and pings the test controls */
function fakeSource() {
  const pings: string[] = [];
  let onNotify: (p: string) => void = () => {};
  let onListen: () => void = () => {};
  const source: SyncWakeSource = {
    listen: async (n, l) => { onNotify = n; onListen = l; },
    ping: async (p) => { pings.push(p); },
  };
  return { source, pings, notify: (p: string) => onNotify(p), listened: () => onListen() };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('SyncWake', () => {
  it('wakes the waiters of the notified workspace, and only them', async () => {
    const clock = manualClock();
    const hub = new SyncWake({ maxWaiters: 10, timers: clock.timers, now: clock.now, log: () => {} });
    const a = hub.subscribe(['ws-a'])!;
    const b = hub.subscribe(['ws-b'])!;
    const wa = a.wait(25_000);
    const wb = b.wait(25_000);
    hub.notify('ws-a');
    expect(await wa).toBe('woken');
    clock.advance(25_000);
    expect(await wb).toBe('timeout');
    a.cancel(); b.cancel();
    expect(hub.waiting).toBe(0);
  });

  it('keeps a wake that came between subscribe and wait', async () => {
    const hub = new SyncWake({ maxWaiters: 10, log: () => {} });
    const t = hub.subscribe(['ws-a', 'ws-b'])!;
    hub.notify('ws-b');
    expect(await t.wait(25_000)).toBe('woken');
    t.cancel();
  });

  it('answers an abort at once', async () => {
    const hub = new SyncWake({ maxWaiters: 10, log: () => {} });
    const t = hub.subscribe(['ws-a'])!;
    const ctl = new AbortController();
    const w = t.wait(25_000, ctl.signal);
    ctl.abort();
    expect(await w).toBe('aborted');
    t.cancel();
    const pre = hub.subscribe(['ws-a'])!;
    expect(await pre.wait(25_000, AbortSignal.abort())).toBe('aborted');
    pre.cancel();
  });

  it('caps the waiters, and a cancelled ticket gives its slot back', () => {
    const hub = new SyncWake({ maxWaiters: 2, log: () => {} });
    const one = hub.subscribe(['a'])!;
    const two = hub.subscribe(['b'])!;
    expect(hub.subscribe(['c'])).toBeNull();
    one.cancel();
    one.cancel(); // twice is harmless
    expect(hub.waiting).toBe(1);
    const three = hub.subscribe(['c']);
    expect(three).not.toBeNull();
    two.cancel(); three!.cancel();
    hub.notify('a'); // nobody left: nothing to do
    expect(hub.waiting).toBe(0);
  });

  it('is healthy once it listens, wakes everyone on a (re)listen, and turns deaf when a ping does not come back', async () => {
    const clock = manualClock();
    const fake = fakeSource();
    const lines: string[] = [];
    const hub = new SyncWake({ maxWaiters: 10, source: fake.source, timers: clock.timers, now: clock.now, pingMs: 30_000, pongMs: 5_000, log: (l) => lines.push(l) });
    hub.start();
    hub.start(); // idempotent
    await flush();
    expect(hub.healthy).toBe(false);
    const t = hub.subscribe(['ws-a'])!;
    const w = t.wait(25_000);
    fake.listened();
    expect(hub.healthy).toBe(true);
    expect(await w).toBe('woken'); // a fresh LISTEN may have missed a commit: re-read
    t.cancel();

    // the ping goes out and comes back: still healthy
    clock.advance(30_000);
    expect(fake.pings).toHaveLength(1);
    fake.notify(fake.pings[0]!);
    clock.advance(5_200);
    expect(hub.healthy).toBe(true);

    // the next ping is lost: deaf, and a waiter is told to re-read
    const t2 = hub.subscribe(['ws-a'])!;
    const w2 = t2.wait(60_000);
    clock.advance(30_000);
    expect(hub.healthy).toBe(false);
    expect(await w2).toBe('woken');
    t2.cancel();
    expect(lines.some((l) => l.includes('missed its ping'))).toBe(true);

    // a later ping that comes back makes it healthy again (the next tick sends it at 90 s)
    clock.advance(25_000);
    fake.notify(fake.pings.at(-1)!);
    expect(hub.healthy).toBe(true);
  });

  it('ignores a ping that is not its own', () => {
    const fake = fakeSource();
    const hub = new SyncWake({ maxWaiters: 1, source: fake.source, log: () => {} });
    hub.notify('ping:someone-else:1');
    expect(hub.healthy).toBe(false);
  });
});
