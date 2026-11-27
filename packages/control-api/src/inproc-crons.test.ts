import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseInprocCrons, startInprocCrons } from './inproc-crons';

describe('in-process crons (NM_INPROC_CRONS)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('parses path@seconds lists and refuses anything else out loud', () => {
    expect(parseInprocCrons(undefined)).toEqual([]);
    expect(parseInprocCrons(' ')).toEqual([]);
    expect(parseInprocCrons('/internal/machine-sweep@300, /internal/routines-due@60')).toEqual([
      { path: '/internal/machine-sweep', everyMs: 300_000 },
      { path: '/internal/routines-due', everyMs: 60_000 },
    ]);
    expect(() => parseInprocCrons('/v1/commands@60')).toThrow(/not \/internal/);
    expect(() => parseInprocCrons('/internal/machine-sweep')).toThrow(/not \/internal/);
    expect(() => parseInprocCrons('/internal/machine-sweep@5')).toThrow(/faster than 10s/);
  });

  it('calls each path with the cron secret, never overlapping a pass with itself', async () => {
    vi.useFakeTimers();
    const calls: { path: string; auth: string | null }[] = [];
    let release!: () => void;
    const slow = new Promise<void>((r) => { release = r; });
    const stop = startInprocCrons([{ path: '/internal/machine-sweep', everyMs: 10_000 }], async (path, init) => {
      calls.push({ path, auth: new Headers(init.headers).get('authorization') });
      await slow;
      return new Response('{}');
    }, 'cron-secret');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toEqual([{ path: '/internal/machine-sweep', auth: 'Bearer cron-secret' }]);
    release();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.length).toBe(2);
    stop();
  });

  it('needs CRON_SECRET when anything is configured, and nothing when nothing is', () => {
    expect(() => startInprocCrons([{ path: '/internal/x', everyMs: 10_000 }], () => new Response(), '')).toThrow(/CRON_SECRET/);
    expect(() => startInprocCrons([], () => new Response(), '')).not.toThrow();
  });
});
