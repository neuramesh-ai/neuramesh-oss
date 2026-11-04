import type postgres from 'postgres';
import { DomainError } from '../errors';
import type { NMMessage } from './types';

/** Serialize a send with an Agent Desk conversation switch before resolving its address. */
export async function messageThreadScope(sql: postgres.Sql, msg: NMMessage) {
  if (!msg.threadId) return undefined;
  const [thread] = await sql`select t.workspace_id,t.channel_id,t.home_agent_id,t.archived_at,coalesce(t.project_id,c.project_id) as project_id
    from threads t join channels c on c.id=t.channel_id where t.id=${msg.threadId}::uuid for update of t`;
  if (thread && thread['workspace_id'] !== msg.workspace) throw new DomainError('NOT_FOUND', 'Thread not found in this workspace.');
  if (thread?.['home_agent_id'] && thread['archived_at'] && msg.author.kind === 'human') {
    throw new DomainError('CONFLICT', 'This conversation is in history. Continue in the agent’s current Agent Desk thread.');
  }
  return thread;
}
