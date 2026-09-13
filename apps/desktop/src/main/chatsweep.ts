// Boot dead-letter selection for chat. The live wake watches only see messages with
// created_at AFTER host boot — a message sent while NO host was running (the
// phone-while-away case) predates every later boot and would otherwise go unanswered
// FOREVER. On roster load the host sweeps a bounded window of human messages back
// through the same wake decision path; this module is the pure "which ones" logic.
//
// A message is a dead letter when no agent has posted in its conversation SINCE it
// arrived — the conversation key is the task thread for thread messages and the
// channel feed for channel messages. "Any later agent post" (not just a direct
// reply) is deliberate: reply_to is not synced to the replica, and a room an agent
// has spoken in since is a room where the loop was alive — re-answering there risks
// duplicating deterministic card flows (hire/add confirms). Double-reply safety does
// NOT rest on this filter: the server's exactly-once index (one reply per
// agent + trigger, 0060) makes a racing sweep stand down.

export interface SweepCandidate {
  id: string;
  channel_id: string;
  task_id: string | null;
  /** the CHAT thread this message belongs to, null for a channel-feed message */
  thread_id: string | null;
  author_kind: string;
  author_id: string;
  body: string;
  created_at: string;
}

/**
 * The conversation key: a task thread converses per TASK, a chat thread per THREAD, and the feed
 * per CHANNEL.
 *
 * The middle rung was missing, and that is the bug (George, 2026-08-29). A chat thread has no
 * task_id, so it fell through to the channel — which meant ANY agent post anywhere in the room
 * cleared it: a reply in an unrelated thread, a digest, the no-compute notice. A message could sit
 * unanswered forever in a room that was otherwise busy, and the busier the room the more certainly
 * it stayed buried.
 *
 * The coarseness was deliberate for the FEED, and stays: a room an agent has spoken in since is a
 * room where the loop was alive, and re-answering there risks duplicating the deterministic card
 * flows (hire/add confirms) that live on the feed. None of that argument reaches inside a thread,
 * where "did anyone answer THIS conversation" is answerable exactly. Double-reply safety never
 * rested on this filter anyway — the server's exactly-once index (one reply per agent + trigger,
 * 0060) is what makes a racing sweep stand down.
 */
export function conversationKey(m: { channel_id: string; task_id: string | null; thread_id?: string | null }): string {
  return m.task_id ?? m.thread_id ?? m.channel_id;
}

// latestAgentAt: conversationKey → the newest agent-authored created_at in that
// conversation (ISO strings compare lexicographically). A candidate survives when
// no agent has posted after it.
export function pickDeadLetters(humans: SweepCandidate[], latestAgentAt: Map<string, string>): SweepCandidate[] {
  return humans.filter((m) => {
    const agentAt = latestAgentAt.get(conversationKey(m));
    return !agentAt || agentAt <= m.created_at;
  });
}
