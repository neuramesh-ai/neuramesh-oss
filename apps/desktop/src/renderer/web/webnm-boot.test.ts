// THE BOOT READ, PINNED — a reload paints from what this browser already knows.
//
// bootstrap gates the whole shell (App.tsx holds the splash until it answers), so on the web it
// used to hold every reload behind two sequential round trips, and an unreachable server held the
// splash up forever over a replica full of rows. These pin the replacement: the last membership
// list answers the first call, the server is asked behind it, an offline poll keeps the answer
// standing, and the 1.5 s poll stops costing two requests and a new object every time.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { bootOverrides } from './webnm-boot';
import { postCommand } from './webnm';

const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g['localStorage'] = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};
g['window'] = { location: { pathname: '/acme', search: '' }, history: { replaceState: () => {} }, addEventListener: () => {} };
g['document'] = { visibilityState: 'visible', addEventListener: () => {} };

const cfg = {
  apiUrl: 'http://api.test',
  powersyncUrl: '',
  clerkSessionId: async (): Promise<string | null> => null,
  clerkBearer: async (): Promise<string | null> => null,
  relayBearer: async (): Promise<string | null> => null,
  actorId: () => 'u1',
  workspaceId: () => store.get('nm:web:workspaceId') ?? '',
};

const ACME = { id: 'w-acme', name: 'Acme', slug: 'acme', onboarded: true };
type Boot = { needsOnboarding: boolean; workspaceId?: string; workspaces?: unknown[]; invites?: unknown[] };
const arm = () => bootOverrides(cfg as never) as unknown as { bootstrap: () => Promise<Boot>; processList: () => Promise<unknown> };

/** a control-api stand-in. `gate` holds every response until released, so a test can tell a read
 *  that WAITED for the server from one that did not. */
function api(opts: { workspaces?: unknown[]; offline?: boolean } = {}) {
  const calls: Array<{ path: string; at: number }> = [];
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  let held = false;
  globalThis.fetch = (async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, at: calls.length });
    if (held) await gate;
    if (opts.offline) throw new TypeError('Failed to fetch');
    const body = path === '/v1/workspaces' ? { workspaces: opts.workspaces ?? [ACME] } : path === '/v1/invites/mine' ? { invites: [] } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { calls, hold: () => { held = true; }, release: () => open(), set offline(v: boolean) { opts.offline = v; } };
}

beforeEach(() => store.clear());

describe('web bootstrap', () => {
  test('a first visit waits for the server, reads both lists at once, and remembers the answer', async () => {
    const s = api();
    const b = await arm().bootstrap();
    assert.equal(b.workspaceId, 'w-acme');
    assert.equal(b.needsOnboarding, false);
    assert.deepEqual(s.calls.map((c) => c.path).sort(), ['/v1/invites/mine', '/v1/workspaces']);
    assert.ok(store.get('nm:web:boot:u1'), 'the membership list is kept for the next load');
  });

  test('a reload answers from the kept list without waiting, and asks the server behind it', async () => {
    api();
    await arm().bootstrap();
    const s = api();
    s.hold(); // the server is slow now: a read that waits for it loses the race below
    const b = await Promise.race([arm().bootstrap(), new Promise<'waited'>((r) => setTimeout(() => r('waited'), 300))]);
    s.release();
    assert.notEqual(b, 'waited', 'the reload waited for the server');
    assert.equal((b as Boot).workspaceId, 'w-acme');
    assert.equal(s.calls.filter((c) => c.path === '/v1/workspaces').length, 1, 'the refresh went out');
  });

  test('a kept answer from the middle of the wizard is not trusted — onboarding waits for the server', async () => {
    api({ workspaces: [{ ...ACME, onboarded: false }] });
    await arm().bootstrap();
    const s = api({ workspaces: [ACME] });
    const b = await arm().bootstrap();
    assert.equal(b.needsOnboarding, false, 'the server answer, not the kept one');
    assert.ok(s.calls.length >= 1);
  });

  test('offline: the answer the page stands on keeps standing instead of throwing', async () => {
    const s = api();
    const boot = arm();
    await boot.bootstrap();
    s.offline = true;
    // a command ends the fresh window, so the next poll really asks the server
    await postCommand(cfg as never, { type: 'noop' }).catch(() => {});
    const b = await boot.bootstrap();
    assert.equal(b.workspaceId, 'w-acme');
  });

  test('a fresh answer is reused, and returned as the same object', async () => {
    const s = api();
    const boot = arm();
    const a = await boot.bootstrap();
    const n = s.calls.length;
    const b = await boot.bootstrap();
    assert.equal(s.calls.length, n, 'no request inside the fresh window');
    assert.equal(a, b);
  });

  test('a command ends the fresh window: the next poll asks the server', async () => {
    const s = api();
    const boot = arm();
    await boot.bootstrap();
    const reads = () => s.calls.filter((c) => c.path === '/v1/workspaces').length;
    const before = reads();
    await postCommand(cfg as never, { type: 'workspace.accept_invite', invite: 'i1' });
    await boot.bootstrap();
    assert.equal(reads(), before + 1);
  });

  test('processList answers one object, so the 3 s poll stores nothing new', async () => {
    const boot = arm();
    assert.equal(await boot.processList(), await boot.processList());
  });
});
