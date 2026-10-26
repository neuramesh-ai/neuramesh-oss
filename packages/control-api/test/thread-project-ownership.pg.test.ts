import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresStore } from '../src/pgstore';
import { createApp } from '../src/app';
import { brainThreadAccess } from '../src/brain-store';
import { backfillThreadProjects } from '../src/thread-project-backfill';
import { projectMigrationAudit } from '../src/project-migration-audit';

const DB = process.env['DATABASE_URL'];
const sql = DB ? postgres(DB, { max: 5 }) : null;
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
let workspace: string;
let project: string;
let channel: string;
let otherProject: string;
let otherChannel: string;
let owner: { kind: 'human'; id: string };
const actorHeaders = () => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(owner) });
const send = (path: string, body: unknown) => app!.request(path, { method: 'POST', headers: actorHeaders(), body: JSON.stringify(body) });
const row = async (id: string) => (await sql!`select id, project_id, channel_id, workspace_id, title, updated_at from threads where id = ${id}::uuid`)[0]!;
async function thread() {
  const id = randomUUID();
  const response = await send('/v1/messages', { workspace, channel, threadId: id, body: 'Project ownership fixture' });
  expect(response.status).toBe(200);
  return id;
}

beforeAll(async () => {
  if (!sql) return;
  const [u] = await sql`insert into nm_users(clerk_user_id, email) values (${randomUUID()}, ${`${randomUUID()}@project.test`}) returning id`;
  owner = { kind: 'human', id: u!['id'] as string };
  const response = await send('/v1/commands', { type: 'workspace.create', name: 'Project ownership', slug: `ownership-${randomUUID().slice(0, 8)}` });
  expect(response.status).toBe(200);
  workspace = (await response.json() as { workspaceId: string }).workspaceId;
  const [c] = await sql`select id, project_id from channels where workspace_id = ${workspace}::uuid and slug = 'general'`;
  channel = c!['id'] as string; project = c!['project_id'] as string;
  const [p] = await sql`insert into projects(workspace_id,name,slug) values (${workspace}::uuid,'Other','other') returning id`;
  otherProject = p!['id'] as string;
  const [oc] = await sql`insert into channels(workspace_id,project_id,slug) values (${workspace}::uuid,${otherProject}::uuid,'other') returning id`;
  otherChannel = oc!['id'] as string;
  const [agent] = await sql`insert into agents(workspace_id, name, role, runtime, model)
    values (${workspace}::uuid, 'ownership-rex', 'orchestrator', 'claude-code', 'test') returning id`;
  await sql`insert into agent_channels(agent_id, channel_id) values (${agent!['id']}::uuid, ${channel}::uuid)`;

});
afterAll(async () => { await sql?.end(); await store?.close(); });

describe.skipIf(!DB)('project ownership with legacy channel contracts', () => {
  it('creates a usable project without room choices and sends by project alone', async () => {
    const created = await send('/v1/commands', { type: 'project.create', workspace, name: 'Project only' });
    expect(created.status).toBe(200);
    const { projectId } = await created.json() as { projectId: string };
    const [p] = await sql!`select context_channel_id from projects where id = ${projectId}::uuid`;
    expect(p?.['context_channel_id']).toBeTruthy();
    expect(await sql!`select id from channels where project_id = ${projectId}::uuid`).toHaveLength(1);
    const id = randomUUID();
    const input = { workspace, project: projectId, threadId: id, body: 'New project thread', id: randomUUID() };
    expect((await send('/v1/messages', input)).status).toBe(200);
    expect((await send('/v1/messages', input)).status).toBe(200);
    expect(await row(id)).toMatchObject({ project_id: projectId, channel_id: p!['context_channel_id'] });
    expect(await sql!`select id from messages where thread_id = ${id}::uuid`).toHaveLength(1);
    expect((await send('/v1/messages', { workspace, project: projectId, channel, body: 'Wrong address' })).status).toBe(409);
    expect((await send('/v1/messages', { workspace, project: otherProject, threadId: id, body: 'Wrong project' })).status).toBe(409);
    expect((await send('/v1/messages', { workspace, project: randomUUID(), body: 'Missing project' })).status).toBe(404);
  });

  it('rejects a task from another project before writing a project-scoped message', async () => {
    const made = await send('/v1/commands', { type: 'task.create', workspace, channel: otherChannel, title: 'Other project task' });
    expect(made.status).toBe(200);
    const { task } = await made.json() as { task: { id: string } };
    const id = randomUUID();
    expect((await send('/v1/messages', { workspace, project, channel, taskId: task.id, id, body: 'Wrong task' })).status).toBe(409);
    expect(await sql!`select id from messages where id = ${id}::uuid`).toHaveLength(0);
  });

  it('serializes simultaneous thread births with conflicting project intent', async () => {
    const id = randomUUID();
    const responses = await Promise.all([project, otherProject].map(p => send('/v1/messages', {
      workspace, project: p, threadId: id, body: 'Concurrent project birth',
    })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await sql!`select id from messages where thread_id = ${id}::uuid`).toHaveLength(1);
  });

  it('bridges project team membership to the default context without widening historical grants', async () => {
    const [a] = await sql!`select a.id from agents a where a.workspace_id = ${workspace}::uuid and a.retired_at is null limit 1`;
    const agent = a!['id'] as string;
    const [p] = await sql!`select context_channel_id from projects where id = ${project}::uuid`;
    const context = p!['context_channel_id'] as string;
    const historical = await sql!`select channel_id from agent_channels where agent_id = ${agent}::uuid and channel_id <> ${context}::uuid order by channel_id`;
    await sql!`delete from project_agents where project_id = ${project}::uuid and agent_id = ${agent}::uuid`;
    expect(await sql!`select 1 from agent_channels where channel_id = ${context}::uuid and agent_id = ${agent}::uuid`).toHaveLength(0);
    await sql!`insert into project_agents(workspace_id, project_id, agent_id) values (${workspace}::uuid, ${project}::uuid, ${agent}::uuid)`;
    expect(await sql!`select 1 from agent_channels where channel_id = ${context}::uuid and agent_id = ${agent}::uuid`).toHaveLength(1);
    expect(await sql!`select channel_id from agent_channels where agent_id = ${agent}::uuid and channel_id <> ${context}::uuid order by channel_id`).toEqual(historical);
    await expect(sql!`update project_agents set workspace_id = ${randomUUID()}::uuid where project_id = ${project}::uuid and agent_id = ${agent}::uuid`).rejects.toMatchObject({ code: '23514' });
  });

  it('derives project for an old message writer and preserves it on repeated sends', async () => {
    const id = await thread();
    expect((await row(id))['project_id']).toBe(project);
    expect((await send('/v1/messages', { workspace, channel, threadId: id, body: 'Another message' })).status).toBe(200);
    expect((await row(id))['project_id']).toBe(project);
    expect(await store!.threadFiling(workspace, id)).toMatchObject({ projectId: project, channelId: channel });
    expect(await brainThreadAccess(sql!, owner, workspace, id)).toMatchObject({ project_id: project });
  });

  it('refuses explicit conflicting projects and foreign workspace channels', async () => {
    await expect(sql!`insert into threads(workspace_id, channel_id, project_id) values (${workspace}::uuid, ${channel}::uuid, ${otherProject}::uuid)`).rejects.toMatchObject({ code: '23514' });
    const foreign = 'a0000000-0000-0000-0000-00000000000a';
    await expect(sql!`insert into threads(workspace_id, channel_id) values (${foreign}::uuid, ${channel}::uuid)`).rejects.toMatchObject({ code: '23514' });
    await expect(sql!`insert into channels(workspace_id, project_id, slug) values (${foreign}::uuid, ${project}::uuid, 'foreign')`).rejects.toMatchObject({ code: '23514' });
    const id = await thread();
    await expect(sql!`update threads set project_id = ${otherProject}::uuid where id = ${id}::uuid`).rejects.toMatchObject({ code: '23514' });
  });

  it('moves a legacy thread with its messages and keeps project ownership consistent', async () => {
    const id = await thread();
    await store!.moveThread(workspace, id, otherChannel, 'Fixture move', false);
    expect(await row(id)).toMatchObject({ project_id: otherProject, channel_id: otherChannel });
    expect(await sql!`select distinct channel_id from messages where thread_id = ${id}::uuid`).toEqual([{ channel_id: otherChannel }]);
  });

  it('moves a room atomically without changing thread IDs, timestamps or agent grants', async () => {
    const id = await thread();
    const before = await row(id);
    const grants = await sql!`select * from agent_channels where channel_id = ${channel}::uuid order by agent_id`;
    await sql!`update channels set project_id = ${otherProject}::uuid where id = ${channel}::uuid`;
    expect(await row(id)).toEqual({ ...before, project_id: otherProject });
    expect(await sql!`select * from agent_channels where channel_id = ${channel}::uuid order by agent_id`).toEqual(grants);
    await sql!`update channels set project_id = ${project}::uuid, slug = 'restored-general' where id = ${channel}::uuid`;
    expect(await row(id)).toEqual(before);
  });

  it('backfills old rows in bounded resumable batches and preserves the full rows except project', async () => {
    // Restrict the old-row fixture to this transaction. No other writer can see the disabled trigger.
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await sql!.begin(async tx => {
      await tx`alter table threads disable trigger threads_project_guard`;
      for (const id of ids) await tx`insert into threads(id, workspace_id, channel_id, title) values (${id}::uuid, ${workspace}::uuid, ${channel}::uuid, 'Legacy fixture')`;
      await tx`alter table threads enable trigger threads_project_guard`;
    });
    const before = await sql!`select to_jsonb(t) - 'project_id' as data from threads t where id in ${sql!(ids)} order by id`;
    expect(await store!.threadFiling(workspace, ids[0]!)).toMatchObject({ projectId: project });
    expect(await backfillThreadProjects(sql!, workspace, { batchSize: 1, maxBatches: 1 })).toEqual({ updated: 1, remaining: 2, conflicts: 0 });
    expect(await backfillThreadProjects(sql!, workspace, { batchSize: 2, maxBatches: 2 })).toEqual({ updated: 2, remaining: 0, conflicts: 0 });
    expect(await backfillThreadProjects(sql!, workspace, { batchSize: 2, maxBatches: 2 })).toEqual({ updated: 0, remaining: 0, conflicts: 0 });
    expect(await sql!`select to_jsonb(t) - 'project_id' as data from threads t where id in ${sql!(ids)} order by id`).toEqual(before);
  });

  it('does not widen legacy agent access or private coding access', async () => {
    const id = await thread();
    const [a] = await sql!`select a.id from agents a join agent_channels ac on ac.agent_id = a.id where ac.channel_id = ${channel}::uuid and a.retired_at is null limit 1`;
    const actor = { kind: 'agent' as const, id: a!['id'] as string, role: 'orchestrator' as const };
    expect(await brainThreadAccess(sql!, actor, workspace, id)).toMatchObject({ project_id: project });
    await sql!`delete from agent_channels where channel_id = ${channel}::uuid and agent_id = ${actor.id}::uuid`;
    await expect(brainThreadAccess(sql!, actor, workspace, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await sql!`insert into agent_channels(agent_id,channel_id) values (${actor.id}::uuid, ${channel}::uuid)`;
    await sql!`update threads set kind = 'coding' where id = ${id}::uuid`;
    await expect(brainThreadAccess(sql!, actor, workspace, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await brainThreadAccess(sql!, owner, workspace, id)).toMatchObject({ project_id: project });
  });

  it('reads separate project summaries while retaining legacy scope and agent restrictions', async () => {
    const [p] = await sql!`select context_channel_id from projects where id = ${project}::uuid`;
    for (const address of [channel, p!['context_channel_id'] as string]) {
      await sql!`insert into memory_blocks(workspace_id, channel_id, kind, content, basis_count)
        values (${workspace}::uuid, ${address}::uuid, 'channel_summary', ${`Summary ${address}`}, 2)`;
    }
    const result = await app!.request(`/v1/memory?workspace=${workspace}&channel=project:${project}`, { headers: actorHeaders() });
    expect(result.status).toBe(200);
    expect((await result.json() as { blocks: unknown[] }).blocks).toHaveLength(2);
    expect((await store!.channelMemory(workspace, channel)).blocks).toHaveLength(1);
    const [a] = await sql!`select id from agents where workspace_id = ${workspace}::uuid limit 1`;
    const denied = await app!.request(`/v1/memory?workspace=${workspace}&channel=project:${project}`, { headers: { 'x-nm-actor': JSON.stringify({ kind: 'agent', id: a!['id'], role: 'orchestrator' }) } });
    expect(denied.status).toBe(403);
  });

  it('keeps project defaults and the compatibility context in sync without changing historical profiles', async () => {
    const [p] = await sql!`select context_channel_id from projects where id = ${project}::uuid`;
    const context = p!['context_channel_id'];
    const old = await sql!`select id, marketing, settings from channels where project_id = ${project}::uuid and id <> ${context}::uuid order by id`;
    await sql!`update projects set brand_profile = '{"website":"https://example.test"}'::jsonb where id = ${project}::uuid`;
    expect((await sql!`select marketing from channels where id = ${context}::uuid`)[0]!['marketing']).toEqual({ website: 'https://example.test' });
    await sql!`update channels set settings = '{"tone":"concise"}'::jsonb where id = ${context}::uuid`;
    expect((await sql!`select settings from projects where id = ${project}::uuid`)[0]!['settings']).toEqual({ tone: 'concise' });
    expect(await sql!`select id, marketing, settings from channels where project_id = ${project}::uuid and id <> ${context}::uuid order by id`).toEqual(old);
  });

  it('assigns project ownership to new attachments and validates library workspace boundaries', async () => {
    const response = await send('/v1/commands', { type: 'artifact.create', channel, kind: 'doc', name: 'Ownership test', inlineContent: 'Kept original' });
    expect(response.status).toBe(200);
    const [file] = await sql!`select id, project_id, inline_content from artifacts where workspace_id = ${workspace}::uuid and name = 'Ownership test'`;
    expect(file).toMatchObject({ project_id: project, inline_content: 'Kept original' });
    const foreign = (await sql!`select id from projects where workspace_id <> ${workspace}::uuid limit 1`)[0]!['id'];
    await expect(sql!`update artifacts set project_id = ${foreign}::uuid where id = ${file!['id']}::uuid`).rejects.toMatchObject({ code: '23514' });
  });

  it('audits metadata in a read-only transaction and flags different grants', async () => {
    await sql!`insert into channels(workspace_id,project_id,slug) values (${workspace}::uuid,${project}::uuid,'audit-empty')`;
    const audit = await projectMigrationAudit(sql!, workspace);
    expect(audit.readOnly).toBe(true);
    expect(audit.projects.every(p => p['workspace_id'] === workspace)).toBe(true);
    expect(audit.projects.find(p => p['id'] === project)?.review.differentAgentGrants).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('Project ownership fixture');
  });
});
