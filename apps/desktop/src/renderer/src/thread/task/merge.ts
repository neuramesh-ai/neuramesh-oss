// AN ANCHORED UNIT'S OWN ROWS RIDE BESIDE THE CONVERSATION'S (2026-09-20). #526 pointed an anchored
// unit's panel at the conversation that OWNS it, so the brain chip edits that thread — and the thread
// union reads a thread's own task (`threads.task_id`), never the units anchored to it
// (`tasks.origin_thread_id`), so the unit's plan card, its claim line and its deliverables left the
// one surface that carries the Approve. Since v0.135.0 a conversation-born unit could not be
// plan-approved from the UI at all (George's #1096, "sitting in plan_review"). Pure, so it is tested.

/** two transcripts as one, by time then id; a row both name appears once */
export function mergeTranscript<T extends { id: string; created_at: string }>(a: readonly T[], b: readonly T[]): T[] {
  const seen = new Set<string>();
  return [...a, ...b]
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((x, y) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id));
}
