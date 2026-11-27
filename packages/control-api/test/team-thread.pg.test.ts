import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PostgresStore } from '../src/pgstore';
import { createApp } from '../src/app';
import type { TeamDeskState, TeamHome } from '@neuramesh/shared';

const url = process.env['DATABASE_URL'];
const sql = url ? postgres(url) : null, store = url ? new PostgresStore(url) : null;
const app = store ? createApp(store) : null;
let workspace: string, projectId: string, user: string, home: TeamHome, replacement: TeamHome;
const request = (path: string, body?: unknown, actor = { kind: 'human', id: user }) => app!.request(path, {
  method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeAll(async () => {
  if (!sql) return;
  const [u] = await sql`insert into nm_users(clerk_user_id,email) values(${randomUUID()},${`${randomUUID()}@fresh.test`}) returning id`; user = u!['id'];
  workspace = (await (await request('/v1/commands', { type: 'workspace.create', name: 'Fresh thread tests', slug: `fresh-${randomUUID().slice(0, 8)}` })).json() as { workspaceId: string }).workspaceId;
  await sql`update workspaces set plan='cloud' where id=${workspace}::uuid`;
  const [p] = await sql`select id from projects where workspace_id=${workspace}::uuid and is_default`; projectId = p!['id'];
  const state = await (await request('/v1/team/open', { workspace, projectId })).json() as TeamDeskState; home = state.homes[0]!;
});
afterAll(async () => { await sql?.end(); await store?.close(); });

describe.skipIf(!url)('Fresh agent threads', () => {
  it('requires a person with project access and refuses an active reply', async () => {
    const body = { workspace, projectId, threadId: home.id };
    expect((await request('/v1/team/fresh', body, { kind: 'agent', id: home.home_agent_id })).status).toBe(403);
    expect((await request('/v1/team/fresh', body, { kind: 'human', id: randomUUID() })).status).toBe(404);
    expect((await request('/v1/team/fresh', { ...body, projectId: randomUUID() })).status).toBe(404);
    await sql!`insert into messages(workspace_id,channel_id,thread_id,author_kind,author_id,body)
      values(${workspace}::uuid,${home.channel_id}::uuid,${home.id}::uuid,'human',${user}::uuid,'Keep this in the old conversation only.')`;
    expect((await request('/v1/team/fresh', body)).status).toBe(409);
    await sql!`insert into messages(workspace_id,channel_id,thread_id,author_kind,author_id,body)
      values(${workspace}::uuid,${home.channel_id}::uuid,${home.id}::uuid,'agent',${home.home_agent_id}::uuid,'Saved decision: the old conversation uses orange.')`;
    const [run] = await sql!`insert into runs(workspace_id,channel_id,thread_id,agent_id,kind,title) values(${workspace}::uuid,${home.channel_id}::uuid,${home.id}::uuid,${home.home_agent_id}::uuid,'wake','Reply') returning id`;
    expect((await request('/v1/team/fresh', body)).status).toBe(409);
    await sql!`update runs set state='done' where id=${run!['id']}::uuid`;
  });
  it('starts empty once across devices, keeps selection and journal, and transfers routines', async () => {
    await request('/v1/team/model', { workspace, threadId: home.id, model: 'gpt-5.6-sol', thinking: 'high' });
    const routine = await request('/v1/commands', { type: 'schedule.create', channel: home.channel_id, thread: home.id, routine: true, title: 'Daily check', prompt: 'Review project status.', cadence: 'daily', atTime: '09:00', tz: 'UTC' });
    expect(routine.status).toBe(200);
    const [message] = await sql!`select id from messages where thread_id=${home.id}::uuid order by created_at limit 1`;
    await sql!`insert into team_context_snapshots(workspace_id,thread_id,revision,through_message_id,summary) values(${workspace}::uuid,${home.id}::uuid,1,${message!['id']}::uuid,'Old decisions must not be carried into the fresh context.')`;
    const count = (await sql!`select count(*)::int as n from messages where thread_id=${home.id}::uuid`)[0]!['n'];
    const responses = await Promise.all([1, 2].map(() => request('/v1/team/fresh', { workspace, projectId, threadId: home.id })));
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const states = await Promise.all(responses.map(r => r.json())) as TeamDeskState[];
    replacement = states[0]!.homes.find(h => h.home_agent_id === home.home_agent_id)!;
    expect(states[1]!.homes.find(h => h.home_agent_id === home.home_agent_id)?.id).toBe(replacement.id);
    expect(replacement.id).not.toBe(home.id);
    expect(replacement).toMatchObject({ card_id: home.id, msg_count: 0, summary: null, summary_revision: 0, routine_count: 1, home_thinking: 'high' });
    expect(Object.values(JSON.parse(replacement.brain_override!))).toEqual(['gpt-5.6-sol']);
    expect((await sql!`select count(*)::int as n from messages where thread_id=${home.id}::uuid`)[0]!['n']).toBe(count);
    const history = await (await request(`/v1/team/threads?workspace=${workspace}&projectId=${projectId}&agentId=${home.home_agent_id}`)).json() as TeamHome[];
    expect(history).toHaveLength(1); expect(history[0]?.id).toBe(home.id); expect(history[0]?.archived_at).toBeTruthy();
    expect((await (await request(`/v1/team/context?workspace=${workspace}&threadId=${replacement.id}`)).json())).toMatchObject({ summary: null, revision: 0, messages: [] });
    const reopened = await (await request('/v1/team/open', { workspace, projectId })).json() as TeamDeskState;
    expect(reopened.homes.find(h => h.home_agent_id === home.home_agent_id)?.id).toBe(replacement.id);
  });
  it('reports an existing coding task into the new home without rewriting its origin', async () => {
    const [task] = await sql!`insert into tasks(workspace_id,channel_id,project_id,number,title,description,state,kind,creator_kind,creator_id,origin_thread_id)
      values(${workspace}::uuid,${home.channel_id}::uuid,${projectId}::uuid,700001,'Continue implementation','Keep working','todo','bug','agent',${home.home_agent_id}::uuid,${home.id}::uuid) returning id`;
    await sql!`insert into threads(workspace_id,channel_id,project_id,task_id,created_by,title,kind,mode) values(${workspace}::uuid,${home.channel_id}::uuid,${projectId}::uuid,${task!['id']}::uuid,${`human:${user}`},'Coding work','coding','chat')`;
    await sql!`select nm_coding_task_report(${task!['id']}::uuid,'runtime','awaiting_approval','Run tests')`;
    expect(await sql!`select id from messages where thread_id=${replacement.id}::uuid and body like '%Open the live review%'`).toHaveLength(1);
    expect((await sql!`select origin_thread_id from tasks where id=${task!['id']}::uuid`)[0]!['origin_thread_id']).toBe(home.id);
  });
  it('refuses stale sends and never resets the replacement on a retried request', async () => {
    expect((await request('/v1/messages', { workspace, project: projectId, threadId: home.id, body: 'Stale tab' })).status).toBe(409);
    expect((await request('/v1/messages', { workspace, project: projectId, threadId: replacement.id, body: 'New conversation' })).status).toBe(200);
    const state = await (await request('/v1/team/fresh', { workspace, projectId, threadId: home.id })).json() as TeamDeskState;
    expect(state.homes.find(h => h.home_agent_id === home.home_agent_id)?.id).toBe(replacement.id);
    expect(await sql!`select id from messages where thread_id=${replacement.id}::uuid and body like '%New conversation%'`).toHaveLength(1);
  });
});
