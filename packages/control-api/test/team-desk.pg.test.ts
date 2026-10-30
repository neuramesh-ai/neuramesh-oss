import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PostgresStore } from '../src/pgstore';
import { createApp } from '../src/app';
import type { TeamDeskState, TeamContext } from '@neuramesh/shared';
const url = process.env['DATABASE_URL'];
const sql = url ? postgres(url) : null;
const store = url ? new PostgresStore(url) : null;
const app = store ? createApp(store) : null;
let workspace: string, projectId: string, user: string, agentA: string, agentB: string;
const request = (path: string, body?: unknown, actor = { kind: 'human', id: user }) => app!.request(path, {
  method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeAll(async () => {
  if (!sql) return;
  const [u] = await sql`insert into nm_users(clerk_user_id,email) values(${randomUUID()},${`${randomUUID()}@team.test`}) returning id`; user = u!['id'];
  const created = await request('/v1/commands', { type: 'workspace.create', name: 'Agent Desk tests', slug: `team-${randomUUID().slice(0,8)}` });
  workspace = (await created.json() as { workspaceId: string }).workspaceId;
  await sql`update workspaces set plan='cloud' where id=${workspace}::uuid`;
  const [p] = await sql`select id from projects where workspace_id=${workspace}::uuid and is_default`; projectId = p!['id'];
  const agents = await sql`insert into agents(workspace_id,name,role,runtime,model) values
    (${workspace}::uuid,'Rex','orchestrator','codex','gpt-5.6-sol'),(${workspace}::uuid,'Iris','designer','codex','gpt-5.6-sol') returning id,name`;
  agentA = agents.find(a => a['name'] === 'Rex')!['id']; agentB = agents.find(a => a['name'] === 'Iris')!['id'];
});
afterAll(async () => { await sql?.end(); await store?.close(); });
describe.skipIf(!url)('Agent Desk persistent homes', () => {
  it('new projects reuse a three-role startup team and preserve custom agent details', async () => {
    await sql!`update agents set description='My existing chief',brief='Keep my instructions' where id=${agentA}::uuid`;
    const created = await Promise.all(['Startup A','Startup B'].map(name=>request('/v1/commands',{type:'project.create',workspace,name})));
    expect(created.map(r=>r.status)).toEqual([200,200]);
    const ids = await Promise.all(created.map(async r=>(await r.json() as {projectId:string}).projectId));
    const teams = await Promise.all(ids.map(id=>sql!`select a.id,a.name,a.role from project_agents pa join agents a on a.id=pa.agent_id where pa.project_id=${id}::uuid order by a.name`));
    expect(teams[0]!.map(a=>String(a['name']).toLowerCase()).sort()).toEqual(['echo','plume','rex']);
    expect(teams[0]!.map(a=>a['id'])).toEqual(teams[1]!.map(a=>a['id']));
    expect((await sql!`select description,brief from agents where id=${agentA}::uuid`)[0]).toMatchObject({description:'My existing chief',brief:'Keep my instructions'});
    const opened = await (await request('/v1/team/open',{workspace,projectId:ids[0]})).json() as TeamDeskState;
    const reopened = await (await request('/v1/team/open',{workspace,projectId:ids[0]})).json() as TeamDeskState;
    expect(opened.homes).toHaveLength(3);
    expect(reopened.homes.map(h=>h.id)).toEqual(opened.homes.map(h=>h.id));
  });
  it('concurrent devices converge on one home per project and agent without a model call', async () => {
    const results = await Promise.all([1,2,3].map(() => request('/v1/team/open', { workspace, projectId, agentId: agentA })));
    expect(results.map(r => r.status)).toEqual([200,200,200]);
    const states = await Promise.all(results.map(r => r.json())) as TeamDeskState[];
    expect(new Set(states.map(s => s.homes[0]!.id)).size).toBe(1);
    expect(states[0]!.homes[0]).toMatchObject({ mode: 'chat', kind: 'chat', home_agent_id: agentA, msg_count: 0 });
  });
  it('rejects foreign people and agents, and preserves scope in the database', async () => {
    expect((await request('/v1/team/open', { workspace, projectId, agentId: randomUUID() })).status).toBe(404);
    expect((await request(`/v1/team?workspace=${workspace}&projectId=${projectId}`, undefined, { kind: 'human', id: randomUUID() })).status).toBe(404);
    expect((await request('/v1/team/open', { workspace, projectId, agentId: agentB }, { kind: 'agent', id: agentA })).status).toBe(403);
    const state = await (await request(`/v1/team?workspace=${workspace}&projectId=${projectId}`)).json() as TeamDeskState;
    await expect(sql!`update threads set mode='tasks' where id=${state.homes[0]!.id}::uuid`).rejects.toBeTruthy();
  });
  it('reopening an established desk preserves its team and journal without adding startup roles', async () => {
    const before = await (await request(`/v1/team?workspace=${workspace}&projectId=${projectId}`)).json() as TeamDeskState;
    const reopened = await (await request('/v1/team/open', {workspace,projectId})).json() as TeamDeskState;
    expect(reopened.homes.map(h=>h.id)).toEqual(before.homes.map(h=>h.id));
    expect(reopened.homes.map(h=>h.home_agent_id)).toEqual([agentA]);
  });
  it('delivers explicit collaboration once and refuses self or cross-project handoffs', async () => {
    const state = await (await request('/v1/team/open', { workspace, projectId, agentId: agentB })).json() as TeamDeskState;
    const a = state.homes.find(h => h.home_agent_id===agentA)!; const b = state.homes.find(h => h.home_agent_id===agentB)!;
    await request('/v1/messages', { workspace, project: projectId, threadId: a.id, body: 'Ask Iris for a design review.' });
    const body = { workspace, threadId: a.id, targetThreadId: b.id, id: randomUUID(), body: 'Please review the onboarding plan.' };
    expect((await request('/v1/team/message', body, { kind: 'agent', id: agentA })).status).toBe(200);
    expect((await request('/v1/team/message', body, { kind: 'agent', id: agentA })).status).toBe(200);
    expect(await sql!`select id from messages where id=${body.id}::uuid`).toHaveLength(1);
    expect((await request('/v1/team/message', { ...body, body:'changed' }, { kind: 'agent', id: agentA })).status).toBe(409);
    expect((await request('/v1/team/message', { ...body, id: randomUUID(), targetThreadId:a.id }, { kind:'agent',id:agentA })).status).toBe(403);
    expect((await request('/v1/team/message', { ...body, id: randomUUID() }, { kind:'agent',id:agentB })).status).toBe(403);
  });
  it('isolates history, handoffs and model choices across projects for the same agents', async () => {
    const created = await (await request('/v1/commands', { type: 'project.create', workspace, name: 'Second team' })).json() as { projectId: string };
    const second = await (await request('/v1/team/open', { workspace, projectId: created.projectId, agentId: agentA })).json() as TeamDeskState;
    const first = await (await request(`/v1/team?workspace=${workspace}&projectId=${projectId}`)).json() as TeamDeskState;
    const source = first.homes.find(h => h.home_agent_id === agentA)!;
    const target = second.homes.find(h => h.home_agent_id === agentA)!;
    expect(source.id).not.toBe(target.id);
    expect((await request('/v1/team/message', { workspace, threadId: source.id, targetThreadId: target.id, id: randomUUID(), body: 'Do not cross projects.' }, { kind: 'agent', id: agentA })).status).toBe(403);
    expect((await request(`/v1/team/history?workspace=${workspace}&threadId=${target.id}&sourceThreadId=${source.id}`, undefined, { kind: 'agent', id: agentA })).status).toBe(403);
    expect((await request(`/v1/team/history?workspace=${workspace}&threadId=${source.id}&sourceThreadId=${source.id}`, undefined, { kind: 'agent', id: agentA })).status).toBe(200);
    expect((await request('/v1/team/model', { workspace, threadId: target.id, model: 'gpt-5.6-sol', thinking: 'high' })).status).toBe(200);
    const rows = await sql!`select id,home_thinking from threads where id in (${source.id}::uuid,${target.id}::uuid)`;
    expect(rows.find(r => r['id'] === target.id)?.['home_thinking']).toBe('high');
    expect(rows.find(r => r['id'] === source.id)?.['home_thinking']).toBeNull();
  });
  it('keeps multiple routines attached to the owner without changing the home identity', async () => {
    const state = await (await request(`/v1/team?workspace=${workspace}&projectId=${projectId}`)).json() as TeamDeskState;
    const home = state.homes.find(h => h.home_agent_id===agentA)!;
    const arm = (title: string) => request('/v1/commands', { type:'schedule.create', channel:home.channel_id, thread:home.id, routine:true, title, prompt:'Summarize the saved project work. Do not contact external services.', cadence:'daily', atTime:'09:00', tz:'UTC' });
    const [first, retry, second] = await Promise.all([arm('Daily brief'), arm('Daily brief'), arm('Work review')]);
    expect([first.status,retry.status,second.status]).toEqual([200,200,200]);
    expect((await first.json() as {scheduleId:string}).scheduleId).toBe((await retry.json() as {scheduleId:string}).scheduleId);
    expect(await sql!`select id from schedules where owner_home_thread_id=${home.id}::uuid and agent_id=${agentA}::uuid`).toHaveLength(2);
    const [row] = await sql!`select schedule_id,home_agent_id from threads where id=${home.id}::uuid`;
    expect(row).toMatchObject({ schedule_id:null,home_agent_id:agentA });
  });
  it('compacts with a validated cursor and retains the complete journal and prior snapshots', async () => {
    const state = await (await request(`/v1/team?workspace=${workspace}&projectId=${projectId}`)).json() as TeamDeskState;
    const home = state.homes.find(h => h.home_agent_id===agentA)!;
    for (let i=0;i<65;i++) await sql!`insert into messages(workspace_id,channel_id,thread_id,author_kind,author_id,body) values(${workspace}::uuid,${home.channel_id}::uuid,${home.id}::uuid,'human',${user}::uuid,${`Constraint ${i}: preserve task and artifact references.`})`;
    const context = await (await request(`/v1/team/context?workspace=${workspace}&threadId=${home.id}`)).json() as TeamContext;
    expect(context.compactThrough).toBeTruthy();
    const data = { workspace, threadId:home.id, revision:context.revision, through:context.compactThrough, summary:'Preserve all constraints and open work. Sources remain in the journal.' };
    expect((await request('/v1/team/compact', data)).status).toBe(403);
    expect((await request('/v1/team/compact', data, {kind:'agent',id:agentA})).status).toBe(200);
    expect((await request('/v1/team/compact', data, {kind:'agent',id:agentA})).status).toBe(409);
    const after = await (await request(`/v1/team/context?workspace=${workspace}&threadId=${home.id}`)).json() as TeamContext;
    expect(after.messages).toHaveLength(20); expect(after.revision).toBe(1);
    expect(await sql!`select id from messages where thread_id=${home.id}::uuid`).toHaveLength(68);
  });
});
