import type { AttDbLike, HostedAgent } from '../agents';
import type { EngineeringMachineOpenMeta } from '../../engineering-protocol';
import type { EngineeringDisplayContext } from './engineering-display';

/** Bind shared display tools to the authenticated coding thread's room. */
export async function resolveEngineeringDisplayContext(db: AttDbLike, apiUrl: string, workspaceId: string, meta: EngineeringMachineOpenMeta): Promise<EngineeringDisplayContext | null> {
  const room = (await db.getAll<{ id: string; slug: string; workspace_id: string }>(
    'select c.id, c.slug, c.workspace_id from threads t join channels c on c.id = t.channel_id where t.id = ? and c.workspace_id = ?', [meta.threadId, workspaceId]))[0];
  if (!room) return null;
  return { ...room, shareImage: async (agent, brief) => {
    const profiles = await db.getAll<Pick<HostedAgent, 'id' | 'name' | 'runtime' | 'model'> & { role: string }>(
      `select a.id, a.name, coalesce(a.runtime, 'claude-code') as runtime, a.model, a.role from agents a
       where a.workspace_id = ? and a.retired_at is null and (a.id = ? or (a.role = 'designer' and a.id in (select agent_id from agent_channels where channel_id = ?)))`, [workspaceId, agent.id, room.id]);
    const speaker = profiles.find(profile => profile.id === agent.id);
    if (!speaker) return { error: 'The selected agent is no longer available in this workspace.' };
    const { shareImage } = await import('../host/share-image');
    return shareImage({ apiUrl, ownerActorId: meta.actorId, db, designer: profiles.find(profile => profile.role === 'designer') }, speaker, room, brief);
  } };
}
