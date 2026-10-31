import { isCodingThread } from '@neuramesh/shared';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import type { HostedAgent } from '../agents';
import type { HostGuards } from './guards';

type Message = { id: string; channel_id: string; thread_id?: string | null; body: string };
type Routing = {
  agents: Map<string, HostedAgent>;
  processed: HostGuards['processed'];
  queueWake: (agent: HostedAgent, message: Message) => void;
};

/** Only server-authored collaboration metadata can wake an agent from another agent's post. */
export function routeTeamRequest(ctx: Routing & { db: ReplicaDatabase }, m: Message & { author_id: string; author_kind: string; team_source_thread_id?: string | null }): boolean {
  if (m.author_kind === 'human') return false;
  if (!m.team_source_thread_id || !m.thread_id) return true;
  ctx.processed.add(m.id);
  void (async () => {
    const request = await ctx.db.get<{ home_agent_id: string; source_owner: string }>(`select t.home_agent_id,s.home_agent_id as source_owner from messages m join threads t on t.id=m.thread_id join threads s on s.id=m.team_source_thread_id where m.id=? and t.archived_at is null and t.project_id=s.project_id and m.team_depth between 1 and 3`, [m.id]);
    const recipient = request && request.source_owner === m.author_id ? ctx.agents.get(request.home_agent_id) : null;
    if (recipient?.channels.has(m.channel_id)) ctx.queueWake(recipient, m);
    else ctx.processed.delete(m.id); // Recovery retries while the replica seats the owner.
  })().catch(e => { ctx.processed.delete(m.id); console.error('team request routing failed', e); });
  return true;
}

/** A home always speaks through its owner, independently of room orchestration. */
export function routeHomeOwner(ctx: Routing, ownerId: string | null | undefined, m: Message): boolean {
  if (!ownerId) return false;
  const owner = ctx.agents.get(ownerId);
  if (owner?.channels.has(m.channel_id)) ctx.queueWake(owner, m);
  else ctx.processed.delete(m.id);
  return true;
}

export async function routeOwnedThread(ctx: Routing & { db: ReplicaDatabase }, m: Message): Promise<boolean> {
  const thread = await ctx.db.get<{ kind: string | null; home_agent_id: string | null; archived_at?: string | null }>('select kind,home_agent_id,archived_at from threads where id=?', [m.thread_id!]);
  return !!(thread?.home_agent_id && thread.archived_at) || isCodingThread(thread?.kind) || routeHomeOwner(ctx, thread?.home_agent_id, m);
}
