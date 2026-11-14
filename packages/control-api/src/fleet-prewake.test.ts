// The speculative wake's rules without a database (fleet-prewake.ts, fleet-wake-wait.ts): the route's
// gates and order, the rate limit, the outcome, the knobs, and the wait classes. The SQL half (breaker,
// credits, the sweep's short timeout) runs on real postgres in test/prewake.pg.test.ts.
import type { Actor } from '@neuramesh/shared';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrewakeLimiter, prewakeIdleMin, prewakeMinIntervalSec, prewakeOn, prewakeOutcome, prewakeRoutes, type PrewakeResult } from './fleet-prewake';
import { classifyWakeStart } from './fleet-wake-wait';
import type { Store } from './store';

const KEYS = ['NM_PREWAKE', 'NM_PREWAKE_IDLE_MIN', 'NM_PREWAKE_MIN_INTERVAL_SEC'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const WS = '00000000-0000-4000-8000-0000000000a1';
const WOKEN: PrewakeResult = { outcome: 'woken', woken: ['m1'], awake: [], held: [] };

function mkApp(opts: { actor?: Actor; members?: string[]; sql?: boolean; prewake?: () => Promise<PrewakeResult>; limiter?: PrewakeLimiter } = {}) {
  const app = new Hono<{ Variables: { actor: Actor } }>();
  app.use('/v1/*', async (c, next) => { c.set('actor', opts.actor ?? { kind: 'human', id: 'u1' }); await next(); });
  const calls: Array<{ ws: string; user: string }> = [];
  const store = {
    humanMemberIds: async () => opts.members ?? ['u1'],
    ...(opts.sql === false ? {} : { sql: {} }),
  } as unknown as Store;
  prewakeRoutes(app, store, {
    prewake: async (_sql, ws, user) => { calls.push({ ws, user }); return opts.prewake ? opts.prewake() : WOKEN; },
    limiter: opts.limiter ?? new PrewakeLimiter(30_000),
  });
  const post = (body: unknown) => app.request('/v1/machines/prewake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { post, calls };
}

describe('POST /v1/machines/prewake', () => {
  it('needs a workspace, a person and a member, and reaches the wake for none of the others', async () => {
    expect((await mkApp().post({})).status).toBe(400);
    const agent = mkApp({ actor: { kind: 'agent', id: 'a1', role: 'worker' } as Actor });
    expect((await agent.post({ workspace: WS })).status).toBe(403);
    const stranger = mkApp({ members: ['someone-else'] });
    expect((await stranger.post({ workspace: WS })).status).toBe(403);
    expect([...agent.calls, ...stranger.calls]).toEqual([]);
  });

  it('wakes the caller\'s targets and answers the outcome with the speculative window', async () => {
    const { post, calls } = mkApp();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await post({ workspace: WS, surface: 'desk', thread: 't1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...WOKEN, speculativeMin: 5 });
    expect(calls).toEqual([{ ws: WS, user: 'u1' }]);
    expect(log.mock.calls.flat().join('\n')).toMatch(/machine_prewake workspace=\S+ user=u1 surface=desk outcome=woken woken=\[m1\]/);
    log.mockRestore();
  });

  it('is rate-limited per person and workspace: the second call inside the window reaches nothing', async () => {
    let now = 1_000_000;
    const limiter = new PrewakeLimiter(30_000);
    const take = limiter.take.bind(limiter);
    limiter.take = (key: string) => take(key, now);
    const { post, calls } = mkApp({ limiter });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await (await post({ workspace: WS })).json()).toMatchObject({ outcome: 'woken' });
    now += 29_999;
    expect(await (await post({ workspace: WS })).json()).toMatchObject({ ok: true, outcome: 'rate_limited', woken: [] });
    // another workspace is its own budget
    expect(await (await post({ workspace: '00000000-0000-4000-8000-0000000000a2' })).json()).toMatchObject({ outcome: 'woken' });
    now += 1;
    expect(await (await post({ workspace: WS })).json()).toMatchObject({ outcome: 'woken' });
    expect(calls).toHaveLength(3);
    vi.restoreAllMocks();
  });

  it('NM_PREWAKE=off: a no-op that says so', async () => {
    process.env['NM_PREWAKE'] = 'off';
    const { post, calls } = mkApp();
    expect(await (await post({ workspace: WS })).json()).toMatchObject({ ok: true, outcome: 'disabled' });
    expect(calls).toEqual([]);
  });

  it('501 on a store with no postgres', async () => {
    expect((await mkApp({ sql: false }).post({ workspace: WS })).status).toBe(501);
  });
});

describe('the limiter', () => {
  it('lets one call through per interval and key', () => {
    const l = new PrewakeLimiter(1000);
    expect(l.take('a', 0)).toBe(true);
    expect(l.take('a', 999)).toBe(false);
    expect(l.take('b', 999)).toBe(true);
    expect(l.take('a', 1000)).toBe(true);
  });

  it('stays bounded: a full map drops expired keys first, then the oldest', () => {
    const l = new PrewakeLimiter(1000, 2);
    expect(l.take('a', 0)).toBe(true);
    expect(l.take('b', 500)).toBe(true);
    expect(l.take('c', 1200)).toBe(true); // 'a' expired and goes
    expect(l.take('b', 1300)).toBe(false); // 'b' is still inside its interval
    expect(l.take('d', 1400)).toBe(true); // nothing expired: the oldest goes
    expect((l as unknown as { last: Map<string, number> }).last.size).toBe(2);
  });
});

describe('the outcome', () => {
  const r = (id: string, was: number, o: Partial<{ looped: boolean; funded: boolean; woken: boolean }> = {}) => ({ id, was, looped: false, funded: true, woken: false, ...o });
  it('woken beats everything else', () => {
    expect(prewakeOutcome([r('runner', 1), r('mine', 0, { woken: true })])).toEqual({ outcome: 'woken', woken: ['mine'], awake: ['runner'], held: [] });
  });
  it('awake when nothing was asleep, none when there is no machine', () => {
    expect(prewakeOutcome([r('runner', 1)]).outcome).toBe('awake');
    expect(prewakeOutcome([]).outcome).toBe('none');
  });
  it('capped when the workspace has no credits, held when a breaker is open', () => {
    expect(prewakeOutcome([r('runner', 0, { funded: false })]).outcome).toBe('capped');
    expect(prewakeOutcome([r('runner', 0, { looped: true })])).toEqual({ outcome: 'held', woken: [], awake: [], held: ['runner'] });
  });
});

describe('the knobs', () => {
  it('default on, 5 minutes, 30 seconds; junk reads as the default', () => {
    for (const k of KEYS) delete process.env[k];
    expect([prewakeOn(), prewakeIdleMin(), prewakeMinIntervalSec()]).toEqual([true, 5, 30]);
    process.env['NM_PREWAKE_IDLE_MIN'] = 'soon'; process.env['NM_PREWAKE_MIN_INTERVAL_SEC'] = '-1';
    expect([prewakeIdleMin(), prewakeMinIntervalSec()]).toEqual([5, 30]);
    process.env['NM_PREWAKE_IDLE_MIN'] = '3'; process.env['NM_PREWAKE_MIN_INTERVAL_SEC'] = '10';
    expect([prewakeIdleMin(), prewakeMinIntervalSec()]).toEqual([3, 10]);
  });
});

describe('the wait classes (fleet-wake-wait.ts)', () => {
  const T = Date.parse('2026-11-05T12:00:00Z');
  const at = (s: number) => new Date(T + s * 1000);
  it('cold: the message started the machine', () => {
    expect(classifyWakeStart({ messageAt: at(0), startedAt: at(0.5), speculativeAt: null })).toEqual({ start: 'cold', leadMs: null, upMs: 0 });
    expect(classifyWakeStart({ messageAt: at(0), startedAt: at(-1), speculativeAt: null }).start).toBe('cold');
  });
  it('prewoken: a prewake started this run before the message, with its lead', () => {
    expect(classifyWakeStart({ messageAt: at(0), startedAt: at(-12), speculativeAt: at(-12) })).toEqual({ start: 'prewoken', leadMs: 12_000, upMs: 12_000 });
  });
  it('a later message after the prewake found the machine up: warm, not prewoken', () => {
    expect(classifyWakeStart({ messageAt: at(0), startedAt: at(-60), speculativeAt: at(-60), firstSincePrewake: false }).start).toBe('warm');
  });
  it('an old stamp from an earlier run does not count', () => {
    expect(classifyWakeStart({ messageAt: at(0), startedAt: at(-30), speculativeAt: at(-3600) })).toEqual({ start: 'warm', leadMs: null, upMs: 30_000 });
  });
  it('unknown when the machine has no start', () => {
    expect(classifyWakeStart({ messageAt: at(0), startedAt: null, speculativeAt: null }).start).toBe('unknown');
  });
});
