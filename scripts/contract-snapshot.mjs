#!/usr/bin/env node
// write the contract of a desktop to contracts/desktop/<version>.json (docs/46).
//
//   node scripts/contract-snapshot.mjs                   # this checkout, at the version in apps/desktop/package.json
//   node scripts/contract-snapshot.mjs --ref v0.150.0    # the code at a tag or a commit
//   node scripts/contract-snapshot.mjs --root ../other   # another checkout, with its own dependencies installed
//   add --force to write over a file that exists
//
// the version-bump PR runs the first form (docs/11 §2), and the compat test in the control-api
// holds every later tree to the two newest files. --ref reads a tag's own code: it extracts the
// files a snapshot reads into a temporary folder with git archive and links this checkout's
// installed dependencies in. that is right only when the resolved dependency versions are the
// same, so it refuses otherwise, and --root is the way for such a tag.
//
// the logic is TypeScript (packages/control-api/src/client-contracts). this launcher loads tsx from
// the control-api's own devDependencies so a .mjs can import it.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../packages/control-api/package.json', import.meta.url));
// both hooks: the control-api's files are ES modules, and the desktop's are CommonJS by package type
(await import(require.resolve('tsx/esm/api'))).register();
require('tsx/cjs/api').register();
const { CLIENT_SCHEMA_FILE, SYNC_RULES_FILE, snapshotTree, stringifySnapshot } = await import('../packages/control-api/src/client-contracts/snapshot.ts');

// what a snapshot reads, and the root files its imports need
const TREE = ['package.json', 'tsconfig.base.json', 'packages', 'apps/desktop/package.json', dirname(CLIENT_SCHEMA_FILE), dirname(SYNC_RULES_FILE), 'defaults/agents'];
// caches a package's node_modules may hold, never needed to import anything
const CACHE = /\/node_modules\/\.(vite|vitest|cache)(\/|$)/;

const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
// js-yaml is a devDependency of @neuramesh/shared, borrowed the way the snapshot borrows it
const yaml = createRequire(new URL('../packages/shared/package.json', import.meta.url))('js-yaml');
/** the resolved versions of a lockfile. a workspace link added since the tag changes the importers, not these. */
const resolved = (text) => { const l = yaml.load(text); return JSON.stringify({ packages: l.packages ?? {}, snapshots: l.snapshots ?? {} }); };

/** a copy of `ref`'s files with this checkout's installed dependencies linked in */
function treeAt(ref) {
  const sha = git('rev-parse', '--verify', `${ref}^{commit}`);
  if (resolved(git('show', `${sha}:pnpm-lock.yaml`)) !== resolved(readFileSync(join(repo, 'pnpm-lock.yaml'), 'utf8'))) {
    throw new Error(`the dependency versions in pnpm-lock.yaml changed since ${ref}, so the dependencies here are not that tree's. Check ${ref} out in a folder of its own, install it, and pass that folder with --root.`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'nm-contract-'));
  const paths = git('ls-tree', '--name-only', sha, '--', ...TREE).split('\n').filter(Boolean);
  const tar = execFileSync('git', ['archive', '--format=tar', sha, '--', ...paths], { cwd: repo, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
  // each package's own node_modules holds RELATIVE links: @neuramesh/* lands inside the copy, the rest in the store
  for (const group of ['apps', 'packages']) {
    for (const name of readdirSync(join(repo, group))) {
      const from = join(repo, group, name, 'node_modules');
      const to = join(dir, group, name);
      if (existsSync(from) && existsSync(to)) cpSync(from, join(to, 'node_modules'), { recursive: true, verbatimSymlinks: true, filter: (src) => !CACHE.test(src) });
    }
  }
  return { dir, sha };
}

async function main(args) {
  const at = args.indexOf('--ref');
  const ref = at >= 0 ? args[at + 1] : null;
  if (at >= 0 && !ref) throw new Error('--ref needs a tag or a commit');
  const rootAt = args.indexOf('--root');
  const other = rootAt >= 0 ? args[rootAt + 1] : null;
  if (rootAt >= 0 && !other) throw new Error('--root needs a folder');
  const tree = ref ? treeAt(ref) : { dir: other ? resolve(other) : repo, sha: null };
  try {
    // the snapshot of a version leaves out what that tree retired (docs/46, rule 3)
    const snap = await snapshotTree(tree.dir, { retired: true });
    const rel = `contracts/desktop/${snap.version}.json`;
    if (existsSync(join(repo, rel)) && !args.includes('--force')) {
      throw new Error(`${rel} exists. The contract of a published desktop does not change. Pass --force only to write it again from its own tag.`);
    }
    mkdirSync(join(repo, 'contracts/desktop'), { recursive: true });
    writeFileSync(join(repo, rel), `${stringifySnapshot(snap)}\n`);
    const n = (o) => Object.keys(o).length;
    console.log(`${rel}: ${n(snap.commands)} commands, ${snap.routes.length} routes, ${n(snap.clientSchema)} client tables, ${n(snap.syncRules)} synced tables, ${snap.relay.frames.length} relay frames, ${snap.relay.lanes.length} lanes, ${snap.agents.length} agent contracts${ref ? `, from ${ref} (${tree.sha.slice(0, 8)})` : ''}`);
  } finally {
    if (ref) rmSync(tree.dir, { recursive: true, force: true });
  }
}

try {
  await main(process.argv.slice(2));
  // the app's modules may hold a timer open: the snapshot is written, so leave now
  process.exit(0);
} catch (err) {
  console.error(`contract-snapshot: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
