import { afterEach, expect, it, vi } from 'vitest';
import { RelayOwnership, type RelayLease, type RelayLeaseApi } from './ownership.js';

const owners: RelayOwnership[] = [];
afterEach(async () => { for (const owner of owners.splice(0)) await owner.stop(); vi.useRealTimers(); });
function fixture(take?: RelayLeaseApi['take']) {
  let clock = 0;
  const lost = vi.fn(); const release = vi.fn(async () => {});
  const api: RelayLeaseApi = { take: take ?? vi.fn(async holder => ({ held: true, holder, ttlMs: 30_000, generation: 1 })), release };
  const owner = new RelayOwnership(api, () => false, lost, () => clock); owners.push(owner);
  return { owner, lost, api, release, advance: (ms: number) => { clock += ms; } };
}
it('does no backend work while idle and counts the validity duration from before a delayed RPC', async () => {
  vi.useFakeTimers(); const f = fixture();
  await vi.advanceTimersByTimeAsync(60_000); expect(f.api.take).not.toHaveBeenCalled();
  expect(await f.owner.ensure()).toBe(true);
  f.advance(28_999); expect(f.owner.canServe()).toBe(true);
  f.advance(1); expect(f.owner.canServe()).toBe(false);
});
it('cannot forward after an event-loop pause even before its expiry timer runs', async () => {
  const f = fixture(); await f.owner.ensure(); f.advance(60_000);
  expect(f.owner.canServe()).toBe(false);
});
it('never activates a grant that arrives after release, and orders release after the pending RPC', async () => {
  let finish!: (value: RelayLease) => void; let requestedHolder = '';
  const f = fixture(holder => { requestedHolder = holder; return new Promise(resolve => { finish = resolve; }); });
  const acquiring = f.owner.ensure(); await Promise.resolve();
  const releasing = f.owner.release();
  finish({ held: true, holder: requestedHolder, ttlMs: 30_000, generation: 1 });
  expect(await acquiring).toBe(false); await releasing;
  expect(f.owner.canServe()).toBe(false); expect(f.release).toHaveBeenCalledWith(requestedHolder);
});
it('refuses delayed, malformed and foreign-owner answers', async () => {
  for (const mode of ['late', 'malformed', 'foreign'] as const) {
    const f = fixture(async holder => {
      if (mode === 'late') f.advance(30_000);
      return { held: true, holder: mode === 'foreign' ? 'other' : holder, ttlMs: mode === 'malformed' ? NaN : 30_000, generation: 1 };
    });
    expect(await f.owner.ensure()).toBe(false); expect(f.owner.canServe()).toBe(false);
  }
});
it('fences live sockets when a renewal fails and cannot revive a stopped owner', async () => {
  vi.useFakeTimers(); const lost = vi.fn(); let fail = false;
  const api = { take: vi.fn(async (holder: string) => { if (fail) throw Error('API unavailable'); return { held: true, holder, ttlMs: 30_000, generation: 1 }; }), release: vi.fn(async () => {}) };
  const owner = new RelayOwnership(api, () => true, lost); owners.push(owner);
  expect(await owner.ensure()).toBe(true); fail = true;
  await vi.advanceTimersByTimeAsync(10_000); expect(owner.canServe()).toBe(false); expect(lost).toHaveBeenCalledTimes(1);
  await owner.stop(); fail = false;
  expect(await owner.ensure()).toBe(false);
});
