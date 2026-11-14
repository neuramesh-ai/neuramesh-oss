// PROJECT MEMORY (decision D15, round 8): memory belongs to the project, and every agent of the project
// recalls it. On real Postgres:
//   · 0174's backfill moves legacy channel facts and summaries to their project, once,
//   · a fact or a block written through any channel of a project lands on the project,
//   · recall and the memory view never cross a project or a workspace,
//   · the nm-api refresh on the starter brain writes the project block and facts once per window.
// Run by the pg lane (DATABASE_URL). Skipped without it.
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTER_MODEL } from '@neuramesh/shared';
import { Hono } from 'hono';
import { createApp } from '../src/app';
import { e2eRoutes } from '../src/e2e-routes';
import { PostgresStore } from '../src/pgstore';
import { dueProjects, memoryRefreshConfig, refreshProject, type DueProject, type MemoryRefreshDeps } from '../src/project-memory-refresh';

const DB = process.env['DATABASE_URL'];
const sql = DB ? postgres(DB, { max: 5, onnotice: () => {} }) : null;
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;

let ws: string;
let otherWs: string;
let owner: { kind: 'human'; id: string };
let projectA: string;
let chA1: string; // #build of the default project
let chA2: string; // the project's context channel
let projectB: string;
let chB: string;
let rex: { kind: 'agent'; id: string; role: 'orchestrator' }; // on the starter brain, works in project A
let sol: { kind: 'agent'; id: string; role: 'worker' }; // works in project B

const headers = (actor: unknown) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const post = (path: string, actor: unknown, body: unknown) => app!.request(path, { method: 'POST', headers: headers(actor), body: JSON.stringify(body) });
const cmd = (actor: unknown, body: Record<string, unknown>) => post('/v1/commands', actor, { workspace: ws, ...body });
const recall = async (actor: unknown, body: Record<string, unknown>) => {
  const res = await post('/v1/recall', actor, { workspace: ws, k: 10, ...body });
  expect(res.status).toBe(200);
  return ((await res.json()) as { hits: Array<{ body: string; kind: string }> }).hits.map((h) => h.body);
};

async function workspace(name: string): Promise<{ id: string; owner: { kind: 'human'; id: string } }> {
  const [u] = await sql!`insert into nm_users(clerk_user_id, email) values (${randomUUID()}, ${`${randomUUID()}@memory.test`}) returning id`;
  const who = { kind: 'human' as const, id: u!['id'] as string };
  const res = await post('/v1/commands', who, { type: 'workspace.create', name, slug: `mem-${randomUUID().slice(0, 8)}` });
  expect(res.status).toBe(200);
  return { id: ((await res.json()) as { workspaceId: string }).workspaceId, owner: who };
}

beforeAll(async () => {
  if (!sql) return;
  ({ id: ws, owner } = await workspace('Project memory'));
  // a new workspace's default project holds #general (its context channel) and #build
  const [g] = await sql`select id, project_id from channels where workspace_id = ${ws}::uuid and slug = 'build'`;
  chA1 = g!['id'] as string; projectA = g!['project_id'] as string;
  chA2 = (await sql`select context_channel_id from projects where id = ${projectA}::uuid`)[0]!['context_channel_id'] as string;
  expect(chA2).toBeTruthy();
  expect(chA2).not.toBe(chA1);
  const [p] = await sql`insert into projects(workspace_id, name, slug) values (${ws}::uuid, 'Other', 'other') returning id`;
  projectB = p!['id'] as string;
  chB = (await sql`insert into channels(workspace_id, project_id, slug) values (${ws}::uuid, ${projectB}::uuid, 'other') returning id`)[0]!['id'] as string;
  const [a] = await sql`insert into agents(workspace_id, name, role, runtime, model) values (${ws}::uuid, 'mem-rex', 'orchestrator', 'gemini', ${STARTER_MODEL}) returning id`;
  rex = { kind: 'agent', id: a!['id'] as string, role: 'orchestrator' };
  await sql`insert into agent_channels(agent_id, channel_id) values (${rex.id}::uuid, ${chA1}::uuid)`;
  const [b] = await sql`insert into agents(workspace_id, name, role, runtime, model) values (${ws}::uuid, 'mem-sol', 'worker', 'claude-code', 'claude-sonnet-4-5') returning id`;
  sol = { kind: 'agent', id: b!['id'] as string, role: 'worker' };
  await sql`insert into agent_channels(agent_id, channel_id) values (${sol.id}::uuid, ${chB}::uuid)`;
  ({ id: otherWs } = await workspace('Someone else'));
});

afterAll(async () => { await sql?.end(); await store?.close(); });

describe.skipIf(!DB)('project memory (D15)', () => {
  it('the backfill moves legacy channel facts and summaries to the project, and a second run changes nothing', async () => {
    // a fact from before 0157: no project. The replica role skips the guard that fills it today
    const legacy = await sql!.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      const [f] = await tx`insert into facts (workspace_id, channel_id, content, basis_count) values (${ws}::uuid, ${chA1}::uuid, 'Legacy fact: the brand colour is teal.', 1) returning id`;
      return f!['id'] as string;
    });
    expect((await sql!`select project_id from facts where id = ${legacy}::uuid`)[0]!['project_id']).toBeNull();
    await sql!`insert into memory_blocks (workspace_id, channel_id, kind, content, basis_count, updated_at)
      values (${ws}::uuid, ${chA1}::uuid, 'channel_summary', 'Older: general plans the launch.', 3, now() - interval '2 hours'),
             (${ws}::uuid, ${chA2}::uuid, 'channel_summary', 'Newer: the context room picked teal.', 4, now() - interval '1 hour')`;

    const [first] = await sql!`select public.nm_project_memory_backfill(${ws}::uuid) as r`;
    expect(first!['r']).toEqual({ facts: 1, blocks: 1 });
    expect((await sql!`select project_id from facts where id = ${legacy}::uuid`)[0]!['project_id']).toBe(projectA);
    const [block] = await sql!`select channel_id, content, basis_count, updated_at = (select max(updated_at) from memory_blocks where workspace_id = ${ws}::uuid and kind = 'channel_summary') as newest
      from memory_blocks where project_id = ${projectA}::uuid and kind = 'project_summary'`;
    expect(block).toMatchObject({ channel_id: chA2, basis_count: 7, newest: true });
    expect(block!['content']).toBe('Newer: the context room picked teal.\n\nOlder: general plans the launch.');
    // the legacy rows stay readable for an old nm-api in a rolling deploy
    expect(await sql!`select 1 from memory_blocks where workspace_id = ${ws}::uuid and kind = 'channel_summary'`).toHaveLength(2);
    const [again] = await sql!`select public.nm_project_memory_backfill(${ws}::uuid) as r`;
    expect(again!['r']).toEqual({ facts: 0, blocks: 0 });
  });

  it('a fact written through any channel of the project reconciles against the whole project', async () => {
    const add = await cmd(rex, { type: 'memory.upsert_fact', channel: chA1, content: 'The pricing page launches with three tiers.' });
    expect(add.status).toBe(200);
    const a = (await add.json()) as { decision: string; factId: string };
    expect(a.decision).toBe('add');
    const dup = (await (await cmd(owner, { type: 'memory.upsert_fact', channel: chA2, content: 'The pricing page launches with three tiers.' })).json()) as { decision: string; factId: string };
    expect(dup).toEqual({ decision: 'noop', factId: a.factId });
    // the same words in project B are B's own fact
    const other = (await (await cmd(owner, { type: 'memory.upsert_fact', channel: chB, content: 'The pricing page launches with three tiers.' })).json()) as { decision: string; factId: string };
    expect(other.decision).toBe('add');
    expect((await sql!`select project_id from facts where id = ${a.factId}::uuid`)[0]!['project_id']).toBe(projectA);
    expect((await sql!`select project_id from facts where id = ${other.factId}::uuid`)[0]!['project_id']).toBe(projectB);
  });

  it('the project block is one row per project, whichever channel names it, and every view of the project reads it', async () => {
    const r1 = (await (await cmd(rex, { type: 'memory.refresh_block', channel: chA1, kind: 'project_summary', content: 'Project A: pricing ships in three tiers.', basisCount: 5 })).json()) as { blockId: string };
    const r2 = (await (await cmd(owner, { type: 'memory.refresh_block', channel: chA2, kind: 'project_summary', content: 'Project A: pricing ships Friday in three tiers.', basisCount: 6 })).json()) as { blockId: string };
    expect(r2.blockId).toBe(r1.blockId);
    expect((await cmd(sol, { type: 'memory.refresh_block', channel: chB, kind: 'project_summary', content: 'nope', basisCount: 1 })).status).toBe(403);
    const rows = await sql!`select project_id, content from memory_blocks where workspace_id = ${ws}::uuid and kind = 'project_summary'`;
    expect(rows).toEqual([{ project_id: projectA, content: 'Project A: pricing ships Friday in three tiers.' }]);

    // the view through either channel of A: A's block and A's facts, never B's
    for (const channel of [chA1, chA2]) {
      const view = await store!.channelMemory(ws, channel);
      expect(view.block?.content).toBe('Project A: pricing ships Friday in three tiers.');
      expect(view.facts.map((f) => f.content)).toContain('Legacy fact: the brand colour is teal.');
    }
    const viewB = await store!.channelMemory(ws, chB);
    expect(viewB.block).toBeNull();
    expect(viewB.facts.map((f) => f.content)).not.toContain('Legacy fact: the brand colour is teal.');
  });

  it('recall never crosses a project or a workspace', async () => {
    await cmd(owner, { type: 'memory.upsert_fact', channel: chA1, content: 'Zebracorn owner in project A is Rex.' });
    await cmd(owner, { type: 'memory.upsert_fact', channel: chB, content: 'Zebracorn owner in project B is Sol.' });
    expect((await post('/v1/messages', owner, { workspace: ws, channel: chB, body: 'zebracorn chat that belongs to project B' })).status).toBe(200);
    const elsewhere = await workspace('Zebracorn elsewhere');
    expect((await post('/v1/commands', elsewhere.owner, { type: 'memory.upsert_fact', workspace: elsewhere.id, channel: 'general', content: 'Zebracorn owner in another workspace is Mo.' })).status).toBe(200);

    // an agent with no scope (an old machine) reads only the projects it works in
    const rexHits = await recall(rex, { query: 'zebracorn owner' });
    expect(rexHits.some((b) => b.includes('project A'))).toBe(true);
    expect(rexHits.some((b) => b.includes('project B') || b.includes('another workspace'))).toBe(false);
    const solHits = await recall(sol, { query: 'zebracorn' });
    expect(solHits.some((b) => b.includes('project B'))).toBe(true);
    expect(solHits.some((b) => b.includes('project A') || b.includes('another workspace'))).toBe(false);

    // a channel, a project or a thread names exactly one project
    const viaChannel = await recall(rex, { channel: chA2, query: 'zebracorn owner' });
    expect(viaChannel.length).toBeGreaterThan(0);
    expect(viaChannel.every((b) => !b.includes('project B'))).toBe(true);
    const viaProject = await recall(owner, { project: projectB, query: 'zebracorn' });
    expect(viaProject.length).toBeGreaterThan(0);
    expect(viaProject.every((b) => !b.includes('project A'))).toBe(true);
    const thread = randomUUID();
    expect((await post('/v1/messages', owner, { workspace: ws, channel: chB, threadId: thread, body: 'thread opener in B' })).status).toBe(200);
    const viaThread = await recall(rex, { threadId: thread, query: 'zebracorn owner' });
    expect(viaThread.every((b) => !b.includes('project A'))).toBe(true);
    // a person with no scope searches the whole workspace, and still never another workspace
    const ownerHits = await recall(owner, { query: 'zebracorn owner' });
    expect(ownerHits.some((b) => b.includes('project A'))).toBe(true);
    expect(ownerHits.some((b) => b.includes('project B'))).toBe(true);
    expect(ownerHits.some((b) => b.includes('another workspace'))).toBe(false);
    // a project or a thread of another workspace is not found here
    const otherProject = (await sql!`select id from projects where workspace_id = ${otherWs}::uuid limit 1`)[0]!['id'] as string;
    expect((await post('/v1/recall', owner, { workspace: ws, project: otherProject, query: 'zebracorn' })).status).toBe(404);
  });

  it('team recall gives an Agent Desk thread the facts of its own project only', async () => {
    const thread = randomUUID();
    expect((await post('/v1/messages', owner, { workspace: ws, channel: chA1, threadId: thread, body: 'Ask rex about the zebracorn owner' })).status).toBe(200);
    const res = await app!.request(`/v1/team/recall?workspace=${ws}&threadId=${thread}&query=${encodeURIComponent('who is the zebracorn owner')}`, { headers: headers(rex) });
    expect(res.status).toBe(200);
    const { facts } = (await res.json()) as { facts: Array<{ body: string }> };
    expect(facts.some((f) => f.body.includes('project A'))).toBe(true);
    expect(facts.some((f) => f.body.includes('project B'))).toBe(false);
  });

  it('the starter refresh writes the project block and facts once per window, and gives the claim back when the call fails', async () => {
    expect((await post('/v1/messages', owner, { workspace: ws, channel: chA1, body: 'Decision: the launch moves to Monday 17 November.' })).status).toBe(200);
    const config = { ...memoryRefreshConfig({}), batch: 200 };
    const mine = async () => (await dueProjects(sql!, config)).filter((p) => p.workspaceId === ws);
    // the seeded block (backfill and refresh_block above) is fresh: wind it back past the window
    await sql!`update memory_blocks set updated_at = now() - interval '2 hours' where project_id = ${projectA}::uuid and kind = 'project_summary'`;
    const due = await mine();
    const a = due.find((p) => p.id === projectA) as DueProject;
    expect(a).toBeTruthy();
    expect(a.previous).toBe('Project A: pricing ships Friday in three tiers.');

    const prompts: string[] = [];
    const deps = (reply: () => Promise<Response>, ledger: MemoryRefreshDeps['ledger'] = null): MemoryRefreshDeps => ({
      store: store!, sql: sql!, ledger, key: 'test-key', config,
      fetchFn: async (_url, init) => { prompts.push(String(init.body)); return reply(); },
    });
    const ok = () => Promise.resolve(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'Project A: the launch moves to Monday.', facts: ['The launch date is Monday 17 November.'] }) }] } }],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 80 },
    })));
    expect(await refreshProject(deps(ok), a)).toBe('refreshed');
    expect(prompts[0]).toContain('the launch moves to Monday 17 November');
    expect(prompts[0]).not.toContain('belongs to project B');
    const [block] = await sql!`select content, basis_count from memory_blocks where project_id = ${projectA}::uuid and kind = 'project_summary'`;
    expect(block!['content']).toBe('Project A: the launch moves to Monday.');
    expect(Number(block!['basis_count'])).toBeGreaterThan(6);
    expect(await sql!`select 1 from facts where project_id = ${projectA}::uuid and content = 'The launch date is Monday 17 November.' and valid_until is null`).toHaveLength(1);

    // once per window: A is not due again, and a pass that read the old block loses the claim
    expect((await mine()).some((p) => p.id === projectA)).toBe(false);
    expect(await refreshProject(deps(ok), a)).toBe('lost_claim');

    // a workspace out of credits is skipped before any call
    const b = (await mine()).find((p) => p.id === projectB) as DueProject;
    expect(b).toBeTruthy();
    const broke = { balance: async () => ({ remainingMicros: 0 }) } as unknown as MemoryRefreshDeps['ledger'];
    const calls = prompts.length;
    expect(await refreshProject(deps(ok, broke), b)).toBe('no_credits');
    expect(prompts.length).toBe(calls);
    // a failed call gives the claim back: B is due at the next pass
    expect(await refreshProject(deps(() => Promise.resolve(new Response('{}', { status: 500 }))), b)).toBe('failed');
    expect((await mine()).some((p) => p.id === projectB)).toBe(true);

    // a workspace with no orchestrator on the starter brain is the machine's (a vendor login pays)
    const vendor = await workspace('Vendor brain');
    await post('/v1/messages', vendor.owner, { workspace: vendor.id, channel: 'general', body: 'A vendor brain workspace message.' });
    expect((await dueProjects(sql!, config)).some((p) => p.workspaceId === vendor.id)).toBe(false);
  });
  it('the e2e door refreshes the driver\'s own workspace now (force winds the window back) and only behind the fleet secret', async () => {
    const saved = { NM_E2E_ROUTES: process.env['NM_E2E_ROUTES'], FLEET_SECRET: process.env['FLEET_SECRET'], STARTER_GOOGLE_API_KEY: process.env['STARTER_GOOGLE_API_KEY'] };
    Object.assign(process.env, { NM_E2E_ROUTES: '1', FLEET_SECRET: 'door-secret', STARTER_GOOGLE_API_KEY: 'test-key' });
    try {
      const doorApp = new Hono();
      const seen: string[] = [];
      e2eRoutes(doorApp, store!, { starterFetch: async (_u, init) => { seen.push(String(init.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'Door refresh: the quokka review is on Tuesday.', facts: [] }) }] } }] })); } });
      const call = (auth: string, body: unknown = { force: true }) => doorApp.request(`/internal/e2e/workspaces/${ws}/memory-refresh`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect((await call('Bearer nope')).status).toBe(403);
      expect((await post('/v1/messages', owner, { workspace: ws, channel: chA1, body: 'The quokka review moved to Tuesday.' })).status).toBe(200);
      const res = await call('Bearer door-secret');
      expect(res.status).toBe(200);
      const out = (await res.json()) as { outcomes: Array<{ project: string; outcome: string }>; blocks: Array<{ project_id: string; content: string }> };
      expect(out.outcomes).toContainEqual({ project: projectA, outcome: 'refreshed' });
      expect(out.blocks.find((b) => b.project_id === projectA)?.content).toBe('Door refresh: the quokka review is on Tuesday.');
      expect(seen.some((x) => x.includes('quokka review moved to Tuesday'))).toBe(true);
      // without force the window holds: project A is not due again
      const again = (await (await call('Bearer door-secret', {})).json()) as { outcomes: Array<{ project: string }> };
      expect(again.outcomes.some((o) => o.project === projectA)).toBe(false);
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});
