import { flattenRunTree, reviewFiles, isEngineeringPlanProgress, type ReviewLine, type EngineeringChange, type EngineeringSession } from '@neuramesh/shared';
import type { RunTree } from '../runs/runs';

/** A clipped hunk still has a header; only complete hunks have trustworthy totals. */
function completeHunks(lines: ReviewLine[]): boolean {
  let expected: [number, number] | null = null;
  let old = 0, next = 0, hunks = 0;
  const complete = () => expected !== null && old === expected[0] && next === expected[1];
  for (const line of lines) {
    if (line.kind === 'hunk') {
      if (expected && !complete()) return false;
      const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line.text);
      if (!header) return false;
      expected = [Number(header[1] ?? 1), Number(header[2] ?? 1)];
      old = 0; next = 0; hunks++;
    } else if (line.kind !== 'note') {
      if (line.kind !== 'added') old++;
      if (line.kind !== 'removed') next++;
    }
  }
  return hunks > 0 && complete();
}
/** Recorded session changes, never a claim about a live working-tree diff. */
export function overviewChanges(changes: EngineeringChange[]) {
  const files = reviewFiles(changes);
  const complete = files.every((file) => !file.binary && !file.change.previewError && completeHunks(file.lines) && !/^\[(?:file too large|preview omitted)/.test(file.change.before + file.change.after));
  return { files: files.length, additions: complete ? files.reduce((n, f) => n + f.additions, 0) : null, deletions: complete ? files.reduce((n, f) => n + f.deletions, 0) : null };
}
export function overviewPlan(session: Pick<EngineeringSession, 'planProgress'>) {
  const p = session.planProgress;
  if (!isEngineeringPlanProgress(p) || !p.started) return null;
  return { done: p.statuses.filter((status) => status === 'completed').length, total: p.plan.steps.length, current: p.plan.steps[p.statuses.indexOf('in_progress')]?.description };
}
export function overviewRuns(trees: RunTree[]) {
  const roots = new Set(trees.map((tree) => tree.run.id));
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  for (const tree of trees) for (const node of flattenRunTree(tree)) {
    const run = node.run;
    if (roots.has(run.id) || seen.has(run.id)) continue;
    seen.add(run.id);
    counts[run.state] = (counts[run.state] ?? 0) + 1;
  }
  const label = ['running', 'done', 'failed', 'parked', 'stopped'].filter((key) => counts[key]).map((key) => `${counts[key]} ${key === 'running' ? 'active' : key}`).join(' · ');
  return { total: seen.size, label: label || `${seen.size} ${seen.size === 1 ? 'run' : 'runs'}`, failed: !!counts.failed };
}

/** Attachments and outputs share one table. Only explicit human authorship makes an input. */
export function overviewSourceFiles<T extends { message_id?: string | null }>(files: T[], messages: { id: string; author_kind: string }[]): T[] {
  const supplied = new Set(messages.filter((m) => m.author_kind === 'human').map((m) => m.id));
  return files.filter((file) => !!file.message_id && supplied.has(file.message_id));
}
export function overviewOutputFiles<T extends { message_id?: string | null }>(files: T[], messages: { id: string; author_kind: string }[]): T[] {
  const supplied = new Set(messages.filter((m) => m.author_kind === 'human').map((m) => m.id));
  return files.filter((file) => !file.message_id || !supplied.has(file.message_id));
}
