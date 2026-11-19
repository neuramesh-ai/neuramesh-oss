// THE INTAKE DECISION IN THE AGENT'S CONTEXT (round 9). nm-api stores the decision on threads.intake
// (control-api src/intake.ts). The orchestrator's turn in that thread reads it here, as one short block:
// the kind, the workspace and the plan the person already sees in the thread. Only on the thread's
// first turn: after the agent has answered once, the conversation itself is the context.
import { intakeBrief, intakeOf, type IntakeDecision } from '@neuramesh/shared';

interface Db { getAll<T>(sql: string, params?: unknown[]): Promise<T[]> }

/** The stored decision of a conversation thread, or null (no thread, no decision, an older replica). */
export async function threadIntake(db: Db, threadId: string | null): Promise<IntakeDecision | null> {
  if (!threadId) return null;
  try {
    const [t] = await db.getAll<{ intake: string | null }>('select intake from threads where id = ?', [threadId]);
    return intakeOf(t?.intake ?? null);
  } catch { return null; }
}

/** The block the orchestrator's prompt carries, or '' when there is nothing to add. */
export async function intakeNoteFor(db: Db, threadId: string | null): Promise<{ note: string; named: boolean }> {
  const d = await threadIntake(db, threadId);
  if (!d) return { note: '', named: false };
  // the first turn only: once an agent spoke here, the plan is in the transcript
  try {
    const [n] = await db.getAll<{ n: number }>("select count(*) as n from messages where thread_id = ? and author_kind = 'agent'", [threadId]);
    if (Number(n?.n ?? 0) > 0) return { note: '', named: true };
  } catch { /* the note is context, never worth the turn */ }
  return { note: `\n\n[${intakeBrief(d)}]`, named: true };
}
