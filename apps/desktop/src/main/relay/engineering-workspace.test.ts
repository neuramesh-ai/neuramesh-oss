import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureEngineeringWorkspace } from './engineering-workspace';
import { gitChildEnv } from '../harness/workspaces';

// Pre-commit hooks export GIT_DIR/GIT_INDEX_FILE. Strip them so fixture setup cannot target the
// developer's outer repository instead of the temporary cwd (see harness/workspaces.test.ts).
const git = (args: string[], cwd?: string) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitChildEnv() }).trim();

test('Engineering creates and reuses a durable per-thread worktree', async () => {
  const root = mkdtempSync('/tmp/nm-engineering-workspace-');
  const previous = process.env['NM_BRAIN'];
  process.env['NM_BRAIN'] = join(root, 'brain');
  try {
    const source = join(root, 'source');
    const remote = join(root, 'remote.git');
    mkdirSync(source);
    git(['init', '-b', 'main'], source);
    git(['config', 'user.email', 'test@neuramesh.local'], source);
    git(['config', 'user.name', 'NeuraMesh Test'], source);
    writeFileSync(join(source, 'README.md'), '# App\n');
    git(['add', 'README.md'], source);
    git(['commit', '-m', 'initial'], source);
    git(['init', '--bare', remote]);
    git(['remote', 'add', 'origin', remote], source);
    git(['push', '-u', 'origin', 'main'], source);
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = { get: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return params[1] === 'workspace-1' ? { clone_url: remote, default_branch: 'main' } : null;
    } } as Parameters<typeof ensureEngineeringWorkspace>[0];
    const meta = {
      threadId: 'eng-123', actorId: 'actor-1', repoId: 'repo-1', repoName: 'app', branch: 'main', mode: 'act' as const,
      permissions: { read: true, edit: false, command: false, web: false, mcp: false },
      policy: { read: true, edit: true, command: true, web: true, mcp: true },
    };
    const first = await ensureEngineeringWorkspace(db, 'workspace-1', meta);
    assert.match(queries[0]!.sql, /workspace_id = \?/);
    assert.deepEqual(queries[0]!.params, ['repo-1', 'workspace-1', null, null]);
    assert.equal(git(['branch', '--show-current'], first), 'nm/engineering/actor-1/eng-123');
    writeFileSync(join(first, 'uncommitted.txt'), 'survives relay disconnects\n');
    const reopened = await ensureEngineeringWorkspace(db, 'workspace-1', meta);
    assert.equal(reopened, first);
    assert.equal(existsSync(join(reopened, 'uncommitted.txt')), true);

    git(['config', 'user.email', 'test@neuramesh.local'], first);
    git(['config', 'user.name', 'NeuraMesh Test'], first);
    git(['add', 'uncommitted.txt'], first);
    git(['commit', '-m', 'thread work'], first);
    rmSync(first, { recursive: true, force: true });
    const recovered = await ensureEngineeringWorkspace(db, 'workspace-1', meta);
    assert.equal(existsSync(join(recovered, 'uncommitted.txt')), true, 'recreating a missing worktree must not reset its existing branch');
  } finally {
    if (previous === undefined) delete process.env['NM_BRAIN']; else process.env['NM_BRAIN'] = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('Engineering rejects a repository outside the machine workspace', async () => {
  const db = { get: async () => null } as Parameters<typeof ensureEngineeringWorkspace>[0];
  await assert.rejects(ensureEngineeringWorkspace(db, 'workspace-a', {
    threadId: 'eng-foreign', actorId: 'actor-a', repoId: 'repo-b', repoName: 'foreign', branch: 'main', mode: 'plan',
    permissions: { read: true, edit: false, command: false, web: false, mcp: false },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
  }), /not available in this workspace/);
});

test('Engineering preserves slash-delimited default branch names', async () => {
  const root = mkdtempSync('/tmp/nm-engineering-slash-branch-');
  const previous = process.env['NM_BRAIN'];
  process.env['NM_BRAIN'] = join(root, 'brain');
  try {
    const source = join(root, 'source'); const remote = join(root, 'remote.git');
    mkdirSync(source); git(['init', '-b', 'release/2026'], source);
    git(['config', 'user.email', 'test@neuramesh.local'], source); git(['config', 'user.name', 'NeuraMesh Test'], source);
    writeFileSync(join(source, 'README.md'), '# Release\n'); git(['add', 'README.md'], source); git(['commit', '-m', 'initial'], source);
    git(['init', '--bare', remote]); git(['remote', 'add', 'origin', remote], source); git(['push', '-u', 'origin', 'release/2026'], source);
    const db = { get: async () => ({ clone_url: remote, default_branch: 'release/2026' }) } as Parameters<typeof ensureEngineeringWorkspace>[0];
    const workspace = await ensureEngineeringWorkspace(db, 'workspace-1', {
      threadId: 'eng-release', actorId: 'actor-1', repoId: 'repo-release', repoName: 'app', branch: 'release/2026', mode: 'act',
      permissions: { read: true, edit: false, command: false, web: false, mcp: false },
      policy: { read: true, edit: true, command: true, web: true, mcp: true },
    });
    assert.equal(git(['show', 'HEAD:README.md'], workspace), '# Release');
  } finally {
    if (previous === undefined) delete process.env['NM_BRAIN']; else process.env['NM_BRAIN'] = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('Engineering scopes a selected project to its repository on the machine', async () => {
  let parameters: unknown[] = [];
  const db = { get: async (_sql: string, params: unknown[]) => { parameters = params; return null; } } as Parameters<typeof ensureEngineeringWorkspace>[0];
  await assert.rejects(ensureEngineeringWorkspace(db, 'workspace-a', {
    threadId: 'eng-project', actorId: 'actor-a', projectId: 'project-a', repoId: 'repo-b', repoName: 'foreign', branch: 'main', mode: 'plan',
    permissions: { read: true, edit: false, command: false, web: false, mcp: false },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
  }), /not available in this workspace/);
  assert.deepEqual(parameters, ['repo-b', 'workspace-a', 'project-a', 'project-a']);
});
