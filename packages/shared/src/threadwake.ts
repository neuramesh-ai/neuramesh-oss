/**
 * Who answers a thread reply that names nobody.
 *
 * Lives in @neuramesh/shared because the WAKE and the UI must read one policy. The thread's
 * waiting orb (waitghost-rule.ts) promises "somebody answers this", and a promise the wake path
 * will not keep is the same lie the orb exists to remove — so the surface asks this function
 * rather than guessing from the FSM state a second time.
 *
 * An @mention (or a bare name opening the reply) always wins and is resolved by the
 * caller. This is the fallback: the human replied in a task thread without addressing
 * anyone, and somebody has to pick it up or the message is a dead letter.
 *
 * Kept pure and separate because the failure mode is a SILENT one — a state missing
 * from this list doesn't throw, it just drops the human's message on the floor. That
 * is exactly how `designing` / `design_review` went unanswered until 2026-07-28: the
 * design gate shipped after this policy was written and nobody extended it, so
 * "can you make the eyes warmer?" in a design thread woke nobody at all.
 */
export type WakeTarget = 'orchestrator' | 'assignee' | null;

export function unaddressedWake(state: string, kind?: string | null, button = false): WakeTarget {
  // a setup task's thread OWNS its room's first-run (marketing-os round 3): the bootstrap's
  // docs, its close and every follow-up playbook ask live there — long after the checklist
  // itself finished (marketing.setup lands it `done` in the same command). The coordinator
  // answers in ANY state; without this, the marketing home session went silent the moment
  // the wizard completed.
  if (kind === 'setup' && state !== 'closed') return 'orchestrator';
  // intake and plan approval are the channel coordinator's
  if (state === 'todo' || state === 'plan_review') return 'orchestrator';
  // live work: the agent holding it answers
  if (state === 'in_progress' || state === 'blocked') return 'assignee';
  // a design round IS its conversation — the studio's composer posts plain thread
  // messages so a question or a note reaches Iris without moving the FSM
  if (state === 'designing' || state === 'design_review') return 'assignee';
  // a done unit waits for the person's word ("merge it", "accept"), and the verdict card, the done
  // line and the reviewer's approval ask for it in this thread (2026-10-05). the coordinator takes
  // every reply there, a content unit's too: only it holds accept_task (a marketer's turn cannot
  // accept), and it holds revise_posts and request_changes for a note on the drafts. the orchestrator
  // decides what the reply asks for: accept_task refuses unless the person's newest typed message says
  // merge or accept (host/acceptgate.ts), and the server refuses an agent accept when no typed human
  // message is newer than the verdict
  if (state === 'done') return 'orchestrator';
  // a content task is its conversation too, even in_review where build tasks are
  // mention-only: a reply on a draft addresses the marketer (docs/16 §4.5)
  if (kind === 'content' && !['accepted', 'closed'].includes(state)) return 'assignee';
  // a draw or a film (the ‹gen-image:› / ‹gen-video:› button) is not a reply: it runs no model and
  // needs a hand in ANY state, or a tab's picture ask on a finished unit's draft wakes nobody
  // (2026-09-27). the coordinator takes it, and host/wake.ts draws for whichever agent wakes.
  return button ? 'orchestrator' : null;
}
