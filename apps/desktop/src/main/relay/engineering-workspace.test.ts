import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EngineeringNeedsGitHub, engineeringRepoRoot, ensureEngineeringWorkspace } from './engineering-workspace';
import { validatedEngineeringGitMounts } from './engineering-safe-executors';
import { gitChildEnv } from '../harness/workspaces';
import type { RepoCredResult } from '../host/repocred';

// Pre-commit hooks export GIT_DIR/GIT_INDEX_FILE. Strip them so fixture setup cannot target the
// developer's outer repository instead of the temporary cwd (see harness/workspaces.test.ts).
const git = (args: string[], cwd?: string) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitChildEnv() }).trim();

type Db = Parameters<typeof ensureEngineeringWorkspace>[0];
type Meta = Parameters<typeof ensureEngineeringWorkspace>[2];
const session = (over: Partial<Meta> = {}): Meta => ({
  threadId: 'eng-1', actorId: 'actor-1', projectId: 'p1', repoId: 'repo-folder', repoName: 'neuramesh', branch: 'main', mode: 'plan',
  permissions: { read: true, edit: false, command: false, web: false, mcp: false },
  policy: { read: true, edit: true, command: true, web: true, mcp: true }, ...over,
});

/** the machine's replica as SQLite, read the way PowerSync's `get` reads: the first row, or a throw.
 *  `exec` changes it between two opens, the way a later sync does. */
function replica(rows: string): Db & { exec(sql: string): void } {
  const db = new DatabaseSync(':memory:');
  db.exec(`create table repos (id text, workspace_id text, provider text, org_name text, name text, default_branch text, clone_url text, local_path text);
    create table project_repos (project_id text, repo_id text, is_primary integer);
    create table channels (id text, workspace_id text, project_id text);
    create table threads (id text, workspace_id text, channel_id text);
    create table connectors (workspace_id text, project_id text, provider text, handle text, status text);
    insert into channels values ('c1', 'w1', 'p1');
    insert into threads values ('eng-1', 'w1', 'c1'), ('eng-a', 'w1', 'c1'), ('eng-b', 'w1', 'c1'), ('eng-c', 'w1', 'c1'), ('eng-d', 'w1', 'c1'), ('eng-api', 'w1', 'c1'), ('eng-web', 'w1', 'c1'), ('eng-app', 'w1', 'c1');
    ${rows}`);
  return { get: async (sql: string, params: Array<string | null> = []) => {
    const row = db.prepare(sql).get(...params);
    if (!row) throw new Error('Result set is empty');
    return row;
  }, exec: (sql: string) => db.exec(sql) } as unknown as Db & { exec(sql: string): void };
}
const cloud = { credFor: async (): Promise<RepoCredResult> => ({ ok: true, env: {}, lane: 'app' }) };

/** a remote on disk at a GitHub-shaped path: repoSlug reads `owner/name` from it, and nothing dials out */
function remote(root: string, slug: string, branch = 'main'): string {
  const source = join(root, 'src', slug); const bare = join(root, 'github.com', `${slug}.git`);
  mkdirSync(source, { recursive: true }); git(['init', '-b', branch], source);
  git(['config', 'user.email', 'test@neuramesh.local'], source); git(['config', 'user.name', 'NeuraMesh Test'], source);
  writeFileSync(join(source, 'README.md'), `# ${slug}\n`); git(['add', 'README.md'], source); git(['commit', '-m', 'initial'], source);
  git(['init', '--bare', '-b', branch, bare]); git(['remote', 'add', 'origin', bare], source); git(['push', '-u', 'origin', branch], source);
  return bare;
}

/** each test gets a brain of its own, so every clone starts cold */
async function inBrain(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync('/tmp/nm-engineering-workspace-');
  const previous = process.env['NM_BRAIN'];
  process.env['NM_BRAIN'] = join(root, 'brain');
  try { await fn(root); } finally {
    if (previous === undefined) delete process.env['NM_BRAIN']; else process.env['NM_BRAIN'] = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

test('Engineering creates and reuses a durable per-thread worktree', () => inBrain(async (root) => {
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
  } } as Db;
  const meta = session({ threadId: 'eng-123', projectId: undefined, repoId: 'repo-1', repoName: 'app', mode: 'act' });
  const first = await ensureEngineeringWorkspace(db, 'workspace-1', meta);
  assert.match(queries[0]!.sql, /workspace_id = \?/);
  assert.deepEqual(queries[0]!.params, ['repo-1', 'workspace-1', null, null]);
  assert.equal(first.repoRoot, engineeringRepoRoot('repo-1'), 'a repository with its own clone URL is its own clone');
  assert.equal(git(['branch', '--show-current'], first.cwd), 'nm/engineering/actor-1/eng-123');
  writeFileSync(join(first.cwd, 'uncommitted.txt'), 'survives relay disconnects\n');
  const reopened = await ensureEngineeringWorkspace(db, 'workspace-1', meta);
  assert.deepEqual(reopened, first);
  assert.equal(existsSync(join(reopened.cwd, 'uncommitted.txt')), true);

  git(['config', 'user.email', 'test@neuramesh.local'], first.cwd);
  git(['config', 'user.name', 'NeuraMesh Test'], first.cwd);
  git(['add', 'uncommitted.txt'], first.cwd);
  git(['commit', '-m', 'thread work'], first.cwd);
  rmSync(first.cwd, { recursive: true, force: true });
  const recovered = await ensureEngineeringWorkspace(db, 'workspace-1', meta);
  assert.equal(existsSync(join(recovered.cwd, 'uncommitted.txt')), true, 'recreating a missing worktree must not reset its existing branch');
}));

test('Engineering rejects a repository outside the machine workspace', async () => {
  const db = { get: async () => null } as Db;
  const meta = session({ threadId: 'eng-foreign', actorId: 'actor-a', projectId: undefined, repoId: 'repo-b', repoName: 'foreign' });
  // a late replica, or another project's repository: no grant and no pick adds the row, so no lane shows the GitHub card
  for (const opts of [cloud, { preferLocal: true }]) {
    await assert.rejects(ensureEngineeringWorkspace(db, 'workspace-a', meta, opts),
      (e: unknown) => !(e instanceof EngineeringNeedsGitHub) && (e as Error).message === 'foreign is not in this project on this machine.');
  }
});

test('Engineering preserves slash-delimited default branch names', () => inBrain(async (root) => {
  const source = join(root, 'source'); const remote = join(root, 'remote.git');
  mkdirSync(source); git(['init', '-b', 'release/2026'], source);
  git(['config', 'user.email', 'test@neuramesh.local'], source); git(['config', 'user.name', 'NeuraMesh Test'], source);
  writeFileSync(join(source, 'README.md'), '# Release\n'); git(['add', 'README.md'], source); git(['commit', '-m', 'initial'], source);
  git(['init', '--bare', remote]); git(['remote', 'add', 'origin', remote], source); git(['push', '-u', 'origin', 'release/2026'], source);
  const db = { get: async () => ({ clone_url: remote, default_branch: 'release/2026' }) } as Db;
  const workspace = await ensureEngineeringWorkspace(db, 'workspace-1', session({ threadId: 'eng-release', projectId: undefined, repoId: 'repo-release', repoName: 'app', branch: 'release/2026', mode: 'act' }));
  assert.equal(git(['show', 'HEAD:README.md'], workspace.cwd), '# Release');
}));

test('Engineering scopes a selected project to its repository on the machine', async () => {
  const calls: unknown[][] = [];
  const db = { get: async (_sql: string, params: unknown[]) => { calls.push(params); return null; } } as Db;
  await assert.rejects(ensureEngineeringWorkspace(db, 'workspace-a', session({ threadId: 'eng-project', actorId: 'actor-a', projectId: 'project-a', repoId: 'repo-b', repoName: 'foreign' })), /foreign is not in this project on this machine/);
  assert.deepEqual(calls[0], ['repo-b', 'workspace-a', 'project-a', 'project-a']);
  // a row the machine does not hold has no twin, so nothing more is asked
  assert.equal(calls.length, 1);
});

test('Engineering cuts a desktop folder\'s worktree from its own checkout, and the shell opens nothing in that checkout\'s .git', () => inBrain(async (root) => {
  const checkout = join(root, 'code', 'neuramesh');
  mkdirSync(checkout, { recursive: true }); git(['init', '-b', 'main'], checkout);
  git(['config', 'user.email', 'test@neuramesh.local'], checkout); git(['config', 'user.name', 'NeuraMesh Test'], checkout);
  writeFileSync(join(checkout, 'README.md'), '# Folder\n'); git(['add', 'README.md'], checkout); git(['commit', '-m', 'initial'], checkout);
  const db = replica(`
    insert into repos values ('repo-folder', 'w1', 'local', 'local', 'neuramesh', 'main', null, '${checkout}');
    insert into project_repos values ('p1', 'repo-folder', 1);`);
  const dir = await ensureEngineeringWorkspace(db, 'w1', session(), { preferLocal: true });
  assert.equal(git(['show', 'HEAD:README.md'], dir.cwd), '# Folder');
  // the checkout's refs, objects and logs hold the person's own work, which can be unpushed. The shell
  // keeps the cache path it had before this round, so no agent command gets a writable mount of them.
  assert.equal(dir.repoRoot, engineeringRepoRoot('repo-folder'));
  assert.throws(() => validatedEngineeringGitMounts(dir.cwd, dir.repoRoot));
  // a reopen finds the worktree by its thread, and the checkout its pointer names is still never the root
  const again = await ensureEngineeringWorkspace(db, 'w1', session(), { preferLocal: true });
  assert.deepEqual(again, dir);
  assert.throws(() => validatedEngineeringGitMounts(again.cwd, again.repoRoot));
}));

// a folder attached from a desktop has no clone URL, and the GitHub pick attaches its twin beside it
// (docs/design/repo-connect-2026-10): a cloud session clones the twin instead of failing on the folder
test('Engineering takes the folder\'s namesake as its twin, and the shell checks the twin\'s clone', () => inBrain(async (root) => {
  const site = remote(root, 'acme/site'); const twin = remote(root, 'acme/neuramesh');
  const db = replica(`
    insert into repos values ('repo-site', 'w1', 'github', 'acme', 'site', 'main', '${site}', null);
    insert into repos values ('repo-folder', 'w1', 'local', 'local', 'NeuraMesh', 'main', null, '/elsewhere/neuramesh');
    insert into repos values ('repo-twin', 'w1', 'github', 'acme', 'neuramesh', 'main', '${twin}', null);
    insert into project_repos values ('p1', 'repo-site', 1), ('p1', 'repo-folder', 0), ('p1', 'repo-twin', 0);`);
  const asked: string[] = [];
  const dir = await ensureEngineeringWorkspace(db, 'w1', session(), { credFor: async (slug, channel) => { asked.push(`${slug} ${channel}`); return { ok: true, env: {}, lane: 'app' }; } });
  assert.equal(git(['show', 'HEAD:README.md'], dir.cwd), '# acme/neuramesh', 'never the project\'s other repository');
  assert.deepEqual(asked, ['acme/neuramesh c1']);
  assert.equal(dir.repoRoot, engineeringRepoRoot('repo-twin'), 'the clone is keyed by the repository it came from');
  assert.deepEqual(validatedEngineeringGitMounts(dir.cwd, dir.repoRoot).readonly, [realpathSync(join(dir.repoRoot, '.git'))]);
  // the folder's own cache path holds no clone: a shell checked against it refused every command
  assert.throws(() => validatedEngineeringGitMounts(dir.cwd, engineeringRepoRoot('repo-folder')), /ENOENT/);
}));

// the connector holds one handle per project, and each pick overwrites it, so the handle names no folder
test('Engineering takes the connected repository as a folder\'s twin only in the shape the pick makes', () => inBrain(async (root) => {
  const web = remote(root, 'acme/web'); const site = remote(root, 'acme/site');
  // the pick: the primary folder, and the one repository the pick attached beside it
  const picked = replica(`
    insert into repos values ('repo-folder', 'w1', 'local', 'local', 'checkout', 'main', null, null);
    insert into repos values ('repo-acme-web', 'w1', 'github', 'acme', 'web', 'main', '${web}', null);
    insert into project_repos values ('p1', 'repo-folder', 1), ('p1', 'repo-acme-web', 0);
    insert into connectors values ('w1', 'p1', 'github', 'Acme/Web', 'connected');`);
  assert.equal(git(['show', 'HEAD:README.md'], (await ensureEngineeringWorkspace(picked, 'w1', session(), cloud)).cwd), '# acme/web');
  // the gate's resolve answers connected here, so a GitHub card could only open the session into the same refusal
  const noCopy = (name: string) => (e: unknown) => !(e instanceof EngineeringNeedsGitHub)
    && (e as Error).message === `${name} is a folder on a Mac. This cloud machine finds no GitHub copy of it. Start a new session on a GitHub repository of this project.`;
  // two folders, and the pick attached acme/web for web: api is not web
  const folders = replica(`
    insert into repos values ('repo-web', 'w1', 'local', 'local', 'web', 'main', null, null);
    insert into repos values ('repo-api', 'w1', 'local', 'local', 'api', 'main', null, null);
    insert into repos values ('repo-acme-web', 'w1', 'github', 'acme', 'web', 'main', '${web}', null);
    insert into project_repos values ('p1', 'repo-web', 1), ('p1', 'repo-api', 0), ('p1', 'repo-acme-web', 0);
    insert into connectors values ('w1', 'p1', 'github', 'acme/web', 'connected');`);
  await assert.rejects(ensureEngineeringWorkspace(folders, 'w1', session({ threadId: 'eng-api', repoId: 'repo-api', repoName: 'api' }), cloud), noCopy('api'));
  assert.equal(git(['show', 'HEAD:README.md'], (await ensureEngineeringWorkspace(folders, 'w1', session({ threadId: 'eng-web', repoId: 'repo-web', repoName: 'web' }), cloud)).cwd), '# acme/web');
  // the connected repository is the project's primary, beside a folder of another codebase
  const beside = replica(`
    insert into repos values ('repo-site', 'w1', 'github', 'acme', 'site', 'main', '${site}', null);
    insert into repos values ('repo-app', 'w1', 'local', 'local', 'app', 'main', null, null);
    insert into project_repos values ('p1', 'repo-site', 1), ('p1', 'repo-app', 0);
    insert into connectors values ('w1', 'p1', 'github', 'acme/site', 'connected');`);
  await assert.rejects(ensureEngineeringWorkspace(beside, 'w1', session({ threadId: 'eng-app', repoId: 'repo-app', repoName: 'app' }), cloud), noCopy('app'));
  // the desktop clones with its own login, and names what this machine lacks
  await assert.rejects(ensureEngineeringWorkspace(beside, 'w1', session({ threadId: 'eng-app', repoId: 'repo-app', repoName: 'app' }), { preferLocal: true }), /no checkout of app/);
}));

test('Engineering breaks a namesake tie as the server does: the connected one, the primary, then the owner and the name', () => inBrain(async (root) => {
  const zeta = remote(root, 'zeta/app'); const alpha = remote(root, 'alpha/app');
  const rows = (primary: string, connected?: string) => replica(`
    insert into repos values ('repo-folder', 'w1', 'local', 'local', 'app', 'main', null, null);
    insert into repos values ('repo-zeta', 'w1', 'github', 'zeta', 'app', 'main', '${zeta}', null);
    insert into repos values ('repo-alpha', 'w1', 'github', 'alpha', 'app', 'main', '${alpha}', null);
    insert into project_repos values ('p1', 'repo-folder', ${primary === 'repo-folder' ? 1 : 0}), ('p1', 'repo-zeta', ${primary === 'repo-zeta' ? 1 : 0}), ('p1', 'repo-alpha', 0);
    ${connected ? `insert into connectors values ('w1', 'p1', 'github', '${connected}', 'connected');` : ''}`);
  const readme = async (db: Db, threadId: string) => git(['show', 'HEAD:README.md'], (await ensureEngineeringWorkspace(db, 'w1', session({ threadId, repoName: 'app' }))).cwd);
  assert.equal(await readme(rows('repo-folder'), 'eng-a'), '# alpha/app');
  assert.equal(await readme(rows('repo-zeta'), 'eng-b'), '# zeta/app');
  // a fork and its upstream share a name, and the token route mints only for the connected one
  assert.equal(await readme(rows('repo-folder', 'Zeta/App'), 'eng-c'), '# zeta/app');
  assert.equal(await readme(rows('repo-zeta', 'alpha/app'), 'eng-d'), '# alpha/app');
}));

// a reopen lands on the thread's own files (the #694 review, round 2): a later pick can change the
// twin, and a twin derived again stranded the session's worktree or refused the open
test('Engineering reopens a thread on its own worktree after a later pick changes the twin', () => inBrain(async (root) => {
  const site = remote(root, 'acme/site'); const app = remote(root, 'acme/app'); const web = remote(root, 'acme/web');
  const db = replica(`
    insert into repos values ('repo-folder', 'w1', 'local', 'local', 'app', 'main', null, null);
    insert into repos values ('repo-site', 'w1', 'github', 'acme', 'site', 'main', '${site}', null);
    insert into project_repos values ('p1', 'repo-folder', 1), ('p1', 'repo-site', 0);
    insert into connectors values ('w1', 'p1', 'github', 'acme/site', 'connected');`);
  const first = await ensureEngineeringWorkspace(db, 'w1', session({ repoName: 'app' }), cloud);
  assert.equal(git(['show', 'HEAD:README.md'], first.cwd), '# acme/site');
  writeFileSync(join(first.cwd, 'work.txt'), 'not committed\n');
  // a pick attaches a third repository: the folder has no twin now, and a first open refuses
  db.exec(`insert into repos values ('repo-web', 'w1', 'github', 'acme', 'web', 'main', '${web}', null);
    insert into project_repos values ('p1', 'repo-web', 0);
    update connectors set handle = 'acme/web';`);
  await assert.rejects(ensureEngineeringWorkspace(db, 'w1', session({ threadId: 'eng-b', repoName: 'app' }), cloud), /app is a folder on a Mac/);
  assert.deepEqual(await ensureEngineeringWorkspace(db, 'w1', session({ repoName: 'app' }), cloud), first);
  // a pick attaches the folder's namesake, which is the twin of a new thread from now on
  db.exec(`insert into repos values ('repo-app', 'w1', 'github', 'acme', 'app', 'main', '${app}', null);
    insert into project_repos values ('p1', 'repo-app', 0);
    update connectors set handle = 'acme/app';`);
  const again = await ensureEngineeringWorkspace(db, 'w1', session({ repoName: 'app' }), cloud);
  assert.deepEqual(again, first);
  assert.equal(readFileSync(join(again.cwd, 'work.txt'), 'utf8'), 'not committed\n');
  assert.deepEqual(validatedEngineeringGitMounts(again.cwd, again.repoRoot).readonly, [realpathSync(join(engineeringRepoRoot('repo-site'), '.git'))]);
  const fresh = await ensureEngineeringWorkspace(db, 'w1', session({ threadId: 'eng-a', repoName: 'app' }), cloud);
  assert.equal(git(['show', 'HEAD:README.md'], fresh.cwd), '# acme/app');
  assert.equal(fresh.repoRoot, engineeringRepoRoot('repo-app'));
}));

test('Engineering takes no twin that neither the folder\'s name nor the room\'s connector names', () => inBrain(async (root) => {
  const db = replica(`
    insert into repos values ('repo-folder', 'w1', 'local', 'local', 'app', 'main', null, null);
    insert into repos values ('repo-site', 'w1', 'github', 'acme', 'site', 'main', '${join(root, 'github.com', 'acme', 'site.git')}', null);
    insert into project_repos values ('p1', 'repo-folder', 1), ('p1', 'repo-site', 0);
    insert into connectors values ('w1', 'p1', 'github', 'acme/site', 'revoked');`);
  // the pick attaches the right one, so a cloud machine waits for GitHub
  await assert.rejects(ensureEngineeringWorkspace(db, 'w1', session({ repoName: 'app' }), { credFor: async () => ({ ok: true, env: {}, lane: 'app' }) }),
    (e: unknown) => e instanceof EngineeringNeedsGitHub && /app needs its GitHub copy/.test(e.message));
  await assert.rejects(ensureEngineeringWorkspace(db, 'w1', session({ repoName: 'app' }), { preferLocal: true }),
    (e: unknown) => !(e instanceof EngineeringNeedsGitHub) && /no checkout of app/.test((e as Error).message));
}));

test('Engineering cuts a twin\'s worktree from the twin\'s default branch, not the folder\'s', () => inBrain(async (root) => {
  const twin = remote(root, 'acme/neuramesh', 'trunk');
  const db = replica(`
    insert into repos values ('repo-folder', 'w1', 'local', 'local', 'neuramesh', 'feat/nav', null, '/elsewhere/neuramesh');
    insert into repos values ('repo-twin', 'w1', 'github', 'acme', 'neuramesh', 'trunk', '${twin}', null);
    insert into project_repos values ('p1', 'repo-folder', 1), ('p1', 'repo-twin', 0);`);
  // the client sends the branch the desktop checkout was on, which GitHub never saw
  const dir = await ensureEngineeringWorkspace(db, 'w1', session({ branch: 'feat/nav' }));
  assert.equal(git(['show', 'HEAD:README.md'], dir.cwd), '# acme/neuramesh');
}));

// a GitHub card for a refusal that no grant fixes reopens the session into the same refusal, and the
// person never reads the cause (PR #694 review: findings 9, 13 and 19)
test('Engineering waits for GitHub only on a refusal that a grant fixes', () => inBrain(async (root) => {
  const db = replica(`
    insert into repos values ('repo-private', 'w1', 'github', 'acme', 'private', 'main', '${join(root, 'github.com', 'acme', 'private.git')}', null);
    insert into project_repos values ('p1', 'repo-private', 1);`);
  const asked: string[] = [];
  const open = (answer?: () => Promise<RepoCredResult>) => ensureEngineeringWorkspace(db, 'w1', session({ repoId: 'repo-private', repoName: 'private' }),
    answer ? { credFor: (slug, channel) => { asked.push(`${slug} ${channel}`); return answer(); } } : {});
  const refused = (code: string, error: string) => async (): Promise<RepoCredResult> => ({ ok: false, code, error });
  const gitsOwn = (e: unknown) => !(e instanceof EngineeringNeedsGitHub) && /does not exist/.test((e as Error).message);
  for (const code of ['NOT_CONNECTED', 'NO_REPO', 'RECONNECT_REQUIRED']) {
    await assert.rejects(open(refused(code, 'GitHub is not connected for this room')),
      (e: unknown) => e instanceof EngineeringNeedsGitHub && /private needs the neuramesh app on GitHub/.test(e.message), code);
  }
  // no answer from the token lane at all: a grant is still the one fix a cloud machine has
  await assert.rejects(open(async () => { throw new Error('no bearer'); }), EngineeringNeedsGitHub);
  for (const [code, words] of [
    ['APP_NEEDS_WRITE', 'The neuramesh GitHub App needs these permissions for a pull request'],
    ['OTHER_REPO', 'this room\'s GitHub connection is acme/app, and the task\'s repository is acme/private'],
    ['GITHUB_ERROR', 'GitHub did not answer'],
    ['UNREACHABLE', 'the API did not answer (fetch failed)'],
  ] as const) {
    await assert.rejects(open(refused(code, words)),
      (e: unknown) => !(e instanceof EngineeringNeedsGitHub) && (e as { code?: unknown }).code === undefined && (e as Error).message.includes(words), code);
  }
  assert.equal(new Set(asked).size, 1);
  assert.equal(asked[0], 'acme/private c1');
  // a credential that works, and the desktop's own lane, keep git's own error
  await assert.rejects(open(async () => ({ ok: true, env: {}, lane: 'own' })), gitsOwn);
  await assert.rejects(open(), gitsOwn);
}));

// a later thread fetches the clone an earlier one made, and a revoked grant fails the fetch: the
// same refusal rule applies, so the thread shows the GitHub card and not git's error (the #694 review, round 2)
test('Engineering waits for GitHub on a fetch of an existing clone, as on the first clone', () => inBrain(async (root) => {
  const bare = remote(root, 'acme/private');
  const db = replica(`
    insert into repos values ('repo-private', 'w1', 'github', 'acme', 'private', 'main', '${bare}', null);
    insert into project_repos values ('p1', 'repo-private', 1);`);
  const open = (threadId: string, answer: RepoCredResult) => ensureEngineeringWorkspace(db, 'w1', session({ threadId, repoId: 'repo-private', repoName: 'private' }), { credFor: async () => answer });
  await open('eng-1', { ok: true, env: {}, lane: 'app' });
  // the remote no longer answers this machine, as a private repository does once the grant is gone
  rmSync(bare, { recursive: true, force: true });
  for (const code of ['NOT_CONNECTED', 'NO_REPO', 'RECONNECT_REQUIRED']) {
    await assert.rejects(open('eng-a', { ok: false, code, error: 'GitHub is not connected for this room' }),
      (e: unknown) => e instanceof EngineeringNeedsGitHub && /private needs the neuramesh app on GitHub before this cloud machine can reach it/.test(e.message), code);
  }
  await assert.rejects(open('eng-a', { ok: false, code: 'OTHER_REPO', error: 'this room\'s GitHub connection is acme/app' }),
    (e: unknown) => !(e instanceof EngineeringNeedsGitHub) && (e as Error).message === 'This cloud machine cannot reach private: this room\'s GitHub connection is acme/app');
  await assert.rejects(open('eng-a', { ok: true, env: {}, lane: 'app' }),
    (e: unknown) => !(e instanceof EngineeringNeedsGitHub) && /git fetch origin --prune/.test((e as Error).message));
}));
