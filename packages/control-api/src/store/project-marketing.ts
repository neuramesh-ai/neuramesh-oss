import type postgres from 'postgres';
import { MARKETING_SETUP_FLOW } from '@neuramesh/shared';
import { DomainError } from '../errors';
import { addMarketersToChannelSql } from './marketing-crew';

/** Keep the row lock, team grant and event in the same transaction. */
export function startProjectMarketing(sql: postgres.Sql, projectId: string, userId: string, record: (tx: postgres.Sql, workspace: string) => Promise<unknown>): Promise<{ channelId: string; taskId: string }> {
  return sql.begin((_tx) => {
    const tx = _tx as unknown as postgres.Sql;
    return startProjectMarketingSql(tx, projectId, userId, async (workspace) => { await record(tx, workspace); });
  }) as Promise<{ channelId: string; taskId: string }>;
}

/** Explicit project entry point. The project lock serializes double clicks and concurrent tabs.
 * Membership is granted only when setup is first created; resuming never undoes a removal. */
export async function startProjectMarketingSql(sql: postgres.Sql, projectId: string, userId: string, record: (workspace: string) => Promise<void>) {
  const [project] = await sql`select workspace_id, context_channel_id from projects
    where id = ${projectId}::uuid and status = 'active' for update`;
  if (!project) throw new DomainError('NOT_FOUND', 'active project not found');
  const channelId = project['context_channel_id'] as string | null;
  if (!channelId) throw new DomainError('INVALID_INPUT', 'project context is not ready');
  const workspace = project['workspace_id'] as string;
  const [member] = await sql`select 1 from workspace_members where workspace_id = ${workspace}::uuid and user_id = ${userId}::uuid`;
  if (!member) throw new DomainError('NOT_PERMITTED', 'project membership required');
  const [existing] = await sql`select id, state from tasks where channel_id = ${channelId}::uuid and kind = 'setup'`;
  if (existing) {
    // Closing is a pause until the person explicitly chooses Set up marketing again.
    if (existing['state'] === 'closed') await sql`update tasks set state = 'todo', updated_at = now() where id = ${existing['id']}::uuid`;
    return { channelId, taskId: existing['id'] as string };
  }
  const [n] = await sql`select nm_next_task_number(${workspace}::uuid) as n`;
  const [task] = await sql`insert into tasks
    (workspace_id, channel_id, project_id, number, title, description, state, kind, creator_kind, creator_id)
    select c.workspace_id, c.id, c.project_id, ${Number(n!['n'])}, ${MARKETING_SETUP_FLOW.title}, ${MARKETING_SETUP_FLOW.description},
      case when c.marketing->>'setup_at' is not null then 'done'::task_state else 'todo'::task_state end,
      'setup'::task_kind, 'human'::actor_kind,
      coalesce(case when c.created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then c.created_by::uuid end,
        (select user_id from workspace_members where workspace_id = c.workspace_id and role = 'owner' limit 1))
    from channels c where c.id = ${channelId}::uuid and c.project_id = ${projectId}::uuid
    returning id`;
  if (!task) throw new DomainError('INVALID_INPUT', 'project context is not available');
  await addMarketersToChannelSql(sql, workspace, channelId);
  await record(workspace);
  return { channelId, taskId: task['id'] as string };
}
