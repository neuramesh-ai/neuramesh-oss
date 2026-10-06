// the grant arms the work (docs/design/repo-connect-2026-10). when GitHub connects for a project,
// every open GitHub card in its rooms resumes in the same request, so nobody asks again:
//   · a task the claim blocked for GitHub returns to the stage it was blocked from, and its host's
//     resume watch takes it from there with the App's token.
//   · every other card gets the connected divider where the card is (its conversation, a room's
//     feed, or a task's thread), posted as the person who connected. the divider wakes the agent
//     there (shared/needs.ts), and its transcript reads "the person connected GitHub", so the agent
//     continues the ask. a task blocked for another reason stays blocked.
// the card's decision closes first, as answered by that person: the card polls the resolve every
// 5 s while it waits, so the resume runs on every connected answer and must find nothing the second time.
// only the /v1 calls run this (the resolve and the owner proof's prove call, github-resolve.ts `resume`),
// because their session proves the person.
import { createEvent, formatAddress, githubConnectedMarker, GITHUB_WAIT_REASON, type Actor } from '@neuramesh/shared';
import { fireWakeBump } from './fleet-lifecycle';
import { executeCommand } from './handler';
import type { Store } from './store';

export async function resumeAfterGitHub(store: Store, ctx: { workspace: string; channel: string; actor: string }, slug: string): Promise<number> {
  const waiting = await store.announcements?.openGitHubNeeds(ctx.channel).catch(() => []) ?? [];
  const person: Actor = { kind: 'human', id: ctx.actor };
  let resumed = 0;
  for (const w of waiting) {
    const closed = await executeCommand(store, person, { type: 'decision.answer', decisionId: w.decisionId, answer: `Connected ${slug}` }).then(() => true, () => false);
    if (!closed) continue;
    resumed++;
    const task = w.taskId ? await store.getTask(w.taskId).catch(() => null) : null;
    if (task?.state === 'blocked' && w.blockReason?.startsWith(GITHUB_WAIT_REASON)) {
      // the task's own thread shows the unblock, and the host's resume watch restarts the work
      await executeCommand(store, person, { type: 'task.unblock', taskId: task.id }).catch((e) => console.warn(`github resume: unblock failed: ${e instanceof Error ? e.message : String(e)}`));
      continue;
    }
    const body = githubConnectedMarker(slug);
    const event = createEvent({
      type: 'message.posted', source: formatAddress({ kind: 'human', id: ctx.actor }),
      target: w.taskId ? `task:${w.taskId}` : `channel/${w.channelId}`, workspace: ctx.workspace, payload: { preview: body },
    });
    await store.postMessage({ id: crypto.randomUUID(), workspace: ctx.workspace, channel: w.channelId, taskId: w.taskId, threadId: w.taskId ? null : w.threadId, author: { kind: 'human', id: ctx.actor }, body, createdAt: new Date().toISOString() }, event)
      .catch((e) => console.warn(`github resume: the divider did not post: ${e instanceof Error ? e.message : String(e)}`));
  }
  // a parked cloud machine wakes for the work, as a delivered message wakes it (POST /v1/messages)
  if (resumed > 0) fireWakeBump(store, ctx.workspace, ctx.actor);
  return resumed;
}
