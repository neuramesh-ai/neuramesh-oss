// the runner's marketing seed (machined-seeds.ts): a cloud runner gives a browser workspace what
// the Mac's boot seed gives a Mac one, the marketing packs, the setup backfill and plume. these run
// the module on real SQLite behind the replica's getAll and watch (as host/routinerule.test.ts
// does), with a fake post and a fake clock. the decision table itself is planMarketingRoomSeeds,
// tested in seed.test.ts.
// run from apps/desktop: pnpm exec tsx --test src/main/machined-seeds.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { STARTER_MODEL, resolvePackRoles, type Actor } from '@neuramesh/shared';
import { RETRY_BASE_MS, RETRY_CAP_MS, SEED_DELAY_MS, startRunnerSeeds, type RunnerSeedDeps } from './machined-seeds';

const canOpen = (() => { try { new Database(':memory:').close(); return true; } catch { return false; } })();
const skip = canOpen ? false : 'better-sqlite3 is built for the Electron ABI. Run it under pnpm test, which rebuilds it.';

const cfg = { kind: 'runner', machineId: 'runner-1', workspaceId: 'ws1', ownerUserId: 'owner-1' };
const starter = async () => resolvePackRoles('starter', []);
// this process already synced: every test but the sleep test starts from a fresh replica
const synced = async () => {};
const quiet = () => {};

// the replica's columns that the seed reads (packages/client-core/src/tables)
const SCHEMA = `
  create table channels (id text primary key, workspace_id text, slug text, kind text, created_at text);
  create table agents (id text primary key, workspace_id text, name text, role text, status text, retired_at text);
`;
const ROOMS = `insert into channels values
  ('c-general', 'ws1', 'general', 'build', '2026-10-01T00:00:00Z'),
  ('c-mkt', 'ws1', 'marketing', 'marketing', '2026-10-01T00:00:01Z');`;
const REX = `insert into agents values ('a-rex', 'ws1', 'rex', 'orchestrator', 'online', null);`;
const room = (id: string, day: string) => `insert into channels values ('${id}', 'ws1', '${id}', 'marketing', '2026-10-${day}T00:00:00Z')`;
const agent = (name: string, role: string) => `insert into agents values ('a-${name}', 'ws1', '${name}', '${role}', 'online', null)`;

type WatchHandler = { onResult: (r: { rows?: { _array?: unknown[] } }) => void };
function replica(seed: string) {
  const sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA + seed);
  const watches: Array<() => void> = [];
  const reads = { n: 0 }; // each pass reads the replica four times, so this counts the passes
  const db: RunnerSeedDeps['db'] = {
    getAll: async <T,>(sql: string, params: unknown[] = []) => { reads.n++; return sqlite.prepare(sql).all(...(params as never[])) as T[]; },
    watch: (sql: string, params: unknown[], h: WatchHandler) => {
      const emit = () => h.onResult({ rows: { _array: sqlite.prepare(sql).all(...(params as never[])) } });
      watches.push(emit);
      void Promise.resolve().then(emit); // PowerSync emits the first result at once
    },
  };
  // a replica write: PowerSync runs every watch on the table again, whatever the row was
  const write = (sql: string) => { sqlite.exec(sql); for (const w of watches) w(); };
  return { db, write, watches, reads };
}

type Sent = { path: string; actor: Actor; body: Record<string, unknown> };
function poster(answer: (body: Record<string, unknown>) => number | Error = () => 200) {
  const sent: Sent[] = [];
  const post: RunnerSeedDeps['post'] = async (path, actor, body) => {
    const b = body as Record<string, unknown>;
    sent.push({ path, actor, body: b });
    const a = answer(b);
    if (a instanceof Error) throw a;
    return { status: a };
  };
  return { post, sent };
}

function fakeClock() {
  let now = 0;
  const due: Array<{ at: number; fn: () => void }> = [];
  return {
    timer: (fn: () => void, ms: number) => { due.push({ at: now + ms, fn }); },
    advance(ms: number) {
      now += ms;
      for (const d of due.filter((x) => x.at <= now)) { due.splice(due.indexOf(d), 1); d.fn(); }
    },
  };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const typesOf = (sent: Sent[]) => sent.map((s) => s.body['type']);
const registersIn = (sent: Sent[]) => sent.filter((s) => s.body['type'] === 'agent.register');

test('a member machine seeds nothing', { skip }, async () => {
  const r = replica(ROOMS + REX);
  const { post, sent } = poster();
  startRunnerSeeds({ db: r.db, cfg: { ...cfg, kind: 'member' }, synced, post, packRoles: starter, log: quiet, timer: fakeClock().timer });
  await settle();
  assert.equal(r.watches.length, 0, 'no watch');
  assert.equal(sent.length, 0, 'no post');
});

test('the runner speaks as its owner', { skip }, async () => {
  // two marketing rooms, the newer one written first: the order comes from created_at
  const r = replica(REX + `insert into channels values
    ('c-new', 'ws1', 'launch', 'marketing', '2026-10-03T00:00:00Z'),
    ('c-old', 'ws1', 'marketing', 'marketing', '2026-10-01T00:00:00Z');`);
  const { post, sent } = poster();
  startRunnerSeeds({ db: r.db, cfg, synced, post, packRoles: starter, log: quiet, timer: fakeClock().timer });
  await settle();
  assert.deepEqual(typesOf(sent), ['skillpack.seed_defaults', 'skillpack.seed_defaults', 'setup.backfill', 'agent.register']);
  for (const s of sent) {
    assert.equal(s.path, '/v1/commands');
    assert.deepEqual(s.actor, { kind: 'human', id: 'owner-1' }, `${String(s.body['type'])} goes out as the owner`);
  }
  const reg = sent[3]!.body;
  assert.equal(reg['machineId'], 'runner-1');
  assert.deepEqual(reg['channels'], ['c-old', 'c-new']);
});

test('a replica reopened after a sleep seeds only after this process syncs', { skip }, async () => {
  // the file from before the sleep. while the runner slept, a person deleted c-gone and made c-new
  const r = replica(REX + room('c-mkt', '01') + ';' + room('c-gone', '02'));
  const { post, sent } = poster();
  let syncNow = () => {};
  const firstSync = new Promise<void>((done) => { syncNow = done; });
  startRunnerSeeds({ db: r.db, cfg, synced: () => firstSync, post, packRoles: starter, log: quiet, timer: fakeClock().timer });
  await settle();
  assert.equal(r.watches.length, 0, 'the facts from before the sleep start no pass');
  assert.equal(sent.length, 0);
  // the catch-up checkpoint lands
  r.write(`delete from channels where id = 'c-gone'; ${room('c-new', '05')}`);
  syncNow();
  await settle();
  assert.deepEqual(sent.map((s) => [s.body['type'], s.body['channel'] ?? null]), [
    ['skillpack.seed_defaults', 'c-mkt'], ['skillpack.seed_defaults', 'c-new'], ['setup.backfill', null], ['agent.register', null],
  ]);
  assert.deepEqual(sent[3]!.body['channels'], ['c-mkt', 'c-new']);
});

test('a burst of crew rows and new rooms makes one pass', { skip }, async () => {
  const r = replica(ROOMS);
  const { post, sent } = poster();
  const lines: string[] = [];
  const clock = fakeClock();
  startRunnerSeeds({ db: r.db, cfg, synced, post, packRoles: starter, log: (l) => lines.push(l), timer: clock.timer });
  await settle();
  assert.equal(sent.length, 0, 'before Launch the runner waits');
  assert.ok(lines.some((l) => /orchestrator/.test(l)), `the log says why: ${lines.join(' | ')}`);
  const at = async (ms: number, sql: string) => { clock.advance(ms); r.write(sql); await settle(); };
  const readsBefore = r.reads.n;
  // three inputs inside one wait (rex at 0 s, new rooms at 1.5 s and 3 s), and crew rows that are not inputs
  await at(0, agent('rex', 'orchestrator'));
  await at(500, agent('iris', 'designer'));
  await at(500, agent('patch', 'developer'));
  await at(500, room('c-mkt-2', '02'));
  await at(0, agent('bosun', 'shipper'));
  await at(1_500, room('c-mkt-3', '03'));
  await at(1_000, agent('curator', 'curator'));
  clock.advance(900); // 4.9 s
  await settle();
  assert.equal(r.reads.n, readsBefore, 'no pass inside the wait');
  clock.advance(100); // 5 s after the first change, not after the last one
  await settle();
  assert.equal(r.reads.n, readsBefore + 4, 'one pass');
  assert.deepEqual(typesOf(sent), ['skillpack.seed_defaults', 'skillpack.seed_defaults', 'skillpack.seed_defaults', 'setup.backfill', 'agent.register']);
  assert.deepEqual(registersIn(sent)[0]!.body['channels'], ['c-mkt', 'c-mkt-2', 'c-mkt-3']);
  clock.advance(SEED_DELAY_MS); // 10 s
  await settle();
  assert.equal(r.reads.n, readsBefore + 4, 'the changes inside the wait ride the same pass');
  // an agent's status is not an input: a turn or a heartbeat never starts a pass
  r.write(`update agents set status = 'busy' where id = 'a-rex'`);
  await settle();
  clock.advance(SEED_DELAY_MS * 2);
  await settle();
  assert.equal(r.reads.n, readsBefore + 4, 'no pass ran');
  assert.equal(sent.length, 5);
});

test('a refusal logs its status and settles, and a 5xx or no answer stays open', { skip }, async () => {
  const r = replica(REX + `insert into channels values ('c-a', 'ws1', 'marketing', 'marketing', '2026-10-01T00:00:00Z');`);
  const answers: Record<string, Array<number | Error>> = {
    'skillpack.seed_defaults': [403],
    'setup.backfill': [new Error('ECONNRESET')],
    'agent.register': [503],
  };
  const { post, sent } = poster((body) => answers[String(body['type'])]?.shift() ?? 200);
  const lines: string[] = [];
  const clock = fakeClock();
  startRunnerSeeds({ db: r.db, cfg, synced, post, packRoles: starter, log: (l) => lines.push(l), timer: clock.timer });
  await settle();
  assert.deepEqual(lines.filter((l) => !l.startsWith('runner_seed skip') && !l.startsWith('runner_seed retry')), [
    'runner_seed skillpack.seed_defaults 403 room=c-a',
    'runner_seed setup.backfill offline',
    'runner_seed agent.register 503 room=c-a',
  ]);
  // a new marketing room starts the next pass
  r.write(`insert into channels values ('c-b', 'ws1', 'launch', 'marketing', '2026-10-02T00:00:00Z')`);
  await settle();
  clock.advance(SEED_DELAY_MS);
  await settle();
  const second = sent.slice(3);
  assert.deepEqual(second.map((s) => [s.body['type'], s.body['channel'] ?? null]), [
    ['skillpack.seed_defaults', 'c-b'], // the refused room is not asked again
    ['setup.backfill', null], // no answer: asked again
    ['agent.register', null], // a 5xx: asked again
  ]);
  assert.deepEqual(second[2]!.body['channels'], ['c-a', 'c-b']);
  assert.equal(lines.at(-1), 'runner_seed agent.register 200 room=c-a,c-b');
});

test('a register that names a deleted room stays open, and the next pass sends the fresh list', { skip }, async () => {
  // the server deleted c-gone after the replica read, so it refuses the whole register with a 404
  const r = replica(REX + room('c-keep', '01') + ';' + room('c-gone', '02'));
  const { post, sent } = poster((body) => ((body['channels'] as string[] | undefined)?.includes('c-gone') ? 404 : 200));
  const lines: string[] = [];
  const clock = fakeClock();
  startRunnerSeeds({ db: r.db, cfg, synced, post, packRoles: starter, log: (l) => lines.push(l), timer: clock.timer });
  await settle();
  assert.ok(lines.includes('runner_seed agent.register 404 room=c-keep,c-gone'), lines.join(' | '));
  // the deletion reaches the replica and starts the next pass
  r.write(`delete from channels where id = 'c-gone'`);
  await settle();
  clock.advance(SEED_DELAY_MS);
  await settle();
  assert.deepEqual(registersIn(sent).map((s) => s.body['channels']), [['c-keep', 'c-gone'], ['c-keep']]);
  assert.equal(lines.at(-1), 'runner_seed agent.register 200 room=c-keep');
});

test('a pass that leaves a command open runs again after a backoff, with no replica write', { skip }, async () => {
  const r = replica(ROOMS + REX);
  const answers = [503, 503]; // the register's first two answers, then 200
  const { post, sent } = poster((body) => (body['type'] === 'agent.register' ? answers.shift() ?? 200 : 200));
  const lines: string[] = [];
  const clock = fakeClock();
  startRunnerSeeds({ db: r.db, cfg, synced, post, packRoles: starter, log: (l) => lines.push(l), timer: clock.timer });
  await settle();
  assert.equal(registersIn(sent).length, 1);
  assert.ok(lines.includes(`runner_seed retry in ${RETRY_BASE_MS / 1000} s`), lines.join(' | '));
  clock.advance(RETRY_BASE_MS - 1);
  await settle();
  assert.equal(registersIn(sent).length, 1, 'nothing before the wait ends');
  clock.advance(1);
  await settle();
  assert.equal(registersIn(sent).length, 2, 'the first retry');
  clock.advance(RETRY_BASE_MS);
  await settle();
  assert.equal(registersIn(sent).length, 2, 'the second wait is twice as long');
  clock.advance(RETRY_BASE_MS);
  await settle();
  assert.equal(registersIn(sent).length, 3, 'the second retry');
  assert.equal(lines.at(-1), 'runner_seed agent.register 200 room=c-mkt');
  // nothing stays open, so no timer starts another pass
  const reads = r.reads.n;
  clock.advance(RETRY_CAP_MS * 4);
  await settle();
  assert.equal(r.reads.n, reads, 'no pass ran');
  assert.deepEqual(typesOf(sent), ['skillpack.seed_defaults', 'setup.backfill', 'agent.register', 'agent.register', 'agent.register']);
});

test('one pass at a time: a pass asked for during a pass runs after it', { skip }, async () => {
  const r = replica(ROOMS + REX);
  let release = () => {};
  const held = new Promise<void>((done) => { release = done; });
  const { post: answer, sent } = poster();
  // the boot pass's first command waits for its answer
  const post: RunnerSeedDeps['post'] = async (path, actor, body) => {
    const res = answer(path, actor, body);
    if (sent.length === 1) await held;
    return res;
  };
  const clock = fakeClock();
  startRunnerSeeds({ db: r.db, cfg, synced, post, packRoles: starter, log: quiet, timer: clock.timer });
  await settle();
  r.write(`insert into channels values ('c-mkt-2', 'ws1', 'launch', 'marketing', '2026-10-02T00:00:00Z')`);
  await settle();
  clock.advance(SEED_DELAY_MS);
  await settle();
  assert.equal(sent.length, 1, 'the second pass waits for the first');
  release();
  await settle();
  assert.deepEqual(sent.map((s) => [s.body['type'], s.body['channel'] ?? null]), [
    ['skillpack.seed_defaults', 'c-mkt'], ['setup.backfill', null], ['agent.register', null],
    ['skillpack.seed_defaults', 'c-mkt-2'], // the second pass sends only what is new
  ]);
});

test('a retired marketer in the replica keeps plume out', { skip }, async () => {
  const r = replica(ROOMS + REX + `insert into agents values ('a-nova', 'ws1', 'nova', 'marketer', 'offline', '2026-09-01T00:00:00Z');`);
  const { post, sent } = poster();
  const lines: string[] = [];
  let packReads = 0;
  const packRoles = async () => { packReads++; return starter(); };
  startRunnerSeeds({ db: r.db, cfg, synced, post, packRoles, log: (l) => lines.push(l), timer: fakeClock().timer });
  await settle();
  assert.deepEqual(typesOf(sent), ['skillpack.seed_defaults', 'setup.backfill']);
  assert.equal(packReads, 0, 'a workspace with a marketer reads no pack');
  assert.ok(lines.includes('runner_seed skip: the workspace already has a marketer'), lines.join(' | '));
});

test('a failed pack read holds plume, and the retry after the backoff seats it', { skip }, async () => {
  const r = replica(ROOMS + REX);
  const { post, sent } = poster();
  const lines: string[] = [];
  const clock = fakeClock();
  let down = true;
  const packRoles = async () => { if (down) throw new Error('GET /v1/workspaces answered 503'); return starter(); };
  startRunnerSeeds({ db: r.db, cfg, synced, post, packRoles, log: (l) => lines.push(l), timer: clock.timer });
  await settle();
  assert.deepEqual(typesOf(sent), ['skillpack.seed_defaults', 'setup.backfill']);
  assert.ok(lines.some((l) => /pack read failed/.test(l)), lines.join(' | '));
  down = false;
  // no replica write: only the retry can start the next pass
  clock.advance(RETRY_BASE_MS);
  await settle();
  const reg = sent.find((s) => s.body['type'] === 'agent.register')?.body;
  assert.equal(reg?.['model'], STARTER_MODEL);
  assert.equal(reg?.['runtime'], 'gemini');
});
