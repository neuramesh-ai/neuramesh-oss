// THE SCRATCH WORKSPACE (engineering-scratch.ts, round 9): a coding thread with no repository gets a
// fresh local git repository and a worktree of it, in the shape a repository session has. With real
// git in a temp brain: the first open makes the repository (one first commit, no remote) and the
// worktree, the shell's git mount check passes, a second open reuses it, a second thread gets its own,
// and a drain then a restore (a fake snapshot store: the brain dir as a tar in memory) lands the next
// open on the same worktree with the work still in it. The thread row decides, never the client.
// Run: pnpm exec tsx --test src/main/relay/engineering-scratch.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCRATCH_REPO_ID } from '@neuramesh/shared';
import { useDepCache, type DepCache } from '../cloudrun/depcache';
import { gitChildEnv } from '../harness/workspaces';
import { CodeSessionRecord, type CodeSessionRecorder } from './engineering-record';
import { validatedEngineeringGitMounts } from './engineering-safe-executors';
import { pinRelativeGitdir, scratchCloneId, scratchThreadOf } from './engineering-scratch';
import { engineeringRepoRoot, ensureEngineeringWorkspace } from './engineering-workspace';

const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitChildEnv() }).trim();
type Db = Parameters<typeof ensureEngineeringWorkspace>[0];
type Meta = Parameters<typeof ensureEngineeringWorkspace>[2];

const T1 = '5b1d6c3e-8f2a-4c7d-9e1b-2a3c4d5e6f70';
const T2 = 'c0ffee00-1111-4222-8333-444455556666';
const session = (over: Partial<Meta> = {}): Meta => ({
  threadId: T1, actorId: 'actor-1', projectId: undefined, repoId: SCRATCH_REPO_ID, repoName: 'Scratch workspace', branch: 'main', mode: 'act',
  permissions: { read: true, edit: true, command: false, web: false, mcp: false },
  policy: { read: true, edit: true, command: true, web: true, mcp: true }, ...over,
});
const intake = (name: string) => JSON.stringify({ v: 1, kind: 'coding', confidence: 0.9, title: 'Palindrome checker', name, plan: ['Create index.html', 'Add the check'], subtasks: [], workspace: 'scratch', source: 'starter' });

/** a replica whose threads rows the test names. Any other read answers null, as a missing row does */
function threadsDb(rows: Record<string, { workspace_mode: string | null; intake?: string | null; title?: string | null } | undefined>): Db & { reads: number } {
  const db = {
    reads: 0,
    get: async (sql: string, params: unknown[] = []) => {
      if (!/from threads where id = \? and workspace_id = \?/.test(sql)) return null;
      db.reads += 1;
      const row = rows[String(params[0])];
      return row ? { intake: null, title: null, ...row } : null;
    },
  };
  return db as unknown as Db & { reads: number };
}

function fakeDepCache() {
  const hydrated: string[] = [];
  const dc: DepCache = { hydrate: async (dir) => { hydrated.push(dir); return { action: 'skipped', reason: 'no-lockfile' }; }, remember: async () => ({ action: 'skipped', reason: 'no-lockfile' }) };
  useDepCache(dc);
  return hydrated;
}

async function inBrain(fn: (root: string) => Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync('/tmp/nm-engineering-scratch-'));
  const previous = process.env['NM_BRAIN'];
  process.env['NM_BRAIN'] = join(root, 'brain');
  try { await fn(root); } finally {
    useDepCache(null);
    if (previous === undefined) delete process.env['NM_BRAIN']; else process.env['NM_BRAIN'] = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

test('scratchThreadOf: the thread row decides, the name comes from the intake, then the title', async () => {
  const db = threadsDb({
    [T1]: { workspace_mode: 'scratch', intake: intake('palindrome-app') },
    [T2]: { workspace_mode: 'scratch', intake: null, title: 'Build a Palindrome HTML app!' },
  });
  assert.deepEqual(await scratchThreadOf(db, 'ws', session()), { name: 'palindrome-app', title: 'Palindrome checker' });
  assert.equal((await scratchThreadOf(db, 'ws', session({ threadId: T2 })))?.name, 'build-a-palindrome-html-app');
  // a repository session with no scratch row: nothing to do here
  assert.equal(await scratchThreadOf(threadsDb({}), 'ws', session({ repoId: 'repo-1' })), null);
  assert.equal(await scratchThreadOf(threadsDb({ [T1]: { workspace_mode: 'repo' } }), 'ws', session({ repoId: 'repo-1' })), null);
});

test('scratchThreadOf: a client that names no repository waits for the row, and is refused when the row says another thing', async () => {
  // the row arrives on the third read (a replica that is behind)
  let reads = 0;
  const late = { get: async () => (++reads >= 3 ? { workspace_mode: 'scratch', intake: intake('late-app'), title: null } : null) } as unknown as Db;
  assert.equal((await scratchThreadOf(late, 'ws', session(), { waitMs: 1_000, pollMs: 5 }))?.name, 'late-app');
  await assert.rejects(scratchThreadOf(threadsDb({}), 'ws', session(), { waitMs: 30, pollMs: 5 }), /not in this project on this machine yet/);
  await assert.rejects(scratchThreadOf(threadsDb({ [T1]: { workspace_mode: 'repo' } }), 'ws', session(), { waitMs: 30, pollMs: 5 }), /works on a repository/);
  await assert.rejects(scratchThreadOf(threadsDb({ [T1]: { workspace_mode: null } }), 'ws', session(), { waitMs: 30, pollMs: 5 }), /has no scratch workspace/);
});

test('the first open makes a fresh repository with one commit and no remote, and a worktree a repository session would have', () => inBrain(async (root) => {
  const hydrated = fakeDepCache();
  const db = threadsDb({ [T1]: { workspace_mode: 'scratch', intake: intake('palindrome-app'), title: 'Palindrome checker' } });
  const ws = await ensureEngineeringWorkspace(db, 'ws', session());
  const cloneId = scratchCloneId('palindrome-app', T1);
  assert.equal(cloneId, 'scratch-palindrome-app-5b1d6c3e');
  assert.equal(ws.repoRoot, engineeringRepoRoot(cloneId));
  assert.ok(ws.cwd.startsWith(join(root, 'brain', 'cache', 'worktrees', 'engineering-actor-1-scratch-palindrome-app-5b1d6c3e-')));
  assert.equal(git(['rev-list', '--count', 'HEAD'], ws.cwd), '1');
  assert.equal(git(['remote'], ws.repoRoot!), '');
  assert.equal(git(['config', '--get', 'nm.thread'], ws.repoRoot!), T1);
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], ws.cwd), `nm/engineering/actor-1/${T1}`);
  assert.match(readFileSync(join(ws.cwd, 'README.md'), 'utf8'), /^# Palindrome checker\n/);
  assert.equal(readFileSync(join(ws.cwd, '.gitignore'), 'utf8'), 'node_modules/\n');
  assert.equal(git(['status', '--porcelain'], ws.cwd), '');
  // the Code shell checks the worktree's git pointer against the clone, as for a repository
  assert.doesNotThrow(() => validatedEngineeringGitMounts(ws.cwd, ws.repoRoot));
  // the dependency cache path is the same one (a fresh worktree is offered to it once)
  assert.deepEqual(hydrated, [ws.cwd]);
}));

test('a second open of the thread reuses the workspace and its work, and another thread gets its own', () => inBrain(async () => {
  const hydrated = fakeDepCache();
  const db = threadsDb({
    [T1]: { workspace_mode: 'scratch', intake: intake('palindrome-app') },
    [T2]: { workspace_mode: 'scratch', intake: intake('palindrome-app') },
  });
  const first = await ensureEngineeringWorkspace(db, 'ws', session());
  writeFileSync(join(first.cwd, 'index.html'), '<!doctype html><title>Palindrome</title>\n');
  const again = await ensureEngineeringWorkspace(db, 'ws', session());
  assert.deepEqual(again, first);
  assert.equal(readFileSync(join(again.cwd, 'index.html'), 'utf8'), '<!doctype html><title>Palindrome</title>\n');
  assert.equal(git(['rev-list', '--count', 'HEAD'], again.cwd), '1', 'no second first commit');
  assert.equal(git(['status', '--porcelain'], again.cwd), '?? index.html');
  // the same intake name on another thread: another repository, another worktree
  const other = await ensureEngineeringWorkspace(db, 'ws', session({ threadId: T2 }));
  assert.notEqual(other.cwd, first.cwd);
  assert.notEqual(other.repoRoot, first.repoRoot);
  assert.equal(existsSync(join(other.cwd, 'index.html')), false);
  assert.deepEqual(hydrated, [first.cwd, other.cwd]);
}));

test('a drain and a restore (a fake snapshot store) land the next open on the same worktree, with the work', () => inBrain(async (root) => {
  const hydrated = fakeDepCache();
  const db = threadsDb({ [T1]: { workspace_mode: 'scratch', intake: intake('palindrome-app') } });
  const ws = await ensureEngineeringWorkspace(db, 'ws', session());
  writeFileSync(join(ws.cwd, 'index.html'), '<p>racecar</p>\n');
  git(['add', 'index.html'], ws.cwd);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'add index'], ws.cwd);
  // the drain: the work dir (here the brain) goes to the store as one tar, and the container is gone
  const store = new Map<string, Buffer>();
  store.set('work/epoch-1', execFileSync('tar', ['-C', root, '-cf', '-', 'brain'], { maxBuffer: 64 * 1024 * 1024 }));
  rmSync(join(root, 'brain'), { recursive: true, force: true });
  assert.equal(existsSync(ws.cwd), false);
  // the next epoch restores it at the same path
  execFileSync('tar', ['-C', root, '-xf', '-'], { input: store.get('work/epoch-1') });
  const back = await ensureEngineeringWorkspace(db, 'ws', session());
  assert.deepEqual(back, ws);
  assert.equal(readFileSync(join(back.cwd, 'index.html'), 'utf8'), '<p>racecar</p>\n');
  assert.equal(git(['log', '--format=%s'], back.cwd), 'add index\nStart palindrome-app');
  assert.doesNotThrow(() => validatedEngineeringGitMounts(back.cwd, back.repoRoot));
  assert.deepEqual(hydrated, [ws.cwd], 'a restored worktree is not offered to the dependency cache again');
}));

test('the open refuses a scratch folder another thread owns, and a repository thread is never turned into scratch', () => inBrain(async () => {
  fakeDepCache();
  const db = threadsDb({ [T1]: { workspace_mode: 'scratch', intake: intake('palindrome-app') } });
  const ws = await ensureEngineeringWorkspace(db, 'ws', session());
  git(['config', 'nm.thread', T2], ws.repoRoot!);
  rmSync(ws.cwd, { recursive: true, force: true });
  await assert.rejects(ensureEngineeringWorkspace(db, 'ws', session()), /belongs to another thread/);
  await assert.rejects(ensureEngineeringWorkspace(threadsDb({ [T1]: { workspace_mode: 'repo' } }), 'ws', session()), /works on a repository/);
}));

test('the synced session row names no repository for a scratch workspace (the repos row does not exist)', () => {
  const posts: Array<Record<string, unknown>> = [];
  const rec: CodeSessionRecorder = { workspaceId: 'ws', machineId: 'm1', post: async (cmd) => { posts.push(cmd); } };
  new CodeSessionRecord(rec, { ...session(), threadId: T1 }, 1).opened();
  assert.equal(posts[0]?.['repoId'], null);
  assert.equal(posts[0]?.['repoName'], 'Scratch workspace');
});

test('git works in the worktree from another view of the work dir (the box sees /nm/work at /work)', () => inBrain(async (root) => {
  fakeDepCache();
  const db = threadsDb({ [T1]: { workspace_mode: 'scratch', intake: intake('palindrome-app') } });
  const ws = await ensureEngineeringWorkspace(db, 'ws', session());
  // the pointer is relative to the worktree, and the back link the host's prune reads stays absolute
  const pointer = readFileSync(join(ws.cwd, '.git'), 'utf8').trim();
  assert.match(pointer, /^gitdir: \.\.\/\.\.\/repos\/scratch-palindrome-app-5b1d6c3e\/\.git\/worktrees\/[^/]+$/);
  const backLink = readFileSync(join(ws.repoRoot!, '.git', 'worktrees', pointer.split('/').pop()!, 'gitdir'), 'utf8').trim();
  assert.equal(backLink, join(ws.cwd, '.git'));
  writeFileSync(join(ws.cwd, 'index.html'), '<p>level</p>\n');
  // the box view: the same files under another root, and the host path gone (no alias)
  const boxRoot = join(root, 'box-view');
  renameSync(join(root, 'brain'), boxRoot);
  const boxCwd = ws.cwd.replace(join(root, 'brain'), boxRoot);
  assert.equal(git(['status', '--porcelain'], boxCwd), '?? index.html');
  git(['add', 'index.html'], boxCwd);
  git(['-c', 'user.name=agent', '-c', 'user.email=a@box', 'commit', '-q', '-m', 'add index in the box'], boxCwd);
  assert.equal(git(['diff', 'HEAD~1', '--stat'], boxCwd).split('\n')[0]?.trim().startsWith('index.html'), true);
  // back on the host: the commit made in the box is there, and a prune keeps the worktree
  renameSync(boxRoot, join(root, 'brain'));
  assert.equal(git(['log', '--format=%s', '-1'], ws.cwd), 'add index in the box');
  git(['worktree', 'prune'], ws.repoRoot!);
  assert.equal(git(['worktree', 'list', '--porcelain'], ws.repoRoot!).includes(ws.cwd), true);
  assert.doesNotThrow(() => validatedEngineeringGitMounts(ws.cwd, ws.repoRoot));
}));

test('a worktree an older machine cut with an absolute pointer turns relative on the next open', () => inBrain(async () => {
  fakeDepCache();
  const db = threadsDb({ [T1]: { workspace_mode: 'scratch', intake: intake('palindrome-app') } });
  const ws = await ensureEngineeringWorkspace(db, 'ws', session());
  const name = readFileSync(join(ws.cwd, '.git'), 'utf8').trim().split('/').pop()!;
  writeFileSync(join(ws.cwd, '.git'), `gitdir: ${join(ws.repoRoot!, '.git', 'worktrees', name)}\n`);
  const again = await ensureEngineeringWorkspace(db, 'ws', session());
  assert.equal(again.cwd, ws.cwd);
  assert.match(readFileSync(join(ws.cwd, '.git'), 'utf8'), /^gitdir: \.\.\//);
  assert.equal(pinRelativeGitdir(ws.cwd), false, 'relative already: nothing to write');
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], ws.cwd), `nm/engineering/actor-1/${T1}`);
}));
