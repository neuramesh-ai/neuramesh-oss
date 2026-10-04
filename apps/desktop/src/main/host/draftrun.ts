// the scheduled draft run's two writes (George, 2026-09-27: every scheduled draft was an orphan).
//
// the drafting path in host/schedules.ts posted its message with no thread, so the message landed
// at the room root, and the sessions shell does not show the root. it saved the draft with a
// schedule id only, so content_items.thread_id and task_id were both null and no session held it.
//
// each run now opens one session in its room. the message births the thread with the routine
// branch's birth contract: a new thread id, plus the schedule id, which stamps the thread's origin
// as 'routine'. the draft then names that thread, so its card renders in the session. the order
// is the FK: content_items.thread_id references threads(id), so the message lands first.
//
// both writes go as the agent. agent messages never wake agents, so the new session wakes nobody.
// the first line is the session title (threadTitle takes a short first paragraph), so it is plain
// text in the routine's style: markdown there left a stray `**` on every rail row (2026-09-12).
type Actor = { kind: string; id: string; role?: string };
type PostFn = (path: string, actor: Actor, body: unknown) => Promise<Response>;

export interface DraftRun {
  schedule: { id: string; workspace_id: string; channel_id: string; title: string };
  /** the session this run opens: a new id for each run */
  threadId: string;
  /** the model's draft */
  reply: string;
  /** the slot the draft is for, as an ISO time */
  slotAt: string;
  /** the slot on the schedule's own clock, for example 09:00 */
  slotLabel: string;
}

/** pure: the message that opens the session, and the command that saves the draft into it */
export function draftRunWrites(run: DraftRun) {
  const { schedule: s, threadId } = run;
  return {
    message: { workspace: s.workspace_id, channel: s.channel_id, threadId, scheduleId: s.id, body: `Scheduled draft · ${s.title} · for ${run.slotLabel}\n\n${run.reply}` },
    draft: { type: 'content.create', channel: s.channel_id, thread: threadId, platform: 'x', body: run.reply, schedule: s.id, slotAt: run.slotAt },
  };
}

/** the two writes in their order, as the run's agent. a refused message throws before the draft */
export async function postDraftRun(post: PostFn, agent: { id: string; role: string }, run: DraftRun): Promise<void> {
  const actor = { kind: 'agent', id: agent.id, role: agent.role };
  const { message, draft } = draftRunWrites(run);
  const r = await post('/v1/messages', actor, message);
  if (!r.ok) throw new Error(`the server refused the draft's message (${r.status})`);
  // the draft's own failure stays quiet, as it did before: its message already holds the words
  await post('/v1/commands', actor, draft).catch(() => {});
}
