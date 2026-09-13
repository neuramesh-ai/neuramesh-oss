// Who is actively typing/working ON a specific task — the presence signal an individual
// task thread shows above its composer. Deliberately NARROWER than channel presence: a task
// thread must reflect only that task's work. An agent typing in another thread, or the
// orchestrator triaging elsewhere in the room, must never surface here — channel-wide "who's
// busy" belongs on the channel composer, not on an individual thread.
//
// `assignee_id` is the task's current owner across the whole FSM — the developer while it's
// in_progress, the reviewer while it's in_review (the server reassigns it on review claim), so
// "typing on this task" == "the assignee, live and busy". The live thread-streamer is rendered
// separately (the composer stream bar), so it's excluded here to avoid a duplicate chip.

export interface TypistAgent {
  id: string;
  name: string;
  /** synced presence: 'thinking' | 'working' surface as active; anything else is at rest */
  status: string;
}

/**
 * The agents to show as "typing/working" in a task thread's presence bar.
 *
 * @param agents the live roster
 * @param assigneeId the task's current owner (tasks.assignee_id); null → nobody, returns []
 * @param isLive host-liveness gate (the machine heartbeat — a stale status row on a dead host
 *   never paints a chip); injected so this stays pure and free of the MachineRow shape
 * @param streamingAgentName the agent currently streaming a reply INTO this thread, if any —
 *   excluded so it isn't shown twice (the composer stream bar already renders it)
 */
export function taskTypists<A extends TypistAgent>(
  agents: A[],
  assigneeId: string | null | undefined,
  isLive: (a: A) => boolean,
  streamingAgentName?: string | null,
): A[] {
  if (!assigneeId) return [];
  return agents.filter(
    (a) =>
      a.id === assigneeId &&
      (a.status === 'thinking' || a.status === 'working') &&
      a.name !== streamingAgentName &&
      isLive(a),
  );
}
