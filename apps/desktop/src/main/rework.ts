// Rework continuity for repo-less (scratch) tasks. Electron-free (the
// execpolicy/replypolicy idiom) so the colocated test runs in plain node.
//
// The failure this fixes (#1010's PDF rework): every execution attempt used to
// `rm -rf` the scratch workspace — "fresh per attempt" — so when a review bounced
// a finished deliverable ("convert the report to PDF"), the rework session started
// with an EMPTY workspace and a fresh LLM context, and redid the entire task
// instead of converting the file it had already produced. Repo-backed tasks never
// had this hole: their work is committed and pushed, so the rework's worktree
// starts from the prior attempt's branch.
//
// prepareScratchWorkspace decides fresh-vs-retain from ENFORCED state — does the
// task have previously SUBMITTED `file` artifacts? — never from message phrasing:
//  · no prior files (first attempt, or a wall retry that never submitted) → wipe
//    fresh, today's hygiene.
//  · prior files exist (a review bounce, human or auto) → RETAIN the workspace and
//    rehydrate any missing files from the synced artifacts (newest per name), so
//    the rework starts FROM the prior deliverable on ANY machine. This also makes
//    reworkBlock's "the rest of your prior work stands" promise actually true here.
// Returns the prompt note naming the deliverables ('' on a fresh attempt).

import { mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';

export type ReworkDbLike = { getAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> };

export async function prepareScratchWorkspace(db: ReworkDbLike, taskId: string, dir: string): Promise<string> {
  const rows = await db.getAll<{ name: string; inline_content: string | null }>(
    `select name, inline_content from artifacts where task_id = ? and kind = 'file' order by created_at desc`,
    [taskId],
  ).catch(() => [] as Array<{ name: string; inline_content: string | null }>);
  // newest submission wins per name (a re-submit re-writes the same names)
  const latest = new Map<string, string>();
  for (const r of rows) if (r.inline_content != null && !latest.has(r.name)) latest.set(r.name, r.inline_content);
  if (!latest.size) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await mkdir(dir, { recursive: true });
    return '';
  }
  await mkdir(dir, { recursive: true }); // retain what's here (the last attempt's state)
  const root = resolve(dir);
  const present: string[] = [];
  for (const [name, content] of latest) {
    const dest = resolve(join(dir, name));
    if (!dest.startsWith(root + sep)) continue; // artifact names are synced data — never escape the workspace
    if (await stat(dest).then(() => true, () => false)) { present.push(name); continue; } // disk (retained) wins
    try {
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content);
      present.push(name);
    } catch { /* unwritable → the agent still has the rest */ }
  }
  if (!present.length) return '';
  return `\n\n[REWORK — your previous submission's deliverables are ALREADY in this workspace: ${present.join(', ')}. Start FROM these files — edit, convert, or extend them per the review notes. Do NOT redo the work from scratch; everything not touched by the requested changes stands as-is.]`;
}
