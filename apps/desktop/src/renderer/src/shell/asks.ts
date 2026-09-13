// THE ASK PREDICATES — which task rows and which decision cards mean "someone is waiting on you".
//
// They lived inline in App.tsx. The connection bands (U3b) run them a second time, over the rows
// of a connection the shell does not stand in, and a predicate copied is a derivation that
// drifts — so they moved here, one door for both lanes. `agents` is the roster the task's room
// could route to (shared/staffing.ts); a todo nobody can route is the human's to answer.
import { actionableByHuman, awaitingAgent, decisionHandled, isUnroutableTodo, type StaffingAgent } from '@neuramesh/shared';
import type { DecisionAllRow, TaskAllRow } from '../bridge/rows-board';

export function isAskTask(t: TaskAllRow, agents: StaffingAgent[]): boolean {
  return actionableByHuman(t) && !awaitingAgent(t)
    && (t.kind === 'setup'
      ? (t.state === 'todo' || t.state === 'in_progress')
      : t.state === 'done' || t.state === 'ship_review' || t.state === 'design_review' || (t.state === 'plan_review' && !t.plan_approved_at) || t.state === 'blocked' || isUnroutableTodo(t, agents));
}

export function isAskDecision(d: DecisionAllRow): boolean {
  return d.status === 'open' && !decisionHandled(d);
}
