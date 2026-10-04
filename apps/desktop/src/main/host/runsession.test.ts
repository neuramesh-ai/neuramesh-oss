// one session per routine (docs/design/routine-sessions-2026-09/plan.md, PR 2): the next run of a
// schedule continues its newest session, and each run starts clean. the launcher's half
// (host/runsession.ts), the wake's half (host/runwindow.ts), and the minute tick that uses them
// (host/schedules.ts), on real SQLite behind the replica's `getAll`, as host/routinerule.test.ts does.
// run from apps/desktop: pnpm exec tsx --test src/main/host/runsession.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { STARTER_MODEL, authCardBlock } from '@neuramesh/shared';
import { autoSwitchedRoles, continueSession, scheduleSession, withoutAutoSwitch } from './runsession';
import { previousRunNote, runCut, runWindow } from './runwindow';
import { autoSwitchOf, fallbackText, offerCard, switchedCard } from './starterfallback';
import { makeSchedules } from './schedules';
import { MAX_REASKS, gatherRoutineThreads, pickStrandedRoutines, reaskBody } from './routineresume';
import { readDrafts } from './chattools-drafts';
import { unpicked } from './ugcflow';
import type { HostedAgent } from '../agents';

const probe = (() => { try { return new Database(':memory:'); } catch { return null; } })();
const skip = probe ? false : 'better-sqlite3 is built for Electron\'s ABI — run under pnpm test, which rebuilds it';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const at = (hAgo: number) => new Date(NOW - hAgo * 3600_000).toISOString();

function replica() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    create table channels (id text primary key, workspace_id text, slug text, kind text);
    create table schedules (id text primary key, workspace_id text, channel_id text, title text, cadence text, at_time text, tz text, weekday integer,
      run_count integer, agent_id text, payload text, next_run_at text, last_error text, status text);
    create table threads (id text primary key, workspace_id text, channel_id text, schedule_id text, task_id text, kind text, archived_at text,
      brain_override text, created_at text, updated_at text);
    create table messages (id text primary key, workspace_id text, channel_id text, thread_id text, task_id text, author_kind text, author_id text,
      body text, created_at text, schedule_id text);
    create table tasks (id text primary key, number integer, title text, state text, parent_task_id text, origin_thread_id text, created_at text);
    create table agents (id text primary key, workspace_id text, name text, role text);
    create table content_items (id text primary key, thread_id text, task_id text, platform text, body text, status text, media text, scheduled_at text, created_at text);
    insert into channels values ('ch-dev', 'ws-1', 'dev', 'build'), ('ch-ops', 'ws-1', 'ops', 'build');
    insert into agents values ('a-rex', 'ws-1', 'rex', 'orchestrator');
  `);
  const db = { getAll: async <T,>(sql: string, params: unknown[] = []) => sqlite.prepare(sql).all(...(params as never[])) as T[] };
  const thread = (id: string, over: Record<string, unknown> = {}) => {
    const r = { workspace_id: 'ws-1', channel_id: 'ch-dev', schedule_id: 's-audit', task_id: null, kind: 'chat', archived_at: null, brain_override: null, created_at: at(72), updated_at: at(1), ...over };
    sqlite.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, r.workspace_id, r.channel_id, r.schedule_id, r.task_id, r.kind, r.archived_at, r.brain_override, r.created_at, r.updated_at);
  };
  let n = 0;
  const msg = (threadId: string, authorKind: string, body: string, created: string, scheduleId: string | null = null) =>
    sqlite.prepare('insert into messages values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(`m-${++n}`, 'ws-1', 'ch-dev', threadId, null, authorKind, authorKind === 'human' ? 'george' : 'a-rex', body, created, scheduleId);
  const unit = (id: string, number: number, title: string, state: string, threadId: string, created: string) =>
    sqlite.prepare('insert into tasks values (?, ?, ?, ?, ?, ?, ?)').run(id, number, title, state, null, threadId, created);
  const draft = (id: string, threadId: string, body: string, created: string) =>
    sqlite.prepare('insert into content_items values (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, threadId, null, 'x', body, 'draft', null, null, created);
  return { sqlite, db, thread, msg, unit, draft };
}

const rex = { id: 'a-rex', name: 'rex', role: 'orchestrator', runtime: 'claude-code', model: 'claude-opus-5-5' } as unknown as HostedAgent;

test('the next run continues the newest live session: never an archived one, a task\'s own thread or a coding thread', { skip }, async () => {
  const r = replica();
  r.thread('th-old', { created_at: at(72) });
  r.thread('th-new', { created_at: at(48), channel_id: 'ch-ops' });
  r.thread('th-archived', { created_at: at(30), archived_at: at(20) });
  r.thread('th-task', { created_at: at(26), task_id: 't-9' });
  r.thread('th-coding', { created_at: at(25), kind: 'coding' });
  r.thread('th-other', { created_at: at(2), schedule_id: 's-other' });
  assert.equal((await scheduleSession(r.db, 's-audit'))?.id, 'th-new');
  assert.equal((await scheduleSession(r.db, 's-audit', 'ch-dev'))?.id, 'th-old', 'a draft run keeps to its own room');
  assert.equal(await scheduleSession(r.db, 's-none'), null);
});

test('the run cut: the newest opener that carries the schedule, the first message of a session from before 0145, and no cut elsewhere', { skip }, async () => {
  const r = replica();
  r.thread('th-s');
  r.msg('th-s', 'human', 'Routine · Morning dependency audit\n\nday one', at(48), 's-audit');
  r.msg('th-s', 'agent', 'I filed #7.', at(47.9));
  r.msg('th-s', 'human', 'Routine · Morning dependency audit\n\nday two', at(24), 's-audit');
  r.msg('th-s', 'agent', 'Nothing new today.', at(23.9));
  r.thread('th-legacy');
  r.msg('th-legacy', 'human', 'Routine · Morning dependency audit\n\nold', at(60));
  r.msg('th-legacy', 'agent', 'done', at(59));
  r.thread('th-person', { schedule_id: null });
  r.msg('th-person', 'human', 'why does the drawer trap focus?', at(3));
  assert.equal(await runCut(r.db, 'th-s'), at(24));
  assert.equal(await runCut(r.db, 'th-legacy'), at(60));
  assert.equal(await runCut(r.db, 'th-person'), '');
  assert.equal(await runCut(r.db, null), '');
  assert.deepEqual(await runWindow(r.db, 'th-s'), { cut: at(24), since: NOW - 24 * 3600_000 });
  assert.deepEqual(await runWindow(r.db, 'th-person'), { cut: '', since: undefined });
});

test('the previous run in one line: its time, the units it made, and what older runs left open. nothing for a first run', { skip }, async () => {
  const r = replica();
  r.thread('th-s');
  r.msg('th-s', 'human', 'Routine · audit\n\nday one', at(72), 's-audit');
  r.unit('t-1', 1139, 'Bump undici to 6.21.1', 'in_progress', 'th-s', at(71.9));
  r.unit('t-0', 1130, 'Pin esbuild', 'accepted', 'th-s', at(71.8));
  r.msg('th-s', 'human', 'Routine · audit\n\nday two', at(48), 's-audit');
  r.unit('t-2', 1146, 'Patch lodash prototype pollution', 'in_review', 'th-s', at(47.9));
  r.msg('th-s', 'human', 'Routine · audit\n\nday three', at(24), 's-audit');
  const note = await previousRunNote(r.db, 'th-s');
  assert.match(note, /The previous run opened 2026-09-26 12:00 UTC and made #1146 "Patch lodash prototype pollution" \(in_review\)\./);
  assert.match(note, /Older runs left these units open: #1139 "Bump undici to 6\.21\.1" \(in_progress\)\./);
  assert.doesNotMatch(note, /1130/, 'an accepted unit is closed work');
  assert.match(note, /Do not file the same work again\./);
  r.thread('th-first');
  r.msg('th-first', 'human', 'Routine · audit\n\nday one', at(2), 's-audit');
  assert.equal(await previousRunNote(r.db, 'th-first'), '');
  assert.equal(await previousRunNote(r.db, null), '');
});

test('an automatic switch is read from its card or its line, and a card that only offers the switch is not one', () => {
  const u = { kind: 'login' as const, provider: 'anthropic' as const, reason: 'missing' as const };
  assert.deepEqual(autoSwitchOf(switchedCard(rex, u, { threadId: 'th-s' })), { role: 'orchestrator' });
  assert.deepEqual(autoSwitchOf(fallbackText(rex, { kind: 'capped', model: 'claude-opus-5-5' }, 'auto', 'routine')), { agent: 'rex' });
  assert.equal(autoSwitchOf(offerCard(rex, u, { threadId: 'th-s' }, true)), null);
  assert.equal(autoSwitchOf('The drawer traps focus on iPad.'), null);
  assert.equal(autoSwitchOf(`@rex asked\n\n${authCardBlock({ provider: 'claude', agent: 'rex' })}`), null);
});

test('the next run ends an automatic switch of the run before, and keeps a brain a person picked', { skip }, async () => {
  const u = { kind: 'login' as const, provider: 'anthropic' as const, reason: 'missing' as const };
  const r = replica();
  r.thread('th-s', { brain_override: JSON.stringify({ orchestrator: STARTER_MODEL, marketer: 'gpt-5.5' }) });
  r.msg('th-s', 'human', 'Routine · audit\n\nday one', at(24), 's-audit');
  r.msg('th-s', 'agent', switchedCard(rex, u, { threadId: 'th-s' }), at(23.9));
  assert.deepEqual(await autoSwitchedRoles(r.db, { id: 'th-s', workspace_id: 'ws-1' }), ['orchestrator']);
  const posts: Array<{ path: string; actor: { kind: string; id: string }; body: Record<string, unknown> }> = [];
  const post = async (path: string, actor: { kind: string; id: string }, body: unknown) => { posts.push({ path, actor, body: body as Record<string, unknown> }); return new Response('{}'); };
  const out = await continueSession({ db: r.db, post, ownerActorId: 'george' }, { id: 's-audit', channel_id: 'ch-dev' });
  assert.deepEqual(out, { threadId: 'th-s', channelId: 'ch-dev', continued: true });
  assert.deepEqual(posts, [{ path: '/v1/commands', actor: { kind: 'human', id: 'george' }, body: { type: 'thread.set_brain', workspace: 'ws-1', threadId: 'th-s', override: { marketer: 'gpt-5.5' } } }]);

  // a person's pick leaves no card: the next run keeps it. a switch two runs back was ended already
  const p = replica();
  p.thread('th-p', { brain_override: JSON.stringify({ orchestrator: STARTER_MODEL }) });
  p.msg('th-p', 'human', 'Routine · audit\n\nday one', at(48), 's-audit');
  p.msg('th-p', 'agent', switchedCard(rex, u, { threadId: 'th-p' }), at(47.9));
  p.msg('th-p', 'human', 'Routine · audit\n\nday two', at(24), 's-audit');
  p.msg('th-p', 'agent', 'Nothing new today.', at(23.9));
  const quiet: unknown[] = [];
  await continueSession({ db: p.db, post: async (...a: unknown[]) => { quiet.push(a); return new Response('{}'); }, ownerActorId: 'george' }, { id: 's-audit', channel_id: 'ch-dev' });
  assert.equal(quiet.length, 0);
});

test('withoutAutoSwitch moves only a seat on the NeuraMesh brain, and clears the override when nothing is left', () => {
  assert.deepEqual(withoutAutoSwitch({ orchestrator: STARTER_MODEL }, ['orchestrator']), null);
  assert.equal(withoutAutoSwitch({ orchestrator: 'claude-opus-5-5' }, ['orchestrator']), undefined, 'a person moved it off the NeuraMesh brain since');
  assert.equal(withoutAutoSwitch(null, ['orchestrator']), undefined);
  assert.equal(withoutAutoSwitch({ orchestrator: STARTER_MODEL }, []), undefined);
});

test('no session yet: the run opens a new one in the schedule\'s room', { skip }, async () => {
  const r = replica();
  const out = await continueSession({ db: r.db, post: async () => new Response('{}'), ownerActorId: 'george' }, { id: 's-audit', channel_id: 'ch-dev' });
  assert.equal(out.continued, false);
  assert.equal(out.channelId, 'ch-dev');
  assert.match(out.threadId, /^[0-9a-f-]{36}$/);
});

test('the minute tick posts a routine\'s next run into its session, in the session\'s own room', { skip }, async () => {
  const r = replica();
  r.sqlite.prepare('insert into schedules values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    's-audit', 'ws-1', 'ch-dev', 'Morning dependency audit', 'daily', '09:00', 'UTC', null, 1, null,
    JSON.stringify({ prompt: 'Check our top 20 dependencies.', routine: true }), new Date(Date.now() - 60_000).toISOString(), null, 'active');
  r.thread('th-s', { channel_id: 'ch-ops' });
  r.msg('th-s', 'human', 'Routine · Morning dependency audit\n\nday one', at(24), 's-audit');
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const post = async (path: string, _actor: unknown, body: unknown) => {
    posts.push({ path, body: body as Record<string, unknown> });
    return new Response(JSON.stringify((body as { type?: string }).type === 'schedule.claim_run' ? { claimed: true } : { ok: true }));
  };
  const { runDueSchedules } = makeSchedules({
    db: r.db as never, apiUrl: 'http://api.test', ownerActorId: 'george', post, apiGet: (async () => null) as never,
    agents: new Map(), bootstrapAuthCardPosted: new Set(), arun: (() => ({ log: () => {}, runId: 'run-1' })) as never, runMarketingBootstrap: async () => {},
  });
  await runDueSchedules();
  const opener = posts.find((p) => p.path === '/v1/messages');
  assert.ok(opener, 'the run posted its opener');
  assert.equal(opener!.body['threadId'], 'th-s', 'the second run continues the session');
  assert.equal(opener!.body['channel'], 'ch-ops', 'in the room the session lives in now');
  assert.equal(opener!.body['scheduleId'], 's-audit');
});

test('the re-ask works per run: its window, its count, its unit check and its owner start at the newest opener', { skip }, async () => {
  const r = replica();
  r.sqlite.prepare('insert into schedules (id, workspace_id, channel_id, title, payload, status) values (?, ?, ?, ?, ?, ?)').run(
    's-audit', 'ws-1', 'ch-dev', 'Morning dependency audit', JSON.stringify({ prompt: 'Check our top 20 dependencies.', routine: true }), 'active');
  r.thread('th-s', { created_at: at(72), updated_at: at(1) });
  // run one, three days back: a unit, and every re-ask it was allowed
  r.msg('th-s', 'human', 'Routine · Morning dependency audit\n\nday one', at(72), 's-audit');
  for (let i = 0; i < MAX_REASKS; i++) r.msg('th-s', 'human', reaskBody('Morning dependency audit', 'Check our top 20 dependencies.'), at(71 - i));
  r.unit('t-1', 1139, 'Bump undici', 'in_progress', 'th-s', at(68));
  // run two, an hour ago: no answer came
  r.msg('th-s', 'human', 'Routine · Morning dependency audit\n\nday two', at(1), 's-audit');
  const [c] = await gatherRoutineThreads(r.db, { id: 'ch-dev' }, NOW);
  assert.ok(c, 'a session born three days back is still gathered: its newest run is an hour old');
  assert.equal(c!.bornMs, NOW - 3600_000);
  assert.equal(c!.reasks, 0, 'the re-asks of run one do not count against run two');
  assert.equal(c!.anchoredUnits, 0, 'the unit of run one does not stop run two');
  assert.equal(c!.newerRunExists, false);
  assert.deepEqual(pickStrandedRoutines([c!], NOW).map((x) => x.threadId), ['th-s']);
});

test('draft letters restart at each run: the agent reads the newest run\'s cards from a', { skip }, async () => {
  const r = replica();
  r.thread('th-d', { schedule_id: 's-post' });
  r.msg('th-d', 'agent', 'Scheduled draft · Daily X post · for 10:00\n\nday one', at(48), 's-post');
  r.draft('c-1', 'th-d', 'day one post', at(47.99));
  r.draft('c-2', 'th-d', 'day one, the other take', at(47.98));
  r.msg('th-d', 'agent', 'Scheduled draft · Daily X post · for 10:00\n\nday two', at(24), 's-post');
  r.draft('c-3', 'th-d', 'day two post', at(23.99));
  assert.deepEqual((await readDrafts(r.db, { threadId: 'th-d' })).map((d) => [d.letter, d.caption]), [['a', 'day two post']]);
  // a person's conversation is one run: every draft, a to c
  r.thread('th-chat', { schedule_id: null });
  r.msg('th-chat', 'human', 'draft three posts on the memory spine', at(5));
  for (const [i, t] of ['one', 'two', 'three'].entries()) r.draft(`c-chat-${i}`, 'th-chat', t, at(4.9 - i * 0.01));
  assert.deepEqual((await readDrafts(r.db, { threadId: 'th-chat' })).map((d) => d.letter), ['a', 'b', 'c']);
});

test('the angle gate reads the newest run: yesterday\'s pick is not today\'s, and a routine\'s opener is no pick', { skip }, async () => {
  const card = 'Three angles.\n\n```nmq\n{"question":"Which angle?","kind":"ugc","options":["a","b","c"]}\n```';
  const r = replica();
  r.thread('th-u', { schedule_id: 's-ugc' });
  r.msg('th-u', 'human', 'Routine · UGC scripts\n\nday one', at(48), 's-ugc');
  r.msg('th-u', 'agent', card, at(47.9));
  r.msg('th-u', 'human', 'b, fifteen seconds', at(47.5));
  r.msg('th-u', 'human', 'Routine · UGC scripts\n\nday two', at(1), 's-ugc');
  assert.match((await unpicked(r.db as never, { threadId: 'th-u' }))!, /propose_angles/, 'a new run proposes its own angles first');
  const n = replica();
  n.thread('th-n', { schedule_id: 's-ugc' });
  n.msg('th-n', 'human', 'Routine · UGC scripts\n\nday one', at(48), 's-ugc');
  n.msg('th-n', 'agent', card, at(47.9));
  n.msg('th-n', 'human', 'Routine · UGC scripts\n\nday two', at(1), 's-ugc');
  assert.notEqual(await unpicked(n.db as never, { threadId: 'th-n' }), null, 'the next opener never picks yesterday\'s angle');
});
