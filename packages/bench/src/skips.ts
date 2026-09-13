// The run's ledger of what did NOT get measured. Separate from the role runners because it is
// state about the RUN rather than about any one role, and because every runner writes to it.
import type { RoleId } from './types';

// Models that produced NO row for a role, and why. A 400 from a rejected parameter, a dead key or
// a model the account cannot serve each used to print one grey "skipped" line among dozens and then
// vanish from the leaderboard, so a run could publish a partial board and look complete. The CLI
// reads this ledger, prints it loudly, writes it into the report, and exits non-zero.
export interface SkipRecord {
  model: string;
  role: RoleId;
  reason: string;
}
const skips: SkipRecord[] = [];

export function recordSkip(model: string, role: RoleId, e: Error): void {
  const reason = e.message.slice(0, 200);
  skips.push({ model, role, reason });
  console.warn(`  ${model.padEnd(24)} NO ROW for ${role} — ${reason}`);
}

/** every (model, role) that failed to produce a row this run */
export const skippedModels = (): SkipRecord[] => [...skips];
