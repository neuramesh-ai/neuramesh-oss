// The repository reads in the conversation (docs/design/github-connector-2026-09): a chat turn
// asked "what changed in the app this week" or "what does the pricing page say" reads the room's
// project repository through the same reader the orchestrator and the worker bus use
// (host/reporead.ts), with the same words (harness/tooldesc.ts). Split from chattools.ts at its
// size gate, like the library reads.
import { REPO_CHANGES_DESC, REPO_FILE_DESC, REPO_TREE_DESC } from '../harness/tooldesc';
import { makeRepoReader } from './reporead';
import type { ChatToolCtx } from './chattools';

export function repoChatTools(t: Pick<ChatToolCtx, 'z' | 'tool' | 'text' | 'agent' | 'ch' | 'log' | 'db' | 'apiGet'>) {
  const { z, tool, text, agent, ch, log, db, apiGet } = t;
  const reader = makeRepoReader({ apiGet, actor: { kind: 'agent', id: agent.id, ...(agent.role ? { role: agent.role } : {}) }, db, channelId: ch.id });
  return [
    tool('list_repo_changes', REPO_CHANGES_DESC,
      { since: z.string().optional().describe('an ISO date; the window starts here (default: the last 30 days)') },
      async (i) => {
        log({ kind: 'tool', phase: 'call', summary: `list_repo_changes${i.since ? ` since ${String(i.since).slice(0, 10)}` : ''}` });
        return text(await reader.changes({ ...(i.since ? { since: String(i.since) } : {}) }));
      }),
    tool('read_repo_file', REPO_FILE_DESC,
      { path: z.string().min(1).max(500).describe('the file path from the repository root, e.g. CHANGELOG.md'), ref: z.string().max(200).optional().describe('a branch, tag or commit (default: the default branch)') },
      async (i) => {
        log({ kind: 'tool', phase: 'call', summary: `read_repo_file ${String(i.path).slice(0, 80)}` });
        return text(await reader.file({ path: String(i.path), ...(i.ref ? { ref: String(i.ref) } : {}) }));
      }),
    tool('list_repo_files', REPO_TREE_DESC,
      { path: z.string().max(500).optional().describe('a directory to list (default: the whole repository, capped)'), ref: z.string().max(200).optional().describe('a branch, tag or commit (default: the default branch)') },
      async (i) => {
        log({ kind: 'tool', phase: 'call', summary: `list_repo_files ${String(i.path ?? '/').slice(0, 80)}` });
        return text(await reader.tree({ ...(i.path ? { path: String(i.path) } : {}), ...(i.ref ? { ref: String(i.ref) } : {}) }));
      }),
  ];
}
