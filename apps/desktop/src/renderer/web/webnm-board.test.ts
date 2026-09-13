// THE BOARD LANES, PINNED — and the one invariant a second copy of 14 queries needs.
//
// This file's queries are COPIES of the desktop's IPC handlers. That is the right call (the
// browser has no IPC and no WebContents to send to) and it is also the whole risk: two texts that
// must agree, with nothing but discipline holding them together. Three separate attempts to
// generate them mechanically produced wrong SQL — a command-type extractor that spilled across
// handler boundaries, an extractor that grabbed a log template instead of a query, and a stray
// backtick inside a comment breaking template-literal pairing. So the parity is a TEST, not a
// promise: every query here must be, character for character modulo whitespace, a query that
// exists in the handler it was copied from.
//
// The rest pins the two failure shapes this round was written to end: a lane that silently falls
// through to the warn-once fallback (an empty that is TRUTHY, so a surface renders its "all
// good" state on a broken read), and a watch whose arguments were written the wrong way round —
// `send` was, and would have posted `undefined` as every message body while compiling cleanly.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { boardOverrides } from './webnm-board';

const cfg = { apiUrl: '', powersyncUrl: '', clerkSessionId: async () => null, clerkBearer: async () => null, relayBearer: async () => null, actorId: () => 'u', workspaceId: () => 'w1' };

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

const arm = (db: unknown) => boardOverrides(cfg as never, db as never) as unknown as Record<string, (...a: unknown[]) => unknown>;

const LANES = [
  'watchTasksAll', 'watchTasks', 'watchThreads', 'watchMessages', 'watchThread', 'watchBeats',
  'watchArtifacts', 'watchOpenRuns', 'watchDecisionsAll', 'channelHistory', 'channelPeople',
  'taskDetail', 'alerts',
];

describe('the board, threads and activity lanes', () => {
  test('every lane is ANSWERED — none may fall through to the fallback', () => {
    const ov = arm(fakeDb([]).db);
    for (const name of LANES) assert.equal(typeof ov[name], 'function', `${name} is unwired — the fallback would answer it with a truthy empty`);
  });

  test('a channel watch is (channelId, cb) — positional, matching the contract', async () => {
    // the `send` class of bug: an options object here typechecks against Record<string, unknown>
    // and then feeds `undefined` to the query. Partial<NMBridge> is what stops it; this proves it.
    const f = fakeDb([{ id: 't1' }]);
    let got: unknown[] | null = null;
    const off = arm(f.db)['watchTasks']!('chan-1', (rows: unknown) => { got = rows as unknown[]; }) as () => void;
    await settle();
    const q = f.calls.find((c) => c.sql.includes('from tasks'))!;
    assert.deepEqual(q.params, ['chan-1'], 'the channel id must reach the query, not an object');
    assert.deepEqual(got, [{ id: 't1' }]);
    off();
  });

  test('the workspace-wide watches scope by workspace_id — the replica holds every workspace you belong to', async () => {
    for (const name of ['watchTasksAll', 'watchOpenRuns', 'watchDecisionsAll']) {
      const f = fakeDb([]);
      const off = arm(f.db)[name]!(() => {}) as () => void;
      await settle();
      off();
      const q = f.calls.find((c) => c.sql.includes('workspace_id = ?'))!;
      assert.ok(q, `${name} does not scope by workspace`);
      assert.deepEqual(q.params, ['w1'], `${name} passed the wrong workspace`);
    }
  });

  test('a task watch is (taskId, cb), and each reads its own table', async () => {
    const cases: Array<[string, string]> = [['watchThread', 'from messages'], ['watchBeats', 'from beats'], ['watchArtifacts', 'from artifacts']];
    for (const [name, needle] of cases) {
      const f = fakeDb([{ id: 'x' }]);
      let got: unknown[] | null = null;
      // the unsubscribe is taken, NOT called: unsubscribing before the first read settles kills
      // the push, which is correct behaviour and was this test's own first bug.
      const off = arm(f.db)[name]!('task-9', (rows: unknown) => { got = rows as unknown[]; }) as () => void;
      await settle();
      const q = f.calls.find((c) => c.sql.includes(needle))!;
      assert.ok(q, `${name} does not read ${needle}`);
      assert.deepEqual(q.params, ['task-9']);
      assert.deepEqual(got, [{ id: 'x' }]);
      off();
    }
  });

  test('a failed re-read leaves the last good rows standing rather than blanking the surface', async () => {
    let ok = true;
    const f = fakeDb(() => { if (!ok) throw new Error('replica hiccup'); return [{ id: 'a' }]; });
    const seen: unknown[][] = [];
    const off = arm(f.db)['watchMessages']!('c', (rows: unknown) => seen.push(rows as unknown[])) as () => void;
    await settle();
    ok = false;
    f.change();
    await settle();
    assert.deepEqual(seen, [[{ id: 'a' }]], 'a broken read must not publish an empty list over good rows');
    off();
  });

  test('unsubscribing stops the callback — a late push must not reach a dead surface', async () => {
    const f = fakeDb([{ id: 'a' }]);
    let n = 0;
    const off = arm(f.db)['watchThreads']!('c', () => { n++; }) as () => void;
    await settle();
    off();
    f.change();
    await settle();
    assert.equal(n, 1, 'the callback fired after unsubscribe');
  });

  test('a failed roster read SAYS SO and yields empty — never a quiet empty room', async () => {
    const f = { getAll: async () => { throw new Error('nope'); }, onChangeWithCallback: () => () => {} };
    const said: unknown[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => { said.push(a[0]); };
    try {
      assert.deepEqual(await arm(f)['channelPeople']!('c'), []);
      assert.deepEqual(await arm(f)['channelHistory']!('c'), []);
    } finally { console.error = real; }
    assert.equal(said.length, 2, 'a failed read must be reported, not swallowed');
  });

  test('alerts answers three named sets, and one broken branch does not take the others down', async () => {
    const f = {
      getAll: async (sql: string) => { if (sql.includes('from schedules')) throw new Error('boom'); return [{ id: 'r' }]; },
      onChangeWithCallback: () => () => {},
    };
    const real = console.error;
    console.error = () => {};
    let r: { connectors: unknown[]; schedules: unknown[]; posts: unknown[] };
    try { r = (await arm(f)['alerts']!()) as typeof r; } finally { console.error = real; }
    assert.deepEqual(r.connectors, [{ id: 'r' }]);
    assert.deepEqual(r.schedules, [], 'the failing branch degrades alone');
    assert.deepEqual(r.posts, [{ id: 'r' }]);
  });

  test('taskDetail THROWS rather than inventing a task with no events and no files', async () => {
    // every caller writes `.catch(() => null)` and renders the absent state from that null, so a
    // swallowed error would tell the task view this task genuinely has nothing.
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    try {
      await assert.rejects(arm(fakeDb([]).db)['taskDetail']!('t-1') as Promise<unknown>, /failed 500/);
    } finally { globalThis.fetch = real; }
  });

  test('every query is a VERBATIM copy of the handler it came from', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    // every backtick string containing `select`, from a file. Deliberately not a query-shaped
    // regex: one of the failed generators matched a LOG TEMPLATE, and a narrower pattern is
    // exactly how it did that.
    const selects = (path: string): string[] => {
      const src = readFileSync(path, 'utf8');
      const out: string[] = [];
      for (let i = 0; i < src.length;) {
        const a = src.indexOf('`', i);
        const b = a < 0 ? -1 : src.indexOf('`', a + 1);
        if (b < 0) break;
        const body = src.slice(a + 1, b);
        if (/\bselect\b/i.test(body)) out.push(norm(body));
        i = b + 1;
      }
      return out;
    };
    const ipc = join(import.meta.dirname, '../../main/sync/ipc');
    const handlers = ['watch-board.ts', 'watch-rooms.ts', 'agents.ts', 'content.ts'].flatMap((f) => selects(join(ipc, f)));
    const mine = selects(join(import.meta.dirname, 'webnm-board.ts'));
    // a check that matches nothing reports success — so assert the corpus first
    assert.equal(mine.length, 14, 'the query count changed; this test must be looking at the right file');
    assert.ok(handlers.length > 20, 'the handler corpus did not load');
    for (const q of mine) {
      assert.ok(handlers.includes(q), `not verbatim — no handler carries this query:\n  ${q.slice(0, 160)}…`);
    }
  });
});
