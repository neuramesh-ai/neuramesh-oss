import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';
const DB = process.env['DATABASE_URL'];
const sql = DB ? postgres(DB) : null;
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
let owner: string, workspace: string, project: string, context: string, marketer: string;
const send = (body: unknown, actor = { kind: 'human', id: owner }) => app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
beforeAll(async () => {
  if (!sql) return;
  const [u] = await sql`insert into nm_users(clerk_user_id, email) values (${randomUUID()}, ${`${randomUUID()}@marketing.test`}) returning id`;
  owner = u!['id'] as string;
  const ws = await send({ type: 'workspace.create', name: 'Project marketing QA', slug: `pm-${randomUUID().slice(0, 8)}` });
  workspace = (await ws.json() as any).workspaceId;
  const res = await send({ type: 'project.create', workspace, name: 'Product' });
  project = (await res.json() as any).projectId;
  const [p] = await sql`select context_channel_id from projects where id = ${project}::uuid`;
  context = p!['context_channel_id'] as string;
  const [a] = await sql`insert into agents(workspace_id,name,role,runtime,model) values (${workspace}::uuid,'test-plume','marketer','claude-code','test') returning id`;
  marketer = a!['id'] as string;
});
afterAll(async () => { await sql?.end(); await store?.close(); });
describe.skipIf(!DB)('project marketing entry point', () => {
  it('refuses agents and nonmembers without creating setup', async () => {
    const agent = await send({ type: 'marketing.start', project }, { kind: 'agent', id: marketer });
    expect(agent.status).toBe(403);
    expect((await send({ type: 'marketing.start', project }, { kind: 'human', id: randomUUID() })).status).toBe(403);
    expect(await sql!`select id from tasks where channel_id = ${context}::uuid and kind = 'setup'`).toHaveLength(0);
  });
  it('serializes starts into one project-owned setup without changing the context kind', async () => {
    const before = (await sql!`select kind from channels where id = ${context}::uuid`)[0];
    const results = await Promise.all(Array.from({ length: 4 }, async () => {
      const response = await send({ type: 'marketing.start', project });
      expect(response.status).toBe(200);
      return response.json() as Promise<{ channelId: string; taskId: string }>;
    }));
    expect(new Set(results.map((r) => r.taskId)).size).toBe(1);
    expect(results.every((r) => r.channelId === context)).toBe(true);
    expect(await sql!`select project_id from tasks where id = ${results[0]!.taskId}::uuid`).toMatchObject([{ project_id: project }]);
    expect((await sql!`select kind from channels where id = ${context}::uuid`)[0]).toEqual(before);
    expect(await sql!`select id from project_agents where project_id = ${project}::uuid and agent_id = ${marketer}::uuid`).toHaveLength(1);
    expect(await sql!`select channel_id from agent_channels where agent_id = ${marketer}::uuid`).toMatchObject([{ channel_id: context }]);
  });
  it('resumes saved answers and honors a deliberate marketer removal', async () => {
    const first = await (await send({ type: 'marketing.start', project })).json() as any;
    expect((await send({ type: 'setup.step', channel: context, flow: 'marketing.v1', step: 'product', value: 'https://example.com' })).status).toBe(200);
    await sql!`delete from project_agents where project_id = ${project}::uuid and agent_id = ${marketer}::uuid`;
    const next = await (await send({ type: 'marketing.start', project })).json() as any;
    expect(next.taskId).toBe(first.taskId);
    expect((await sql!`select brand_profile from projects where id = ${project}::uuid`)[0]!['brand_profile'].website).toBe('https://example.com');
    expect(await sql!`select 1 from agent_channels where channel_id = ${context}::uuid and agent_id = ${marketer}::uuid`).toHaveLength(0);
  });
  it('completes in the same setup task and arms only its project bootstrap', async () => {
    const anchor = await (await send({ type: 'marketing.start', project })).json() as any;
    const response = await send({ type: 'marketing.setup', channel: context, website: 'https://example.com', focus: ['content'], goal: 'Explain the product' });
    expect(response.status).toBe(200);
    expect((await response.json() as any).taskId).toBe(anchor.taskId);
    expect((await sql!`select state from tasks where id = ${anchor.taskId}::uuid`)[0]!['state']).toBe('done');
    const schedules = await sql!`select project_id,payload from schedules where channel_id = ${context}::uuid`;
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({ project_id: project, payload: { bootstrap: true, taskId: anchor.taskId } });
  });
});
