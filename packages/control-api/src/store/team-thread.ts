import type postgres from 'postgres';
import { ROUTINE_SCHEDULED_MARKER, type Actor } from '@neuramesh/shared';
import { BrainError } from '../brain-store';
import { teamProjectAccess } from './team-desk';

/** Replace the active conversation, never its journal or the agent's project membership. */
export async function freshTeamThread(sql: postgres.Sql, actor: Actor, workspace: string, project: string, threadId: string) {
  if (actor.kind !== 'human') throw new BrainError('HUMAN_ONLY', 'Only a person can start a fresh agent thread.', 403);
  return sql.begin(async tx => {
    const q = tx as unknown as postgres.Sql;
    await teamProjectAccess(q, actor, workspace, project);
    const [identity] = await q`select home_agent_id from threads where id=${threadId}::uuid and project_id=${project}::uuid`;
    if (!identity?.['home_agent_id']) throw new BrainError('NOT_FOUND', 'This agent thread is not available.', 404);
    await q`select pg_advisory_xact_lock(hashtextextended(${'team-home:' + project + ':' + identity['home_agent_id']},0))`;
    await q`select pg_advisory_xact_lock(hashtextextended(${threadId}, 0))`;
    await q`select id from projects where id=${project}::uuid for update`;
    const [old] = await q`select t.* from threads t join project_agents pa on pa.project_id=t.project_id and pa.agent_id=t.home_agent_id
      join agents a on a.id=pa.agent_id and a.retired_at is null
      where t.id=${threadId}::uuid and t.project_id=${project}::uuid and t.workspace_id=${workspace}::uuid for update of t`;
    if (!old) throw new BrainError('NOT_FOUND', 'This agent thread is not available.', 404);
    // A retry or a second device returns the replacement; it cannot clear the new conversation.
    if (old['archived_at']) {
      const [current] = await q`select id from threads where project_id=${project}::uuid and home_agent_id=${old['home_agent_id']}::uuid and archived_at is null`;
      if (!current) throw new BrainError('CONFLICT', 'Reopen Agent Desk before starting a fresh thread.', 409);
      return current['id'] as string;
    }
    const [run] = await q`select id from runs where thread_id=${threadId}::uuid and state in ('running','parked') limit 1`;
    const [last] = await q`select author_kind,body from messages where thread_id=${threadId}::uuid order by created_at desc,id desc limit 1`;
    const [decision] = await q`select d.id from decisions d join messages m on m.id=d.message_id where m.thread_id=${threadId}::uuid and d.status='open' limit 1`;
    if (run || decision || (last?.['author_kind'] === 'human' && last['body'] !== ROUTINE_SCHEDULED_MARKER)) {
      throw new BrainError('CONFLICT', 'Wait for this agent’s current reply before starting a fresh thread. Coding tasks can continue separately.', 409);
    }
    if (!last) return threadId; // The empty state is already a fresh conversation.
    await q`update threads set archived_at=now() where id=${threadId}::uuid`;
    const [next] = await q`insert into threads(workspace_id,project_id,channel_id,home_agent_id,home_root_thread_id,title,description,created_by,mode,kind,titled_at,brain_override,home_thinking,origin,machine_id)
      select workspace_id,project_id,channel_id,home_agent_id,coalesce(home_root_thread_id,id),title,description,created_by,'chat','chat',now(),brain_override,home_thinking,origin,machine_id
      from threads where id=${threadId}::uuid returning id`;
    // Ownership moves; existing runs, messages, artifacts and the coding task's origin stay auditable.
    await q`update schedules set owner_home_thread_id=${next!['id']}::uuid where owner_home_thread_id=${threadId}::uuid`;
    return next!['id'] as string;
  });
}
