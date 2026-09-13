// Channel membership keys on the channel's UUID id, NEVER its slug. After
// migration 0043 (channel_slug_per_project) a slug is unique only WITHIN a
// project, so two projects in one workspace can each own a same-slug room (e.g.
// #dev) with distinct ids. Matching membership by slug reports an agent
// registered to one project's #dev as a member of every #dev — which hid the
// "+ add to channel" affordance and made the orchestrator and the UI disagree.
// Always compare ids.

/**
 * True when `channelId` is among the agent's registered channel ids.
 *
 * @param registeredIds the agent's channel ids, comma-joined
 *   (agent_channels.channel_id; '' or null when the agent is in no channels)
 * @param channelId the target channel's UUID id ('' when there is no channel
 *   context — treated as "not a member")
 */
export function agentInChannel(registeredIds: string | null | undefined, channelId: string): boolean {
  if (!channelId || !registeredIds) return false;
  return registeredIds.split(',').map((s) => s.trim()).filter(Boolean).includes(channelId);
}
