import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeDesignUrlFromText } from '@neuramesh/shared';
import { brainRoot } from './harness/brain';

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

/**
 * Pick the most useful workspace Claude can inspect for this design task.
 * A user-linked checkout wins; then an already-cloned design repo; otherwise
 * use the stable task design directory that Iris will populate for this round.
 */
export function claudeDesignWorkspace(
  taskNumber: number,
  repoLocalPath: string | null | undefined,
  options: { home?: string; exists?: (path: string) => boolean } = {},
): string {
  const home = options.home ?? homedir();
  const exists = options.exists ?? existsSync;
  const local = repoLocalPath?.trim();
  if (local && exists(local)) return local;
  // cache/ (docs/harness/01 §3.2): a design scratch dir is rebuildable and must never ride an export.
  // `home` is still taken so callers/tests can redirect it; cachePath owns the layout below it.
  const root = join(brainRoot({ ...process.env, HOME: home }), 'cache', 'design', `nm-${taskNumber}`);
  const clonedRepo = join(root, 'repo');
  return exists(clonedRepo) ? clonedRepo : root;
}

/** Command written into NeuraMesh's integrated PTY after it opens at `cwd`. */
export function claudeDesignCliCommand(bin: string): string {
  return shellQuote(bin);
}

/** MCP tools whose RESULT is authoritative for "this task's project lives here". */
const PROJECT_TOOL = /claude-design__(create_project|get_project)\b/;

export type DesignLogRec = { phase?: string; summary: string; detail?: unknown; toolUseId?: string };

/**
 * Learn the task's Claude Design project URL from the tool that actually made it.
 *
 * The first version scanned every run-log line for anything shaped like a project
 * link. That is how #1034 published a dead one: the model had called `list_projects`,
 * and the harvested URL was the FIRST id in a listing of the user's unrelated
 * projects — sliced in half by the log's 160-char summary cap on the way out.
 *
 * So: correlate. Remember the tool_use_id of a create_project/get_project CALL and
 * only read the URL out of that call's own RESULT — and only out of `detail`, which
 * carries the untruncated payload. Anything else the model happens to print is data,
 * not provenance.
 */
export function claudeDesignProjectWatch() {
  const pending = new Set<string>();
  let url: string | null = null;
  return {
    /** feed every run-log record; returns the URL on the record that proves it */
    observe(rec: DesignLogRec): string | null {
      if (url) return null;
      if (rec.phase === 'call' && rec.toolUseId && PROJECT_TOOL.test(rec.summary)) {
        pending.add(rec.toolUseId);
        return null;
      }
      if (rec.phase !== 'result' || !rec.toolUseId || !pending.has(rec.toolUseId)) return null;
      pending.delete(rec.toolUseId);
      const detail = typeof rec.detail === 'string' ? rec.detail : JSON.stringify(rec.detail ?? '');
      const found = claudeDesignUrlFromText(detail);
      if (found) url = found;
      return found;
    },
    get url(): string | null { return url; },
  };
}

/**
 * Claude Design's MCP returns authorization guidance as normal model text, not
 * as a thrown transport error. Keep that recoverable state out of the generic
 * "no HTML mockups" failure path so the human can finish consent and retry.
 */
export function claudeDesignNeedsAuthorization(summary: string | null | undefined): boolean {
  const text = (summary ?? '').toLowerCase();
  return text.includes('claude design') && (
    text.includes('authorization is pending')
    || text.includes("isn't granted yet")
    || text.includes('hasn\'t granted this yet')
    || text.includes('needs access')
    || text.includes('/design consent')
  );
}
