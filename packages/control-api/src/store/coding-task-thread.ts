import type { NMMessage } from '../store';
import type postgres from 'postgres';
import { DomainError } from '../errors';

/** Legacy task events name a channel slug, which can repeat across projects. */
export async function taskMessageAddress(sql: postgres.Sql, message: NMMessage): Promise<string> {
  if (!message.taskId) return message.channel;
  const [task] = await sql`select t.channel_id,c.slug from tasks t join channels c on c.id=t.channel_id
    where t.id=${message.taskId}::uuid and t.workspace_id=${message.workspace}::uuid`;
  if (!task) throw new DomainError('NOT_FOUND', 'Task not found in this workspace.');
  if (message.channel && message.channel !== task['channel_id'] && message.channel !== task['slug']) {
    throw new DomainError('CONFLICT', 'The task belongs to another conversation context.');
  }
  return String(task['channel_id']);
}

/** Called in the task transaction. A home never becomes the task's conversation. */
export async function createCodingTaskThread(sql: postgres.Sql, taskId: string, owner: string) {
  const [task] = await sql`select * from tasks where id=${taskId}::uuid`;
  if (!task) throw new Error('Coding task not found.');
  if (task['offered_agent_id']) {
    await sql`insert into project_agents(workspace_id,project_id,agent_id) values(${task['workspace_id']}::uuid,${task['project_id']}::uuid,${task['offered_agent_id']}::uuid) on conflict do nothing`;
    await sql`insert into agent_channels(agent_id,channel_id) values(${task['offered_agent_id']}::uuid,${task['channel_id']}::uuid) on conflict do nothing`;
  }
  const [home] = await sql`select brain_override,origin,machine_id,home_thinking from threads
    where workspace_id=${task['workspace_id']}::uuid and project_id=${task['project_id']}::uuid
      and home_agent_id=${task['offered_agent_id']}::uuid and created_by=${`human:${owner}`} and archived_at is null
    order by created_at limit 1`;
  const [thread] = await sql`insert into threads(workspace_id,channel_id,project_id,task_id,title,description,created_by,kind,mode,titled_at,brain_override,origin,machine_id,home_thinking)
    values(${task['workspace_id']}::uuid,${task['channel_id']}::uuid,${task['project_id']}::uuid,${taskId}::uuid,${task['title']},${task['description']},${`human:${owner}`},'coding','tasks',now(),${home?.['brain_override'] ? sql.json(home['brain_override']) : null},${home?.['origin'] ?? null},${home?.['machine_id'] ?? null}::uuid,${home?.['home_thinking'] ?? null})
    on conflict(task_id) where task_id is not null do update set kind='coding',mode='tasks',created_by=excluded.created_by returning id,root_message_id`;
  // Preserve all older task messages; the task now has a canonical coding conversation.
  await sql`update messages set thread_id=${thread!['id']}::uuid where task_id=${taskId}::uuid and thread_id is null`;
  if (!thread!['root_message_id']) {
    const [message] = await sql`insert into messages(workspace_id,channel_id,task_id,thread_id,author_kind,author_id,body)
      values(${task['workspace_id']}::uuid,${task['channel_id']}::uuid,${taskId}::uuid,${thread!['id']}::uuid,${task['creator_kind']}::actor_kind,${task['creator_id']}::uuid,
        ${`Implementation handoff: ${task['title']}\n\n${task['description']}\n\nThe coding agent picks this up after the implementation plan is approved here. Progress and the result are also reported to the parent agent thread.`}) returning id`;
    await sql`update threads set root_message_id=${message!['id']}::uuid where id=${thread!['id']}::uuid`;
  }
  return String(thread!['id']);
}

/** Task lifecycle/review messages join the same canonical conversation as native activity. */
export async function bindCodingTaskMessage(sql: postgres.Sql, message: NMMessage): Promise<NMMessage> {
  if (!message.taskId || message.threadId) return message;
  const [thread] = await sql`select id from threads where task_id=${message.taskId}::uuid and workspace_id=${message.workspace}::uuid and channel_id=${message.channel}::uuid and kind='coding'`;
  return thread ? { ...message, threadId:String(thread['id']) } : message;
}
