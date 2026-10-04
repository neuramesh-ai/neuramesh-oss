// A cloud session on a desktop folder works in a worktree of the folder's GitHub twin. The shell checks
// the worktree's git pointer against the clone the host names, so the host must name the twin's clone:
// the folder's own cache path holds nothing on a cloud machine (PR #694 review, finding 8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClineCore, ToolExecutors } from '@cline/sdk';
import { createClineEngineeringHost } from './engineering-host';
import { ensureEngineeringWorkspace } from './engineering-workspace';
import { gitChildEnv } from '../harness/workspaces';

const git = (args: string[], cwd?: string) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitChildEnv() }).trim();
// the mount check runs inside each OS sandbox's own setup, so a machine with neither never reaches it
const sandboxed = (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) || (process.platform === 'linux' && existsSync('/usr/bin/bwrap'));

test('Engineering host checks a twin worktree against the twin\'s clone', { skip: !sandboxed && 'no OS command sandbox here' }, async () => {
  const root = mkdtempSync('/tmp/nm-engineering-host-twin-');
  const previous = process.env['NM_BRAIN'];
  process.env['NM_BRAIN'] = join(root, 'brain');
  try {
    const source = join(root, 'source'); const remote = join(root, 'remote.git');
    mkdirSync(source); git(['init', '-b', 'main'], source);
    git(['config', 'user.email', 'test@neuramesh.local'], source); git(['config', 'user.name', 'NeuraMesh Test'], source);
    writeFileSync(join(source, 'README.md'), '# Twin\n'); git(['add', 'README.md'], source); git(['commit', '-m', 'initial'], source);
    git(['init', '--bare', '-b', 'main', remote]); git(['remote', 'add', 'origin', remote], source); git(['push', '-u', 'origin', 'main'], source);
    const db = { get: async (sql: string) => {
      if (/from repos r\s+where r\.id = \?/.test(sql)) return { name: 'neuramesh', clone_url: null, default_branch: 'main', local_path: null };
      if (/join project_repos pr/.test(sql)) return { id: 'repo-twin', clone_url: remote, default_branch: 'main' };
      throw new Error('Result set is empty');
    } } as Parameters<typeof ensureEngineeringWorkspace>[0];
    let tools: ToolExecutors | undefined;
    const fake = {
      subscribe: () => () => {}, listHistory: async () => [], readMessages: async () => [],
      start: async () => ({ sessionId: 'runtime-1' }), send: async () => undefined, abort: async () => {},
      stop: async () => {}, dispose: async () => {}, restore: async () => ({ messages: [], checkpoint: { ref: 'x', createdAt: Date.now(), runCount: 1 } }),
    } as unknown as ClineCore;
    const host = createClineEngineeringHost({
      apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1',
      fetchImpl: async () => new Response(JSON.stringify({ token: 'sk-test', authMode: 'apikey' })),
      resolveCwd: (meta) => ensureEngineeringWorkspace(db, 'w1', meta),
      resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }),
      createDefaultExecutors: (() => ({ bash: async () => '' })) as unknown as typeof import('@cline/sdk').createDefaultExecutors,
      createCore: (async (options) => { tools = options?.capabilities?.toolExecutors; return fake; }) as typeof import('@cline/sdk').ClineCore.create,
      log: () => {},
    });
    const session = await host.open({
      threadId: 'eng-twin', actorId: 'u1', projectId: 'p1', repoId: 'repo-folder', repoName: 'neuramesh', branch: 'main', mode: 'act',
      permissions: { read: true, edit: true, command: true, web: false, mcp: false },
      policy: { read: true, edit: true, command: true, web: true, mcp: true },
    }, () => {});
    try {
      const context = {} as Parameters<NonNullable<ToolExecutors['bash']>>[2];
      const ran = await tools!.bash!('pwd', '', context).then((out) => ({ out: String(out) }), (e: unknown) => ({ refusal: e instanceof Error ? e.message : String(e) }));
      // the worktree is keyed by the twin it comes from (engineering-workspace.ts)
      if ('out' in ran) assert.match(ran.out.trim(), /\/engineering-u1-repo-twin-eng-twin$/);
      // the OS sandbox can refuse to nest inside a test runner's own sandbox. The git mounts must not be the cause.
      else assert.doesNotMatch(ran.refusal, /ENOENT|outside the selected repository|cannot validate/);
    } finally { session.close(); }
  } finally {
    if (previous === undefined) delete process.env['NM_BRAIN']; else process.env['NM_BRAIN'] = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
