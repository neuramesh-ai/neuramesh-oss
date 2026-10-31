import type postgres from 'postgres';
import type { Actor, TeamHome, TeamContext } from '@neuramesh/shared';
import { BrainError, brainThreadAccess } from '../brain-store';
import { seedStartupTeamSql } from './startup-team';

export async function teamProjectAccess(sql: postgres.Sql, actor: Actor, workspace: string, project: string) {
  const [row] = await sql`select p.id, p.context_channel_id from projects p where p.id = ${project}::uuid and p.workspace_id = ${workspace}::uuid and p.status <> 'archived'
    and ((${actor.kind} = 'human' and exists(select 1 from workspace_members wm where wm.workspace_id = p.workspace_id and wm.user_id = ${actor.id}::uuid))
      or (${actor.kind} = 'agent' and exists(select 1 from project_agents pa join agents a on a.id = pa.agent_id where pa.project_id = p.id and a.id = ${actor.id}::uuid and a.retired_at is null)))`;
  if (!row?.['context_channel_id']) throw new BrainError('NOT_FOUND', 'This project is not available to you.', 404);
  return row['context_channel_id'] as string;
}

export async function teamHomes(sql: postgres.Sql, workspace: string, project: string, historyAgentId?: string): Promise<TeamHome[]> {
  const rows = await sql`select t.*, coalesce(t.home_root_thread_id,t.id) as card_id, s.summary, coalesce(s.revision,0)::int as summary_revision,
    m.body as last_body, m.author_kind as last_author_kind,
    (select count(*)::int from messages where thread_id = t.id) as msg_count,
    (select count(*)::int from schedules where owner_home_thread_id = t.id) as routine_count,
    (select count(*)::int from tasks k join threads origin on origin.id=k.origin_thread_id where origin.project_id=t.project_id and origin.home_agent_id=t.home_agent_id and k.state not in ('accepted','closed')) as work_count
    from threads t join project_agents pa on pa.project_id = t.project_id and pa.agent_id = t.home_agent_id
    join agents a on a.id = pa.agent_id and a.retired_at is null
    left join lateral (select summary,revision from team_context_snapshots where thread_id=t.id order by revision desc limit 1) s on true
    left join lateral (select body,author_kind from messages where thread_id=t.id order by created_at desc,id desc limit 1) m on true
    where t.workspace_id=${workspace}::uuid and t.project_id=${project}::uuid and t.home_agent_id is not null
      and ((${historyAgentId ?? null}::uuid is null and t.archived_at is null) or (t.home_agent_id=${historyAgentId ?? null}::uuid and t.archived_at is not null))
    order by t.created_at,t.id`;
  return rows.map(r => ({ ...r, brain_override: r['brain_override'] ? JSON.stringify(r['brain_override']) : null })) as TeamHome[];
}

export async function ensureTeamHomes(sql: postgres.Sql, actor: Actor, workspace: string, project: string, agentId?: string) {
  if (actor.kind !== 'human') throw new BrainError('HUMAN_ONLY', 'Only a person can add an agent to Agent Desk.', 403);
  await sql.begin(async tx => {
    const q = tx as unknown as postgres.Sql;
    const channel = await teamProjectAccess(q, actor, workspace, project);
    // One project lock serializes additions from multiple devices, including membership writes.
    await q`select id from projects where id=${project}::uuid for update`;
    // The first visit also covers the default project created before any agents existed.
    // A desk with established homes is never silently restaffed on subsequent opens.
    if (!agentId && !(await q`select 1 from threads where project_id=${project}::uuid and home_agent_id is not null limit 1`).length) {
      await seedStartupTeamSql(q, workspace, project);
    }
    if (agentId) {
      const [a] = await q`select id from agents where id=${agentId}::uuid and workspace_id=${workspace}::uuid and retired_at is null`;
      if (!a) throw new BrainError('NOT_FOUND', 'This agent is not in this workspace.', 404);
      await q`insert into project_agents(workspace_id,project_id,agent_id) values(${workspace}::uuid,${project}::uuid,${agentId}::uuid) on conflict do nothing`;
    }
    await q`insert into threads(workspace_id,project_id,channel_id,home_agent_id,title,description,created_by,mode,kind,titled_at)
      select pa.workspace_id,pa.project_id,${channel}::uuid,a.id,a.name || ' · Agent thread',coalesce(a.brief,''),${`human:${actor.id}`},'chat','chat',now()
      from project_agents pa join agents a on a.id=pa.agent_id and a.retired_at is null
      where pa.project_id=${project}::uuid and (${agentId ?? null}::uuid is null or a.id=${agentId ?? null}::uuid)
      on conflict(project_id,home_agent_id) where home_agent_id is not null and archived_at is null do nothing`;
  });
}

export async function teamContext(sql: postgres.Sql, actor: Actor, workspace: string, threadId: string, mode: 'auto' | 'manual' = 'auto'): Promise<TeamContext> {
  const access = await brainThreadAccess(sql, actor, workspace, threadId);
  const [thread] = await sql`select home_agent_id,kind,archived_at from threads where id=${threadId}::uuid`;
  if (!thread || thread['kind'] === 'coding') return { home: null, summary: null, revision: 0, messages: [], compactThrough: null };
  if (thread['archived_at']) throw new BrainError('CONFLICT', 'This conversation is in history. Continue in the current agent thread.', 409);
  const home = thread['home_agent_id'] ? (await teamHomes(sql, workspace, access.project_id!)).find(t => t.id === threadId) ?? null : null;
  if (thread['home_agent_id'] && !home) throw new BrainError('NOT_FOUND', 'This agent is no longer on this project team.', 404);
  const [snapshot] = await sql`select s.*,m.created_at as through_at from team_context_snapshots s join messages m on m.id=s.through_message_id where s.thread_id=${threadId}::uuid order by s.revision desc limit 1`;
  const rows = await sql`select id,author_kind,author_id,body,created_at from messages where thread_id=${threadId}::uuid
    and (${snapshot?.['through_message_id'] ?? null}::uuid is null or (created_at,id)>(select created_at,id from messages where id=${snapshot?.['through_message_id'] ?? null}::uuid))
    order by created_at,id limit 100`;
  const messages = rows.map(r => ({ ...r, created_at: new Date(r['created_at']).toISOString() })) as TeamContext['messages'];
  const preserve = mode === 'manual' ? 1 : 20;
  const shouldCompact = mode === 'manual' || messages.length > 60 || messages.reduce((n,m) => n + m.body.length, 0) > 60000;
  return { home, threadId, projectId: access.project_id ?? undefined, compactedThroughAt: snapshot?.['through_at'] ? new Date(snapshot['through_at']).toISOString() : null, summary: snapshot?.['summary'] ?? null, revision: snapshot?.['revision'] ?? 0, messages,
    compactThrough: shouldCompact && messages.length > preserve ? messages[messages.length - preserve - 1]!.id : null };
}

export async function publishTeamContext(sql: postgres.Sql, actor: Actor, workspace: string, threadId: string, input: { revision: number; through: string; summary: string; mode?: 'auto' | 'manual' }) {
  return sql.begin(async tx => {
    const q = tx as unknown as postgres.Sql;
    await q`select id from threads where id=${threadId}::uuid for update`;
    const context = await teamContext(q, actor, workspace, threadId, input.mode);
    if (actor.kind !== 'agent' || !context.threadId || (context.home && actor.id !== context.home.home_agent_id)) throw new BrainError('NOT_PERMITTED', 'Only the owning agent can compact its thread.', 403);
    if (context.revision !== input.revision || context.compactThrough !== input.through) throw new BrainError('CONFLICT', 'The context changed; read it again before compacting.', 409);
    await q`insert into team_context_snapshots(workspace_id,thread_id,revision,through_message_id,summary)
      values(${workspace}::uuid,${threadId}::uuid,${input.revision + 1},${input.through}::uuid,${input.summary})`;
    return { revision: input.revision + 1 };
  });
}
