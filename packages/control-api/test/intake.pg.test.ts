// INTAKE (round 9) against the REAL schema. The pure half is src/intake.test.ts.
//
// What this locks down:
//   · a person's first message stores threads.intake and the title, and a coding ask flips the thread to
//     kind 'coding' with workspace_mode 'scratch' (no repository) or 'repo' (a project repository)
//   · the starter brain is called once, metered, with the strict schema. With no key, no credits, a
//     timeout or bad JSON, the build rule decides alone (source 'rule'), and a rule miss stores nothing
//   · a second message never re-runs intake, a person's title wins, an agent's reply first makes it stale
//   · an Agent Desk home thread and a routine's thread are skipped
//
// Its own workspace, like coding-threads.pg.test.ts. Run via scripts/test-pg.sh: skipped without DATABASE_URL.
import { intakeOf, type Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { StarterFetch } from '../src/credits';
import type { IntakeOutcome } from '../src/intake';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const sql = DB ? postgres(DB, { max: 1, prepare: false, onnotice: () => {} }) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

/** one app per behaviour: the env and the fetch are the intake's doors */
let runs: Array<Promise<IntakeOutcome>> = [];
let calls = 0;
const appWith = (env: NodeJS.ProcessEnv, fetchFn?: StarterFetch) => createApp(store!, { intake: { env, ...(fetchFn ? { fetchFn } : {}), onRun: (r) => { runs.push(r); } } });
const reply = (decision: Record<string, unknown>): StarterFetch => async () => {
  calls += 1;
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(decision) }] } }], usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 120 } }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const KEY = { STARTER_GOOGLE_API_KEY: 'test-key' };

let george: Actor;
let WS = ''; let BARE_PROJECT = ''; let BARE = ''; let DEV_PROJECT = ''; let DEV = ''; let REPO = ''; let AGENT = '';

const send = async (app: ReturnType<typeof createApp>, actor: Actor, body: Record<string, unknown>) => {
  const res = await app.request('/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
  expect(res.status).toBe(200);
  return res;
};
/** a new conversation's first message, and the intake run it fired */
const birth = async (app: ReturnType<typeof createApp>, channel: string, body: string, extra: Record<string, unknown> = {}) => {
  runs = [];
  const threadId = (extra['threadId'] as string | undefined) ?? crypto.randomUUID();
  await send(app, george, { workspace: WS, channel, body, threadId, ...extra });
  const outcome = runs.length ? await runs[0] : null;
  return { threadId, outcome };
};
const row = async (threadId: string) => (await sql!`select kind, workspace_mode, intake, title, titled_at from threads where id = ${threadId}::uuid`)[0]!;
const credits = async (micros: number) => {
  await sql!`insert into workspace_credits (workspace_id, granted_micros, spent_micros) values (${WS}::uuid, ${micros}, 0)
    on conflict (workspace_id) do update set granted_micros = excluded.granted_micros, spent_micros = 0`;
};

beforeAll(async () => {
  if (!sql) return;
  const [u] = await sql`insert into nm_users (clerk_user_id, email) values ('clerk_intake_george', 'george@intake.test')
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  george = { kind: 'human', id: u!['id'] as string };
  const setup = appWith({ NM_INTAKE: 'off' });
  const cmd = async (body: Record<string, unknown>) => j(await setup.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) }, body: JSON.stringify(body) }));
  WS = (await cmd({ type: 'workspace.create', name: 'Intake', slug: `intake-${Date.now().toString(36)}` })).workspaceId as string;
  await sql`update workspaces set plan = 'cloud' where id = ${WS}::uuid`;
  BARE_PROJECT = (await cmd({ type: 'project.create', workspace: WS, name: 'Cinder Default' })).projectId as string;
  BARE = (await cmd({ type: 'channel.create', workspace: WS, project: BARE_PROJECT, slug: 'bare' })).channelId as string;
  DEV_PROJECT = (await cmd({ type: 'project.create', workspace: WS, name: 'Flowe AI' })).projectId as string;
  DEV = (await cmd({ type: 'channel.create', workspace: WS, project: DEV_PROJECT, slug: 'dev' })).channelId as string;
  REPO = (await cmd({ type: 'repo.link', workspace: WS, channel: DEV, url: 'https://github.com/flowe/app' })).repoId as string;
  const [m] = await sql`insert into machines (workspace_id, owner_user_id, name, platform, daemon_version, last_seen_at, runtimes)
    values (${WS}::uuid, ${george.id}::uuid, 'intake-host', 'linux', '1', now(), '["claude-code"]'::jsonb)
    on conflict (workspace_id, name) do update set last_seen_at = now() returning id`;
  AGENT = (await sql`insert into agents (workspace_id, machine_id, name, role, model) values (${WS}::uuid, ${m!['id'] as string}::uuid, 'intake-dev', 'developer', 'claude-sonnet-5')
    on conflict (workspace_id, name) do update set retired_at = null returning id`)[0]!['id'] as string;
});

afterAll(async () => { await store?.close(); await sql?.end(); });

describe.skipIf(!DB)('intake (round 9) against real postgres', () => {
  it('no starter key: the build rule makes a coding thread with a scratch workspace', async () => {
    const { threadId, outcome } = await birth(appWith({}), BARE, 'build a palindrome html app that checks if a string is a palindrome');
    expect(outcome).toBe('coding');
    const t = await row(threadId);
    expect(t).toMatchObject({ kind: 'coding', workspace_mode: 'scratch' });
    const d = intakeOf(t['intake'])!;
    expect(d).toMatchObject({ kind: 'coding', source: 'rule', workspace: 'scratch', repoId: null });
    expect(d.plan.length).toBeGreaterThanOrEqual(2);
    expect(t['titled_at']).not.toBeNull();
  });

  it('no starter key and a rule miss: nothing is stored, today\'s behaviour', async () => {
    const { threadId, outcome } = await birth(appWith({}), BARE, 'what is a palindrome?');
    expect(outcome).toBe('no_decision');
    expect(await row(threadId)).toMatchObject({ kind: 'chat', workspace_mode: null, intake: null });
  });

  it('the starter brain decides a question: stored with its title, the kind stays chat, and the call is metered', async () => {
    await credits(1_000_000_000);
    calls = 0;
    const { threadId, outcome } = await birth(appWith(KEY, reply({ kind: 'question', confidence: 0.95, title: 'Palindromes explained', name: 'palindromes', plan: ['Define a palindrome', 'Give three examples'], subtasks: [], workspace: 'none' })), BARE, 'what is a palindrome?');
    expect(outcome).toBe('stored');
    expect(calls).toBe(1);
    const t = await row(threadId);
    expect(t).toMatchObject({ kind: 'chat', workspace_mode: null, title: 'Palindromes explained' });
    expect(intakeOf(t['intake'])).toMatchObject({ kind: 'question', source: 'starter', workspace: 'none' });
    const [c] = await sql!`select spent_micros from workspace_credits where workspace_id = ${WS}::uuid`;
    expect(Number(c!['spent_micros'])).toBeGreaterThan(0);
  });

  it('the starter brain decides coding on a project repository: kind coding, workspace repo, the repo in the decision', async () => {
    await credits(1_000_000_000);
    const { threadId, outcome } = await birth(appWith(KEY, reply({ kind: 'coding', confidence: 0.9, title: 'Fix the login redirect', name: 'login-redirect', plan: ['Find the redirect', 'Fix it', 'Run the tests'], subtasks: [], workspace: 'repo', repoId: REPO })), DEV, 'the login redirect loops after sign in, fix it');
    expect(outcome).toBe('coding');
    const t = await row(threadId);
    expect(t).toMatchObject({ kind: 'coding', workspace_mode: 'repo' });
    expect(intakeOf(t['intake'])).toMatchObject({ workspace: 'repo', repoId: REPO, source: 'starter' });
  });

  it('a second message never re-runs intake', async () => {
    const app = appWith({});
    const { threadId } = await birth(app, BARE, 'build a calculator app');
    const first = (await row(threadId))['intake'];
    const again = await birth(app, BARE, 'make it support square roots', { threadId });
    expect(again.outcome).toBe('skipped');
    expect((await row(threadId))['intake']).toEqual(first);
  });

  it('a person\'s title wins, and an agent reply before the decision makes it stale', async () => {
    await credits(1_000_000_000);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: StarterFetch = async (u, i) => { await gate; return reply({ kind: 'coding', confidence: 0.9, title: 'Model title', name: 'model-title', plan: ['a', 'b'], subtasks: [], workspace: 'scratch' })(u, i); };
    // the title: the person renames while intake runs
    runs = [];
    const named = crypto.randomUUID();
    const app = appWith(KEY, slow);
    await send(app, george, { workspace: WS, channel: BARE, body: 'build a timer app', threadId: named });
    const r1 = runs[0]!;
    const rename = await app.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) }, body: JSON.stringify({ type: 'thread.update', workspace: WS, threadId: named, title: 'My own name' }) });
    expect(rename.status).toBe(200);
    release();
    expect(await r1).toBe('coding');
    expect(await row(named)).toMatchObject({ title: 'My own name', kind: 'coding' });
  });

  it('an agent that answered first: the decision is stale and nothing is written', async () => {
    await credits(1_000_000_000);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: StarterFetch = async (u, i) => { await gate; return reply({ kind: 'coding', confidence: 0.9, title: 'Late', name: 'late', plan: ['a', 'b'], subtasks: [], workspace: 'scratch' })(u, i); };
    runs = [];
    const threadId = crypto.randomUUID();
    const app = appWith(KEY, slow);
    await send(app, george, { workspace: WS, channel: BARE, body: 'build a stopwatch app', threadId });
    const r = runs[0]!;
    await sql!`insert into messages (id, workspace_id, channel_id, thread_id, author_kind, author_id, body)
      values (${crypto.randomUUID()}::uuid, ${WS}::uuid, ${BARE}::uuid, ${threadId}::uuid, 'agent', ${AGENT}::uuid, 'Here is a stopwatch.')`;
    release();
    expect(await r).toBe('stale');
    expect(await row(threadId)).toMatchObject({ kind: 'chat', intake: null });
  });

  it('no credits: the starter brain is never called and the rule decides', async () => {
    await credits(0);
    calls = 0;
    const { threadId, outcome } = await birth(appWith(KEY, reply({ kind: 'chat', confidence: 1, title: 'x', name: 'x', plan: ['x'], subtasks: [], workspace: 'none' })), BARE, 'create a landing page for the beta');
    expect(calls).toBe(0);
    expect(outcome).toBe('coding');
    expect(intakeOf((await row(threadId))['intake'])).toMatchObject({ source: 'rule' });
  });

  it('a timeout and bad JSON fall back to the rule', async () => {
    await credits(1_000_000_000);
    const hang: StarterFetch = (_u, i) => new Promise((_, reject) => i.signal?.addEventListener('abort', () => reject(i.signal!.reason)));
    const timedOut = await birth(appWith({ ...KEY, NM_INTAKE_TIMEOUT_MS: '1000' }, hang), BARE, 'write a python script to rename my photos');
    expect(timedOut.outcome).toBe('coding');
    expect(intakeOf((await row(timedOut.threadId))['intake'])).toMatchObject({ source: 'rule' });
    const junk: StarterFetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }), { status: 200 });
    const bad = await birth(appWith(KEY, junk), BARE, 'explain React hooks');
    expect(bad.outcome).toBe('no_decision');
    expect((await row(bad.threadId))['intake']).toBeNull();
  });

  it('an Agent Desk home thread is skipped', async () => {
    // a home thread lives in its project's context channel (0160 nm_guard_agent_home)
    const [p] = await sql!`select context_channel_id from projects where id = ${BARE_PROJECT}::uuid`;
    const context = p!['context_channel_id'] as string;
    await sql!`insert into project_agents (workspace_id, project_id, agent_id) values (${WS}::uuid, ${BARE_PROJECT}::uuid, ${AGENT}::uuid) on conflict do nothing`;
    const threadId = crypto.randomUUID();
    await sql!`insert into threads (id, workspace_id, channel_id, project_id, title, created_by, mode, kind, home_agent_id)
      values (${threadId}::uuid, ${WS}::uuid, ${context}::uuid, ${BARE_PROJECT}::uuid, 'intake-dev · Agent thread', ${`human:${george.id}`}, 'chat', 'chat', ${AGENT}::uuid)`;
    const { outcome } = await birth(appWith({}), context, 'build a palindrome html app', { threadId });
    expect(outcome).toBe('skipped');
    expect(await row(threadId)).toMatchObject({ kind: 'chat', intake: null });
  });

  it('a routine\'s thread is skipped before any work', async () => {
    const { threadId, outcome } = await birth(appWith({}), BARE, 'build a palindrome html app', { scheduleId: crypto.randomUUID() });
    expect(outcome).toBeNull();
    expect((await row(threadId))['intake']).toBeNull();
  });

  it('the client that birthed the thread reads the decision at once, holding until it lands', async () => {
    const app = appWith({});
    const threadId = crypto.randomUUID();
    const read = (wait: number) => app.request(`/v1/threads/${threadId}/intake?workspace=${WS}&wait=${wait}`, { headers: { 'x-nm-actor': JSON.stringify(george) } });
    runs = [];
    await send(app, george, { workspace: WS, channel: BARE, body: 'build a palindrome html app', threadId });
    // asked before the decision lands: the request holds and answers with it
    const held = await read(8);
    expect(held.status).toBe(200);
    const body = await held.json() as { intake: { kind: string; plan: string[] } | null; kind: string; workspaceMode: string | null; title: string };
    await runs[0];
    expect(body.intake?.kind).toBe('coding');
    expect(body.kind).toBe('coding');
    expect(body.workspaceMode).toBe('scratch');
    expect(body.title).toBe((await row(threadId))['title']);
    // a stranger reads nothing, and an unknown thread is not found
    const stranger = await app.request(`/v1/threads/${threadId}/intake?workspace=${WS}`, { headers: { 'x-nm-actor': JSON.stringify({ kind: 'human', id: crypto.randomUUID() }) } });
    expect(stranger.status).toBe(403);
    const missing = await app.request(`/v1/threads/${crypto.randomUUID()}/intake?workspace=${WS}`, { headers: { 'x-nm-actor': JSON.stringify(george) } });
    expect(missing.status).toBe(404);
  });

  it('a thread with no decision answers after the wait with intake null', async () => {
    const app = appWith({});
    const { threadId } = await birth(app, BARE, 'what is a palindrome?');
    const started = Date.now();
    const res = await app.request(`/v1/threads/${threadId}/intake?workspace=${WS}&wait=1`, { headers: { 'x-nm-actor': JSON.stringify(george) } });
    expect(((await res.json()) as { intake: unknown }).intake).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('NM_INTAKE=off turns it off', async () => {
    const { threadId, outcome } = await birth(appWith({ NM_INTAKE: 'off' }), BARE, 'build a palindrome html app');
    expect(outcome).toBeNull();
    expect((await row(threadId))['kind']).toBe('chat');
  });
});
