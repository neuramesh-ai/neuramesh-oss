// node --test scripts/commit-name.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX, TYPES, check, nameOf } from './commit-name.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'commit-name.mjs');
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('a conventional name passes', () => {
  for (const name of [
    'feat: add the board search',
    'fix(boards): open the hq sign-in from the door',
    'ci: release main to Cloud Run when its checks pass',
    'feat(api)!: remove the v0 replica route',
    'chore!: drop Node 20',
    'docs(infra/cloudrun): name the release rule',
    'refactor(control-api): split handler.ts by command family',
    'fix(api): NM_BOARDS_URL is empty in a preview build',
    'docs: CLAUDE.md names the release rule',
    'build(deps): move vite to 7.1.2',
    'revert: feat(boards): add the board search',
    'test: 3 cases for the plan rule',
  ]) assert.deepEqual(check(name), { ok: true }, name);
  for (const type of TYPES) assert.equal(check(`${type}: do one thing`).ok, true, type);
});

test('the pull request number of a squash commit is not part of the name', () => {
  assert.equal(nameOf('fix(boards): open the hq sign-in from the door (#830)\n\nbody'), 'fix(boards): open the hq sign-in from the door');
  assert.equal(check(`fix: ${'a'.repeat(MAX - 5)} (#12345)`).ok, true);
  assert.equal(check(`fix: ${'a'.repeat(MAX - 4)} (#12345)`).ok, false);
});

test('a name that is not conventional fails, with the reason', () => {
  const cases = {
    'Pin the boards image with the sign-in correction': /type\(scope\): subject/,
    'Finance: chat and canvas split': /"Finance" is not a type/,
    'feature: add the board search': /"feature" is not a type/,
    'Fix: a typo': /"Fix" is not a type/,
    'fix(Boards): open the sign-in': /scope/,
    'fix(): open the sign-in': /scope/,
    'fix(boards) : open the sign-in': /type\(scope\): subject/,
    'fix(boards):open the sign-in': /type\(scope\): subject/,
    'fix(boards):  open the sign-in': /one space/,
    'fix(boards): Open the sign-in': /lowercase/,
    'fix(boards): open the sign-in.': /period/,
    'fix: ': /type\(scope\): subject/,
    '': /empty/,
    '   ': /empty/,
    'docs: record the release of the sign-in correction for Message boards, the preview, the apply and the host checks': /limit is 100/,
  };
  for (const [name, reason] of Object.entries(cases)) {
    const result = check(name);
    assert.equal(result.ok, false, name);
    assert.match(result.reason, reason, name);
  }
});

test('git writes some names itself, and the desktop app names a task pull request', () => {
  for (const name of [
    'Merge branch \'main\' into claude/deploy-on-merge',
    'Merge pull request #814 from alonge-dev/codex/finance-migration-disarm',
    'Revert "feat(boards): add the board search"',
    'fixup! fix(boards): open the hq sign-in from the door',
    'squash! fix(boards): open the hq sign-in from the door',
    'amend! fix(boards): open the hq sign-in from the door',
    '#412 Add the brief card',
  ]) assert.deepEqual(check(name), { ok: true }, name);
  for (const name of ['#412', '# a heading', 'merge the two lists', 'Reverts the board search']) assert.equal(check(name).ok, false, name);
});

test('the command exits 0 for a good name and 1 for a different name', () => {
  assert.equal(run('ci: name the workflows').status, 0);
  const bad = run('Name the workflows');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /is not a conventional name/);
  assert.match(bad.stderr, /Example: fix\(boards\)/);
});

test('the hook reads the first line of the message file and skips the comment lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-commit-name-'));
  try {
    const file = join(dir, 'COMMIT_EDITMSG');
    writeFileSync(file, '# Please enter the commit message\n\nfix(boards): open the hq sign-in from the door\n\nThe body can be a Sentence.\n# On branch main\n');
    assert.equal(run('--file', file).status, 0);
    writeFileSync(file, 'Open the hq sign-in from the door\n\nfix(boards): this line is the body\n');
    assert.equal(run('--file', file).status, 1);
    writeFileSync(file, '# only comments\n');
    assert.equal(run('--file', file).status, 1);
    assert.equal(run('--file', join(dir, 'absent')).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the hook passes a branch that has no checker, and runs the checker of a branch that has one', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const hook = join(root, '.husky', 'commit-msg');
  const dir = mkdtempSync(join(tmpdir(), 'nm-commit-name-'));
  try {
    const file = join(dir, 'COMMIT_EDITMSG');
    writeFileSync(file, 'Not a conventional name\n');
    // a worktree of a branch from before the checker: husky still reads the hook of the primary clone
    assert.equal(spawnSync('sh', ['-e', hook, file], { cwd: dir, encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('sh', ['-e', hook, file], { cwd: root, encoding: 'utf8' }).status, 1);
    writeFileSync(file, 'ci: name the workflows\n');
    assert.equal(spawnSync('sh', ['-e', hook, file], { cwd: root, encoding: 'utf8' }).status, 0);
    execFileSync('sh', ['-n', hook]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
