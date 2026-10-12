import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import { GITHUB_NEED_PREFIX } from '@neuramesh/shared';
import type { HostedAgent, ThreadTask } from '../agents';

/** Continue the agent whose GitHub card was answered, or the room's coordinator if it left. */
export async function githubAsker(db: ReplicaDatabase, agents: Map<string, HostedAgent>, task: ThreadTask): Promise<HostedAgent | undefined> {
  const [card] = await db.getAll<{ asker_id: string }>(`select asker_id from decisions where task_id = ? and question like ? and status = 'answered' order by answered_at desc limit 1`, [task.id, `${GITHUB_NEED_PREFIX}%`]).catch(() => [] as Array<{ asker_id: string }>);
  const asker = card ? agents.get(card.asker_id) : undefined;
  return asker?.channels.has(task.channel_id) ? asker : [...agents.values()].find((agent) => agent.role === 'orchestrator' && agent.channels.has(task.channel_id));
}
