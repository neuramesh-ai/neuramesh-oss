// THE OPERATIONS LANES, PINNED — and the invariant a second copy of 11 queries needs.
//
// This file's queries are COPIES of the desktop's IPC handlers, for the same reason webnm-board's
// are: the browser has no IPC and no WebContents to send to. That is the right call and it is
// also the whole risk — two texts that must agree, with nothing but discipline holding them
// together. So the parity is a TEST, not a promise: every query in webnm-ops.ts must be,
// character for character modulo whitespace, a query that exists in the handler it was copied
// from. The corpus is asserted FIRST, because a checker that matches nothing reports success.
//
// The rest pins the failure shapes this round exists to end: a lane that silently falls through
// to the warn-once fallback (an empty that is TRUTHY, so a surface renders its "all good" state
// on a broken read), a workspace-wide query missing its `workspace_id = ?` (the replica holds
// every workspace you belong to), a watch whose arguments were written the wrong way round, a
// row-or-null watch handed a truthy empty, and a machine-local write that answers `{ ok: false }`
// where the surface reads a rejection.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { opsOverrides } from './webnm-ops';

const cfg = { apiUrl: '', powersyncUrl: '', clerkSessionId: async () => null, clerkBearer: async () => null, relayBearer: async () => null, actorId: () => 'me-1', workspaceId: () => 'w1' };

interface Call { sql: string; params: unknown[] }

/** a replica stand-in: records what was asked, and lets a test fire the change listener */
function fakeDb(rows: unknown[] | (() => unknown[])) {
  const calls: Call[] = [];
  let fire = () => {};
  const db = {
    getAll: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return typeof rows === 'function' ? rows() : rows;
    },
    onChangeWithCallback: (h: { onChange: () => void }, o: { tables: string[] }) => {
      fire = h.onChange;
      calls.push({ sql: `__tables__ ${o.tables.join(',')}`, params: [] });
      return () => {};
    },
  };
  return { db, calls, change: () => fire() };
}

/** the watch helper's read is async, so a push settles a microtask after it is triggered */
const settle = () => new Promise((r) => setTimeout(r, 0));

const arm = (db: unknown) => opsOverrides(cfg as never, db as never) as unknown as Record<string, (...a: unknown[]) => unknown>;

const LANES = [
  'policies', 'policySet', 'policyDelete', 'modelPacks', 'modelPackSave', 'modelPackDelete',
  'agentInstructions', 'agentInstructionsWrite', 'agentRuns', 'liveRuns', 'watchRuns',
  'watchAgentStream', 'roster', 'watchFailover', 'watchArchivedThreads', 'watchHistoryAll',
  'watchJourney', 'watchReplyCounts', 'computeSharedThreads', 'memory', 'retro', 'launcherIdeas',
];

describe('the settings, brains, crew and watch lanes', () => {
  test('all 22 lanes are ANSWERED — none may fall through to the fallback', () => {
    const ov = arm(fakeDb([]).db);
    assert.equal(LANES.length, 22, 'the lane list changed — the tranche is 22');
    for (const name of LANES) assert.equal(typeof ov[name], 'function', `${name} is unwired — the fallback would answer it with a truthy empty`);
  });

  test('every workspace-wide read scopes by workspace_id — the replica holds every workspace you belong to', async () => {
    for (const name of ['policies', 'liveRuns']) {
      const f = fakeDb([]);
      await arm(f.db)[name]!();
      assert.deepEqual(f.calls.at(-1)!.params, ['w1'], `${name} passed the wrong workspace`);
      assert.ok(f.calls.at(-1)!.sql.includes('workspace_id = ?'), `${name} does not scope by workspace`);
    }
    for (const name of ['watchJourney', 'watchHistoryAll', 'watchArchivedThreads', 'watchFailover']) {
      const f = fakeDb([]);
      const off = arm(f.db)[name]!(() => {}) as () => void;
      await settle();
      off();
      const q = f.calls.find((c) => c.sql.includes('workspace_id = ?'));
      assert.ok(q, `${name} does not scope by workspace`);
      assert.deepEqual(q.params, ['w1'], `${name} passed the wrong workspace`);
    }
  });

  test('roster reads BOTH halves, each scoped, and one broken half does not take the other down', async () => {
    const f = fakeDb([{ id: 'x' }]);
    const r = (await arm(f.db)['roster']!()) as { machines: unknown[]; agents: unknown[] };
    assert.deepEqual(r.machines, [{ id: 'x' }]);
    assert.deepEqual(r.agents, [{ id: 'x' }]);
    assert.ok(f.calls.some((c) => c.sql.includes('from machines')), 'no machines read');
    assert.ok(f.calls.some((c) => c.sql.includes('from agents a')), 'no agents read');
    for (const c of f.calls) assert.deepEqual(c.params, ['w1']);

    const half = { getAll: async (sql: string) => { if (sql.includes('from agents a')) throw new Error('boom'); return [{ id: 'm' }]; }, onChangeWithCallback: () => () => {} };
    const real = console.error;
    console.error = () => {};
    let r2: { machines: unknown[]; agents: unknown[] };
    try { r2 = (await arm(half)['roster']!()) as typeof r2; } finally { console.error = real; }
    assert.deepEqual(r2.machines, [{ id: 'm' }]);
    assert.deepEqual(r2.agents, [], 'the failing half degrades alone');
  });

  test('a channel watch is (channelId, cb) — positional, matching the contract', async () => {
    // the `send` class of bug: an options object here typechecks against Record<string, unknown>
    // and then feeds `undefined` to the query. Partial<NMBridge> is what stops it; this proves it.
    for (const [name, needle] of [['watchRuns', 'from runs r'], ['watchReplyCounts', 'from threads t']] as Array<[string, string]>) {
      const f = fakeDb([{ id: 'r1' }]);
      let got: unknown[] | null = null;
      const off = arm(f.db)[name]!('chan-1', (rows: unknown) => { got = rows as unknown[]; }) as () => void;
      await settle();
      const q = f.calls.find((c) => c.sql.includes(needle));
      assert.ok(q, `${name} does not read ${needle}`);
      assert.deepEqual(q.params, ['chan-1'], 'the channel id must reach the query, not an object');
      assert.deepEqual(got, [{ id: 'r1' }]);
      off();
    }
  });

  test('computeSharedThreads asks about a MEMBER but counts against ME — three params, in order', async () => {
    const f = fakeDb([{ n: 3 }]);
    const r = (await arm(f.db)['computeSharedThreads']!('member-9')) as { count: number };
    assert.deepEqual(f.calls[0]!.params, ['w1', 'member-9', 'me-1'], 'workspace, the member, then the actor');
    assert.deepEqual(r, { count: 3 });
    // no rows is a real answer, and must be 0 rather than NaN
    const empty = fakeDb([]);
    assert.deepEqual(await arm(empty.db)['computeSharedThreads']!('m'), { count: 0 });
  });

  test('watchFailover publishes a ROW OR NULL — never the truthy empty its siblings publish', async () => {
    // handing `cb` the empty array every other watch publishes would be truthy, and the client
    // raises a sticky capacity fly-up over any truthy row.
    const none = fakeDb([]);
    let got: unknown = 'unset';
    const off = arm(none.db)['watchFailover']!((row: unknown) => { got = row; }) as () => void;
    await settle();
    assert.equal(got, null, 'no open failover must be null, not an empty array');
    off();
    const one = fakeDb([{ decision_id: 'd1' }, { decision_id: 'd2' }]);
    const off2 = arm(one.db)['watchFailover']!((row: unknown) => { got = row; }) as () => void;
    await settle();
    assert.deepEqual(got, { decision_id: 'd1' }, 'the single open failover is the first row');
    off2();
  });

  test('a failed re-read leaves the last good rows standing rather than blanking the surface', async () => {
    let ok = true;
    const f = fakeDb(() => { if (!ok) throw new Error('replica hiccup'); return [{ id: 'a' }]; });
    const seen: unknown[][] = [];
    const off = arm(f.db)['watchHistoryAll']!((rows: unknown) => seen.push(rows as unknown[])) as () => void;
    await settle();
    ok = false;
    const real = console.error;
    console.error = () => {};
    try { f.change(); await settle(); } finally { console.error = real; }
    assert.deepEqual(seen, [[{ id: 'a' }]], 'a broken read must not publish an empty list over good rows');
    off();
  });

  test('unsubscribing stops the callback — a late push must not reach a dead surface', async () => {
    const f = fakeDb([{ id: 'a' }]);
    let n = 0;
    const off = arm(f.db)['watchArchivedThreads']!(() => { n++; }) as () => void;
    await settle();
    off();
    f.change();
    await settle();
    assert.equal(n, 1, 'the callback fired after unsubscribe');
  });

  test('a failed policies read SAYS SO and yields empty — never a quiet "no rules"', async () => {
    const f = { getAll: async () => { throw new Error('nope'); }, onChangeWithCallback: () => () => {} };
    const said: unknown[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => { said.push(a[0]); };
    try {
      assert.deepEqual(await arm(f)['policies']!(), []);
      assert.deepEqual(await arm(f)['liveRuns']!(), { runs: [] });
    } finally { console.error = real; }
    assert.equal(said.length, 2, 'a failed read must be reported, not swallowed');
  });

  test('the three HTTP reads carry the workspace, and THROW with the server sentence', async () => {
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => { seen.push(String(u)); return new Response(JSON.stringify({ packs: [] }), { status: 200 }); }) as unknown as typeof fetch;
    try {
      const ov = arm(fakeDb([]).db);
      await ov['modelPacks']!();
      await ov['memory']!('#build');
      await ov['retro']!('week');
    } finally { globalThis.fetch = real; }
    assert.deepEqual(seen, ['/v1/model-packs?workspace=w1', '/v1/memory?workspace=w1&channel=%23build', '/v1/retro?workspace=w1&range=week']);

    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'retro requires the postgres store' }), { status: 501 })) as typeof fetch;
    try {
      await assert.rejects(arm(fakeDb([]).db)['retro']!('week') as Promise<unknown>, /requires the postgres store/);
    } finally { globalThis.fetch = real; }
  });

  test('the five writes are COMMANDS, and a refusal rejects rather than reading as saved', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    let ov = arm(fakeDb([]).db);
    try {
      await ov['policySet']!({ scope: 'workspace', capability: 'exec', selector: {}, verdict: 'ask' });
      await ov['policyDelete']!('p-1');
      await ov['modelPackSave']!({ name: 'mine', roles: {} });
      await ov['modelPackDelete']!('pack-1');
    } finally { globalThis.fetch = real; }
    assert.deepEqual(posted.map((p) => p['type']), ['policy.set', 'policy.delete', 'modelpack.save', 'modelpack.delete']);
    for (const p of posted) assert.equal(p['workspace'], 'w1', 'every command carries the workspace');
    assert.equal(posted[1]!['policyId'], 'p-1', 'policyDelete sends policyId, the name the handler uses');
    assert.equal(posted[3]!['packId'], 'pack-1');

    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'policy is locked' }), { status: 403 })) as typeof fetch;
    ov = arm(fakeDb([]).db);
    try {
      await assert.rejects(ov['policyDelete']!('p-1') as Promise<unknown>, /policy is locked/, 'a refused write must surface');
    } finally { globalThis.fetch = real; }
  });

  test('the machine-local lanes REFUSE rather than fake — and the write rejects', async () => {
    const ov = arm(fakeDb([]).db);
    // nulls, so the overlay falls back to the SYNCED agents.brief instead of rendering the
    // fallback's truthy empty as this agent's instructions
    assert.deepEqual(await ov['agentInstructions']!('rex', 'orchestrator'), { local: null, shipped: null, path: '', prompt: null });
    assert.deepEqual(await ov['agentRuns']!('a-1'), []);
    assert.equal(await ov['launcherIdeas']!('c-1', 'task'), null, 'null is what makes the launcher fall back to its samples');
    // `{ ok: false }` would look exactly like a save here — the overlay ignores `ok`
    await assert.rejects(ov['agentInstructionsWrite']!('rex', 'hi') as Promise<unknown>, /no machine/);
    // a live token stream needs a machine-local transport; the honest answer is a real
    // unsubscribe over a callback that never fires, never an invented stream
    let fired = 0;
    const off = ov['watchAgentStream']!(() => { fired++; }) as () => void;
    assert.equal(typeof off, 'function');
    off();
    assert.equal(fired, 0);
  });

  test('every query is a VERBATIM copy of the handler it came from', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const TICK = '`';
    const QUOTE = String.fromCharCode(39);
    // every backtick string containing `select`, from a file. Deliberately not a query-shaped
    // regex: one of the failed generators matched a LOG TEMPLATE, and a narrower pattern is
    // exactly how it did that.
    const templates = (path: string): string[] => {
      const src = readFileSync(path, 'utf8');
      const out: string[] = [];
      for (let i = 0; i < src.length;) {
        const a = src.indexOf(TICK, i);
        const b = a < 0 ? -1 : src.indexOf(TICK, a + 1);
        if (b < 0) break;
        const body = src.slice(a + 1, b);
        if (/\bselect\b/i.test(body)) out.push(norm(body));
        i = b + 1;
      }
      return out;
    };
    // …and the single-quoted ones. nm:policies is a one-line `'select …'`, not a template, so a
    // backtick-only corpus would miss it — and "no handler carries this query" would be a lie
    // about the checker rather than about the query.
    const quoted = (path: string): string[] => {
      const src = readFileSync(path, 'utf8');
      const out: string[] = [];
      for (let i = 0; ;) {
        const a = src.indexOf(QUOTE + 'select', i);
        if (a < 0) break;
        const b = src.indexOf(QUOTE, a + 1);
        if (b < 0) break;
        out.push(norm(src.slice(a + 1, b)));
        i = b + 1;
      }
      return out;
    };
    const main = join(import.meta.dirname, '../../main');
    const handlers = ['sync.ts', 'sync/ipc/settings.ts', 'sync/ipc/watch-board.ts', 'sync/ipc/watch-rooms.ts', 'sync/ipc/watch-crew.ts', 'sync/ipc/membership.ts', 'sync/ipc/task.ts']
      .flatMap((f) => [...templates(join(main, f)), ...quoted(join(main, f))]);
    const mine = templates(join(import.meta.dirname, 'webnm-ops.ts'));
    // a check that matches nothing reports success — so assert both corpora FIRST
    assert.equal(mine.length, 11, 'the query count changed; this test must be looking at the right file');
    assert.ok(handlers.length > 40, `the handler corpus did not load (${handlers.length})`);
    for (const q of mine) {
      assert.ok(handlers.includes(q), `not verbatim — no handler carries this query:\n  ${q.slice(0, 160)}…`);
    }
  });
});
