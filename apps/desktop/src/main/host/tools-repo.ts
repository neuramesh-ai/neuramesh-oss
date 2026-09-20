// The repository reads on the orchestrator's belt (docs/design/github-connector-2026-09): rex in
// any thread, on any brain, can answer "what shipped", read the CHANGELOG, or look at a file of the
// room's project repository. The words come from harness/tooldesc.ts and the read from
// host/reporead.ts, the same two the conversation registry and the worker bus use, so no surface
// describes or answers a repository read differently. Read only: nothing here moves the board.
import { REPO_CHANGES_DESC, REPO_FILE_DESC, REPO_TREE_DESC } from '../harness/tooldesc';
import { makeRepoReader } from './reporead';
import type { OrchTool, ToolCtx } from './orchtools';

export function repoTools(tc: ToolCtx): OrchTool[] {
  const { z, db, apiGet, actor, log, here } = tc;
  // built per call: `here()` moves when a conversation is filed into another room mid-turn
  const reader = () => makeRepoReader({ apiGet, actor, db, channelId: here() });
  return [
    { name: 'list_repo_changes', description: REPO_CHANGES_DESC, schema: {
      since: z.string().optional().describe('an ISO date; the window starts here (default: the last 30 days)'),
    }, run: async (input: { since?: string }) => {
      log?.({ kind: 'tool', phase: 'call', summary: `list_repo_changes${input.since ? ` since ${input.since.slice(0, 10)}` : ''}` });
      return reader().changes({ ...(input.since ? { since: input.since } : {}) });
    } },
    { name: 'read_repo_file', description: REPO_FILE_DESC, schema: {
      path: z.string().min(1).max(500).describe('the file path from the repository root, e.g. CHANGELOG.md or src/app/page.tsx'),
      ref: z.string().max(200).optional().describe('a branch, tag or commit (default: the default branch)'),
    }, run: async (input: { path: string; ref?: string }) => {
      log?.({ kind: 'tool', phase: 'call', summary: `read_repo_file ${input.path.slice(0, 80)}` });
      return reader().file({ path: input.path, ...(input.ref ? { ref: input.ref } : {}) });
    } },
    { name: 'list_repo_files', description: REPO_TREE_DESC, schema: {
      path: z.string().max(500).optional().describe('a directory to list (default: the whole repository, capped)'),
      ref: z.string().max(200).optional().describe('a branch, tag or commit (default: the default branch)'),
    }, run: async (input: { path?: string; ref?: string }) => {
      log?.({ kind: 'tool', phase: 'call', summary: `list_repo_files ${(input.path ?? '/').slice(0, 80)}` });
      return reader().tree({ ...(input.path ? { path: input.path } : {}), ...(input.ref ? { ref: input.ref } : {}) });
    } },
  ];
}
