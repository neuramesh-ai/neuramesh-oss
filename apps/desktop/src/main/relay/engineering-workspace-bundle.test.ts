// A repository bundle on a cloud machine (relay/engineering-workspace.ts syncBundleClone): a row whose
// clone URL is `nm-bundle:<key>` is cloned from the bundle file the machine fetches, with real git and
// a real `git bundle` in a temp dir. It never asks for the GitHub App, its failures keep their own
// words (no GitHub card), a clone of the same key is not fetched again, and a new key is fetched into
// the same clone. The dependency cache restores into a worktree only when this open cut it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useDepCache, type DepCache } from '../cloudrun/depcache';
import { gitChildEnv } from '../harness/workspaces';
import type { RepoCredResult } from '../host/repocred';
import { EngineeringNeedsGitHub, engineeringRepoRoot, ensureEngineeringWorkspace, type FetchedBundle } from './engineering-workspace';

const git = (args: string[], cwd?: string) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitChildEnv() }).trim();

type Db = Parameters<typeof ensureEngineeringWorkspace>[0];
type Meta = Parameters<typeof ensureEngineeringWorkspace>[2];
const session = (over: Partial<Meta> = {}): Meta => ({
  threadId: 'eng-b1', actorId: 'actor-1', projectId: undefined, repoId: 'repo-bundle', repoName: 'fixture', branch: 'main', mode: 'act',
  permissions: { read: true, edit: false, command: false, web: false, mcp: false },
  policy: { read: true, edit: true, command: true, web: true, mcp: true }, ...over,
});

/** a credential lane that fails the test if it is ever asked: a bundle must never reach the App */
const credCalls: string[] = [];
const credFor = async (slug: string): Promise<RepoCredResult> => { credCalls.push(slug); return { ok: false, code: 'NOT_CONNECTED', error: 'no App' }; };

/** a source repository with one commit and a pnpm lockfile, and `git bundle create --all` of it */
function fixture(root: string): { source: string; bundle: (name: string) => string } {
  const source = join(root, 'source');
  mkdirSync(source, { recursive: true }); git(['init', '-b', 'main'], source);
  git(['config', 'user.email', 'test@neuramesh.local'], source); git(['config', 'user.name', 'NeuraMesh Test'], source);
  writeFileSync(join(source, 'README.md'), '# fixture\n');
  writeFileSync(join(source, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  writeFileSync(join(source, '.gitignore'), 'node_modules/\n');
  git(['add', '-A'], source); git(['commit', '-m', 'initial'], source);
  const bundle = (name: string): string => { const f = join(root, `${name}.bundle`); git(['bundle', 'create', f, '--all'], source); return f; };
  return { source, bundle };
}

/** the machine's fetch, as cloudrun/repo-bundle.ts gives it: a copy of the file in a temp folder */
function fetcher(root: string, files: Record<string, string>) {
  const fetched: string[] = []; const disposed: string[] = [];
  const bundle = async (key: string): Promise<FetchedBundle> => {
    fetched.push(key);
    const src = files[key]; if (!src) throw new Error(`no bundle ${key}`);
    const dir = mkdtempSync(join(root, 'fetched-')); const file = join(dir, `${key}.bundle`); copyFileSync(src, file);
    return { file, dispose: () => { disposed.push(key); rmSync(dir, { recursive: true, force: true }); } };
  };
  return { bundle, fetched, disposed };
}

const rowDb = (row: { clone_url: string }): Db => ({ get: async () => ({ name: 'fixture', default_branch: 'main', local_path: null, ...row }) }) as unknown as Db;

async function inBrain(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync('/tmp/nm-engineering-bundle-');
  const previous = process.env['NM_BRAIN'];
  process.env['NM_BRAIN'] = join(root, 'brain');
  credCalls.length = 0;
  try { await fn(root); } finally {
    useDepCache(null);
    if (previous === undefined) delete process.env['NM_BRAIN']; else process.env['NM_BRAIN'] = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

test('a bundle row clones from the fetched bundle, never asks for the App, and names its URL as origin', () => inBrain(async (root) => {
  const { bundle } = fixture(root);
  const f = fetcher(root, { 'fixture-1': bundle('one') });
  const ws = await ensureEngineeringWorkspace(rowDb({ clone_url: 'nm-bundle:fixture-1' }), 'w1', session(), { credFor, bundle: f.bundle });
  assert.equal(ws.repoRoot, engineeringRepoRoot('repo-bundle'));
  assert.equal(git(['show', 'HEAD:README.md'], ws.cwd), '# fixture');
  assert.equal(git(['branch', '--show-current'], ws.cwd), 'nm/engineering/actor-1/eng-b1');
  assert.equal(git(['remote', 'get-url', 'origin'], ws.repoRoot!), 'nm-bundle:fixture-1');
  assert.deepEqual(credCalls, [], 'a bundle never asks the token route');
  assert.deepEqual(f.fetched, ['fixture-1']);
  assert.deepEqual(f.disposed, ['fixture-1'], 'the fetched file is removed after the clone');
  // a second thread on the same key: the clone is current, so nothing is downloaded again
  const second = await ensureEngineeringWorkspace(rowDb({ clone_url: 'nm-bundle:fixture-1' }), 'w1', session({ threadId: 'eng-b2' }), { credFor, bundle: f.bundle });
  assert.equal(git(['show', 'HEAD:README.md'], second.cwd), '# fixture');
  assert.deepEqual(f.fetched, ['fixture-1']);
}));

test('a new upload (a new key) on the same row is fetched into the same clone', () => inBrain(async (root) => {
  const { source, bundle } = fixture(root);
  const one = bundle('one');
  writeFileSync(join(source, 'NEW.md'), 'second upload\n'); git(['add', 'NEW.md'], source); git(['commit', '-m', 'second'], source);
  const f = fetcher(root, { 'fixture-1': one, 'fixture-2': bundle('two') });
  await ensureEngineeringWorkspace(rowDb({ clone_url: 'nm-bundle:fixture-1' }), 'w1', session(), { credFor, bundle: f.bundle });
  const later = await ensureEngineeringWorkspace(rowDb({ clone_url: 'nm-bundle:fixture-2' }), 'w1', session({ threadId: 'eng-b3' }), { credFor, bundle: f.bundle });
  assert.equal(git(['show', 'HEAD:NEW.md'], later.cwd), 'second upload');
  assert.equal(git(['remote', 'get-url', 'origin'], later.repoRoot!), 'nm-bundle:fixture-2');
  assert.deepEqual(f.fetched, ['fixture-1', 'fixture-2']);
}));

test('a bundle that cannot be fetched says so, and never puts up the GitHub card', () => inBrain(async (root) => {
  const meta = session({ threadId: 'eng-b4' });
  await assert.rejects(ensureEngineeringWorkspace(rowDb({ clone_url: 'nm-bundle:gone-1' }), 'w1', meta, { credFor, bundle: fetcher(root, {}).bundle }),
    (e: unknown) => !(e instanceof EngineeringNeedsGitHub) && /cannot fetch the repository bundle of fixture: no bundle gone-1/.test((e as Error).message));
  // a machine with no bundle fetch (the desktop, GKE) names the cause too
  await assert.rejects(ensureEngineeringWorkspace(rowDb({ clone_url: 'nm-bundle:gone-1' }), 'w1', meta, { credFor }),
    (e: unknown) => !(e instanceof EngineeringNeedsGitHub) && /is an uploaded repository bundle, and this machine cannot fetch repository bundles/.test((e as Error).message));
  assert.deepEqual(credCalls, []);
  assert.equal(existsSync(engineeringRepoRoot('repo-bundle')), false);
}));

test('the dependency cache restores into a worktree this open cut, once, and never on a reopen', () => inBrain(async (root) => {
  const { bundle } = fixture(root);
  const f = fetcher(root, { 'fixture-1': bundle('one') });
  const hydrated: string[] = [];
  const dc: DepCache = {
    hydrate: async (dir) => { hydrated.push(dir); return { action: 'miss', key: 'k', ms: 0 }; },
    remember: async () => ({ action: 'skipped', reason: 'no-deps' }),
  };
  useDepCache(dc);
  const ws = await ensureEngineeringWorkspace(rowDb({ clone_url: 'nm-bundle:fixture-1' }), 'w1', session(), { credFor, bundle: f.bundle });
  assert.deepEqual(hydrated, [ws.cwd]);
  await ensureEngineeringWorkspace(rowDb({ clone_url: 'nm-bundle:fixture-1' }), 'w1', session(), { credFor, bundle: f.bundle });
  assert.deepEqual(hydrated, [ws.cwd], 'a reopen lands on its own files');
  // a failed restore never fails the open
  useDepCache({ ...dc, hydrate: async () => { throw new Error('GCS down'); } });
  const other = await ensureEngineeringWorkspace(rowDb({ clone_url: 'nm-bundle:fixture-1' }), 'w1', session({ threadId: 'eng-b5' }), { credFor, bundle: f.bundle });
  assert.equal(git(['show', 'HEAD:README.md'], other.cwd), '# fixture');
  // a miss that the supervisor installs (D17): the open hands the cache its phase reporter, so the tab
  // hears the install start and end
  const phases: string[] = [];
  useDepCache({ ...dc, hydrate: async (dir, phase) => { phase?.('installing_dependencies'); phase?.('dependencies_ready'); return { action: 'installed', key: 'k', ms: 1, paths: ['node_modules'], stored: 'saving' }; } });
  await ensureEngineeringWorkspace(rowDb({ clone_url: 'nm-bundle:fixture-1' }), 'w1', session({ threadId: 'eng-b6' }), { credFor, bundle: f.bundle, depPhase: (p) => phases.push(p) });
  assert.deepEqual(phases, ['installing_dependencies', 'dependencies_ready']);
}));
