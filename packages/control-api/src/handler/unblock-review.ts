import type { Command } from '../commands';
import { assertSubmittedVisualEvidence } from './coding-handoff';
import type { Store } from '../store';

/** Older reviewers returned a failing PR check to implementation. If the next pass
 * explicitly recorded that there was no new work, an unblock must recheck the
 * existing submission. It never approves it or skips a person's change request. */
export async function submittedReviewVersion(store: Store, taskId: string): Promise<number | null> {
  const task = await store.getTask(taskId);
  if (task?.state !== 'blocked' || task.blockedFrom !== 'in_progress' || !task.submittedSha || !task.prNumber) return null;
  const events = (await store.listEvents(`task:${task.number}`)).filter(e => e.workspace === task.workspace);
  const blocked = events.findLast(e => e.type === 'task.blocked');
  if (!/^execution failed \d+× — no work product — nothing changed in the worktree\b/.test(String(blocked?.payload.reason))) return null;
  const submission = events.findLastIndex(e => e.type === 'task.submitted');
  if (submission < 0 || events[submission]?.payload.sha !== task.submittedSha) return null;
  const review = events.slice(submission+1).findLast(e => e.type === 'task.changes_requested' || e.type === 'task.approved');
  return review?.type === 'task.changes_requested' && review.source.startsWith('agent:') &&
    /^CI is red on the pull request — `[^\n`]+` failed\. Fix it so the checks pass, then re-submit\.$/.test(String(review.payload.feedback))
    ? task.version : null;
}


export async function prepareReviewTransition(store: Store, cmd: Extract<Command,{taskId:string}>) {
  if (cmd.type === 'task.submit') await assertSubmittedVisualEvidence(store,cmd.taskId,cmd.artifacts);
  if (cmd.type === 'task.approve') await assertSubmittedVisualEvidence(store,cmd.taskId);
  return cmd.type === 'task.unblock' ? submittedReviewVersion(store,cmd.taskId) : null;
}
