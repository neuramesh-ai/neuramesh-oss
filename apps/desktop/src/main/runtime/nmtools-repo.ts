// The repository reads on the Claude in-process server (docs/design/github-connector-2026-09):
// the three clones of the bus tools, closure-gated like search_x (the host hands `repo` to the
// turns TOOL_KINDS grants), one implementation behind them (host/reporead.ts). Split from
// nmtools.ts at its size gate; the words come from the one table (harness/toolspec.ts).
import type { RepoReader } from '../host/reporead';
import type { LogFn } from '../agentlog';
import { TOOL_SPECS } from '../harness/toolspec';

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk');
type Zod = typeof import('zod')['z'];
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

export function repoClones(repo: RepoReader, tool: Sdk['tool'], z: Zod, log?: LogFn) {
  return [
    tool('list_repo_changes', TOOL_SPECS.list_repo_changes.description, TOOL_SPECS.list_repo_changes.params(z), async (input) => {
      log?.({ kind: 'tool', phase: 'call', summary: `list_repo_changes${input.since ? ` since ${String(input.since).slice(0, 10)}` : ''}` });
      return text(await repo.changes({ ...(input.since ? { since: input.since } : {}) }));
    }),
    tool('read_repo_file', TOOL_SPECS.read_repo_file.description, TOOL_SPECS.read_repo_file.params(z), async (input) => {
      log?.({ kind: 'tool', phase: 'call', summary: `read_repo_file ${String(input.path).slice(0, 80)}` });
      return text(await repo.file({ path: input.path, ...(input.ref ? { ref: input.ref } : {}) }));
    }),
    tool('list_repo_files', TOOL_SPECS.list_repo_files.description, TOOL_SPECS.list_repo_files.params(z), async (input) => {
      log?.({ kind: 'tool', phase: 'call', summary: `list_repo_files ${String(input.path ?? '/').slice(0, 80)}` });
      return text(await repo.tree({ ...(input.path ? { path: input.path } : {}), ...(input.ref ? { ref: input.ref } : {}) }));
    }),
  ];
}
