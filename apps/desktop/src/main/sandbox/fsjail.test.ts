// Containment L1b: the shared FS-jail path set. Run: pnpm exec tsx --test src/main/sandbox/fsjail.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { claudeSandboxOptions, computeFsJail } from './fsjail';

const HOME = '/home/dev';
const USERDATA = '/home/dev/Library/Application Support/NeuraMesh';
const WORKTREE = '/home/dev/.neuramesh/worktrees/nm-42';
const jail = () => computeFsJail({ worktree: WORKTREE, userDataDir: USERDATA, home: HOME, temp: '/tmp' });

test('denies every credential store, as both subpaths and globs', () => {
  const j = jail();
  for (const rel of ['.ssh', '.aws', '.gnupg', '.kube', '.config/gcloud']) {
    assert.ok(j.denySubpaths.includes(join(HOME, rel)), `subpath missing ${rel}`);
    assert.ok(j.denyReadGlobs.includes(`${join(HOME, rel)}/**`), `abs glob missing ${rel}`);
    assert.ok(j.denyReadGlobs.includes(`**/${rel}/**`), `portable glob missing ${rel}`);
  }
  // single-file credential targets
  assert.ok(j.denySubpaths.includes(join(HOME, '.docker/config.json')));
  assert.ok(j.denyReadGlobs.includes('**/.netrc'));
});

test("denies NeuraMesh's own userData store (auth token + replica + attachments)", () => {
  const j = jail();
  assert.ok(j.denySubpaths.includes(USERDATA));
  assert.ok(j.denyReadGlobs.includes(`${USERDATA}/**`));
});

test('does NOT deny the runtime login dirs — a subscription CLI must read its own login', () => {
  const j = jail();
  for (const login of ['.claude', '.codex', '.gemini']) {
    assert.ok(!j.denySubpaths.includes(join(HOME, login)), `must not deny ~/${login}`);
    assert.ok(!j.denySubpaths.some((p) => join(HOME, login).startsWith(p + '/')), `~/${login} caught by a broader deny`);
  }
});

test('allows the agent its own worktree (read-back + write) and the temp dir', () => {
  const j = jail();
  assert.deepEqual(j.allowSubpaths, [WORKTREE]);
  assert.ok(j.allowWrite.includes(WORKTREE));
  assert.ok(j.allowWrite.includes('/tmp'));
  // the worktree is never itself a denied subpath (would jail the agent out of its own work)
  assert.ok(!j.denySubpaths.some((p) => WORKTREE === p || WORKTREE.startsWith(p + '/')));
});

test('emits both enforcement shapes non-empty', () => {
  const j = jail();
  assert.ok(j.denyReadGlobs.length > 0 && j.denySubpaths.length > 0);
});

test('human-added protected paths (extraPaths) are jailed on top of the structural floor, deduped', () => {
  const j = computeFsJail({ worktree: WORKTREE, userDataDir: USERDATA, home: HOME, temp: '/tmp', extraPaths: ['.config/gcloud', '.ssh', '/opt/secrets'] });
  // a custom HOME-relative path → subpath + both glob shapes
  assert.ok(j.denySubpaths.includes(join(HOME, '.config/gcloud')));
  assert.ok(j.denyReadGlobs.includes('**/.config/gcloud/**'));
  // a custom absolute path → subpath + absolute glob
  assert.ok(j.denySubpaths.includes('/opt/secrets'));
  assert.ok(j.denyReadGlobs.includes('/opt/secrets/**'));
  // .ssh handed in via extraPaths is deduped against the structural floor (appears once)
  assert.equal(j.denySubpaths.filter((p) => p === join(HOME, '.ssh')).length, 1);
});

test('claudeSandboxOptions enables the SDK sandbox fail-open with the FS lockdown in managedSettings', () => {
  const opts = claudeSandboxOptions(jail());
  // enable + fail-open + keep our PreToolUse hook authoritative
  assert.deepEqual(opts.sandbox, { enabled: true, failIfUnavailable: false, autoAllowBashIfSandboxed: false });
  // FS restrictions ride managedSettings (the restrictive-only lockdown tier)
  const fs = opts.managedSettings.sandbox.filesystem;
  assert.ok(fs.denyRead.includes('**/.ssh/**') && fs.denyWrite.includes('**/.ssh/**'));
  assert.deepEqual(fs.allowRead, [WORKTREE]);
  assert.ok(fs.allowWrite.includes(WORKTREE));
  // loopback binding stays open so the L1a egress proxy connection isn't strangled
  assert.equal(opts.managedSettings.sandbox.network.allowLocalBinding, true);
});
