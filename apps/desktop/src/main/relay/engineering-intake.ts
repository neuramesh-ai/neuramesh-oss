// THE INTAKE PLAN AS THE CODING AGENT'S FIRST INSTRUCTION (round 9). A coding ask that intake turned into a
// coding thread (control-api src/intake.ts) carries its decision on threads.intake: the kind, the
// workspace and the plan the person already sees in the thread. The coding runtime reads it here when a
// session opens, and adds it to the agent's instructions. engineeringCorePrompt puts provider.instructions
// into the first turn of every lane (agy and cline), so one wrap of resolveBrain covers both.
import { intakeBrief, intakeOf } from '@neuramesh/shared';
import type { EngineeringMachineOpenMeta } from '../../engineering-protocol';

interface ReplicaReader { getAll<T>(sql: string, parameters?: unknown[]): Promise<T[]> }

/** The intake brief of a coding thread, or null (no decision, a task thread, an older replica). */
export async function engineeringIntakeBrief(db: ReplicaReader, workspaceId: string, threadId: string): Promise<string | null> {
  try {
    const [t] = await db.getAll<{ intake: string | null; task_id: string | null }>(
      'select intake, task_id from threads where id = ? and workspace_id = ?', [threadId, workspaceId]);
    // a task thread follows its approved work plan, never an intake plan
    const d = t && !t.task_id ? intakeOf(t.intake) : null;
    if (!d) return null;
    const [repo] = d.workspace === 'repo' && d.repoId
      ? await db.getAll<{ org_name: string | null; name: string }>('select org_name, name from repos where id = ?', [d.repoId])
      : [];
    const label = repo ? (repo.org_name && repo.org_name !== 'local' ? `${repo.org_name}/${repo.name}` : repo.name) : null;
    return intakeBrief(d, label);
  } catch { return null; }
}

/** The brain with the intake brief added to its instructions. The seat's own instructions come first. */
export function withIntakeBrief<T extends { instructions?: string }>(brain: T, brief: string | null): T {
  if (!brief) return brain;
  return { ...brain, instructions: brain.instructions?.trim() ? `${brain.instructions.trim()}\n\n${brief}` : brief };
}

/** resolveBrain, with the thread's intake plan (machined.ts and the desktop's own code host). */
export function resolveBrainWithIntake<T extends { instructions?: string }>(
  db: ReplicaReader, workspaceId: string, resolve: (meta: EngineeringMachineOpenMeta) => Promise<T>,
): (meta: EngineeringMachineOpenMeta) => Promise<T> {
  return async (meta) => {
    const [brain, brief] = await Promise.all([resolve(meta), engineeringIntakeBrief(db, workspaceId, meta.threadId)]);
    return withIntakeBrief(brain, brief);
  };
}
