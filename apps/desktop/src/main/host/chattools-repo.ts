// The repository reads in the conversation (docs/design/github-connector-2026-09): a chat turn
// asked "what changed in the app this week" or "what does the pricing page say" reads the room's
// project repository through the same reader the orchestrator and the worker bus use
// (host/reporead.ts), with the same words (harness/tooldesc.ts). Split from chattools.ts at its
// size gate, like the library reads.
import { isChatThread } from '@neuramesh/shared';
import { REPO_CHANGES_DESC, REPO_FILE_DESC, REPO_TREE_DESC } from '../harness/tooldesc';
import { makeRepoReader } from './reporead';
import { conversationNeedWords, postRepoNeed } from './reponeed';
import type { ChatToolCtx } from './chattools';

export function repoChatTools(t: Pick<ChatToolCtx, 'z' | 'tool' | 'text' | 'agent' | 'ch' | 'log' | 'db' | 'apiGet' | 'post' | 'threadId'>) {
  const { z, tool, text, agent, ch, log, db, apiGet, post, threadId } = t;
  const actor = { kind: 'agent', id: agent.id, ...(agent.role ? { role: agent.role } : {}) };
  // a refusal a grant fixes puts the GitHub card up in this conversation, once (host/reponeed.ts). this
  // turn also runs in chat-mode threads, where the server mints no Needs-you row (control-api app.ts), so
  // no grant could resume the work there: a chat thread keeps the prose refusal
  const place = { workspace: ch.workspace_id, channel: ch.id, threadId };
  const onNeed = async (): Promise<boolean> => {
    const [row] = await db.getAll<{ mode: string | null }>('select mode from threads where id = ? limit 1', [threadId]).catch(() => []);
    return !isChatThread(row?.mode) && postRepoNeed({ db, post, actor, get: apiGet }, place, await conversationNeedWords(db, place, agent.name));
  };
  const reader = makeRepoReader({ apiGet, actor, db, channelId: ch.id, onNeed });
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
