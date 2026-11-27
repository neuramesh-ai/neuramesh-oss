// A VERDICT CLOSES THE TASK'S OLDER QUESTION CARDS (the needs-you round, George 2026-11-23). A card that
// asked about a gate ("what verdict should I apply to the plan?") outlived the verdict, so Needs you kept
// asking after the person had answered on the gate. Every open card is older than the verdict that is
// landing now. A person's verdict, or rex's applied on the person's word, counts. A reviewer agent's
// request for changes does not. The store keeps permission cards (requires_exact_answer). A leaf of
// fsm.ts, kept out of it on its ratchet's terms.
import type { Actor } from '@neuramesh/shared';
import type { Command } from '../commands';
import type { MutationResult } from '../store';

const VERDICTS = new Set<Command['type']>(['task.approve_plan', 'task.approve_design', 'task.revise_plan', 'task.revise_design', 'task.request_changes', 'task.approve_ship_plan', 'task.revise_ship_plan']);

export function withVerdictCards(out: MutationResult, cmd: Pick<Command, 'type'>, actor: Actor): MutationResult {
  return VERDICTS.has(cmd.type) && (actor.kind === 'human' || actor.role === 'orchestrator') ? { ...out, dismissQuestionCards: true } : out;
}
