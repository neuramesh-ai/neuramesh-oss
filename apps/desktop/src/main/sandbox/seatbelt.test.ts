// Containment L1b: the agy Seatbelt profile generator. Run: pnpm exec tsx --test src/main/sandbox/seatbelt.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSeatbeltProfile, canonicalPath, sandboxExecArgv, seatbeltProfile, strictCodeSeatbeltProfile } from './seatbelt';

test('profile is allow-default with a deny per sensitive subpath', () => {
  const p = seatbeltProfile(['/home/dev/.ssh', '/home/dev/.aws']);
  assert.match(p, /^\(version 1\)\n\(allow default\)/);
  assert.match(p, /\(deny file-read\* file-write\*/);
  assert.match(p, /\(subpath "\/home\/dev\/\.ssh"\)/);
  assert.match(p, /\(subpath "\/home\/dev\/\.aws"\)/);
});

test('quotes paths with spaces (macOS Application Support) and escapes quotes/backslashes', () => {
  const p = seatbeltProfile(['/home/dev/Library/Application Support/NeuraMesh', '/x/we"ird\\path']);
  assert.match(p, /\(subpath "\/home\/dev\/Library\/Application Support\/NeuraMesh"\)/);
  assert.match(p, /\(subpath "\/x\/we\\"ird\\\\path"\)/);
});

test('allow-back of the worktree is emitted AFTER the deny (Seatbelt last-match-wins)', () => {
  const p = seatbeltProfile(['/home/dev/.ssh'], ['/home/dev/.neuramesh/worktrees/nm-1']);
  const denyAt = p.indexOf('(deny');
  const allowBackAt = p.lastIndexOf('(allow file-read* file-write*');
  assert.ok(denyAt > 0 && allowBackAt > denyAt, 'allow-back must follow the deny');
  assert.match(p, /\(subpath "\/home\/dev\/\.neuramesh\/worktrees\/nm-1"\)/);
});

test('a profile with no denies is still valid (allow default only)', () => {
  assert.equal(seatbeltProfile([]), '(version 1)\n(allow default)\n');
});

test('canonicalPath resolves a symlinked ancestor while preserving a missing tail (the /var→/private bug)', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'nm-canon-')));
  mkdirSync(join(base, 'real'));
  symlinkSync(join(base, 'real'), join(base, 'link'));
  // the ancestor `link` resolves to `real`; the not-yet-existing tail `.ssh/x` is kept verbatim
  assert.equal(canonicalPath(join(base, 'link', '.ssh', 'x')), join(base, 'real', '.ssh', 'x'));
  assert.doesNotThrow(() => canonicalPath('/nope/definitely/missing'));
});

test('buildSeatbeltProfile emits canonical (symlink-resolved) deny paths so the kernel rule matches', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'nm-canon-')));
  mkdirSync(join(base, 'real'));
  symlinkSync(join(base, 'real'), join(base, 'link'));
  const prof = buildSeatbeltProfile([join(base, 'link', '.ssh')]);
  assert.ok(prof.includes(`(subpath "${join(base, 'real', '.ssh')}")`), 'deny path must be canonicalized');
});

test('sandboxExecArgv puts the sandbox flags BEFORE the binary — the wrapped argv is untouched', () => {
  const a = sandboxExecArgv('/path/to/agy', ['--print', 'do the thing'], '/tmp/x/agent.sb');
  assert.deepEqual(a, ['/usr/bin/sandbox-exec', '-f', '/tmp/x/agent.sb', '/path/to/agy', '--print', 'do the thing']);
  // agy's own two args are the last two, in order, with nothing injected between them
  assert.deepEqual(a.slice(-2), ['--print', 'do the thing']);
});

test('Code profile separates writable worktree and read-only toolchains and blocks process/network access', () => {
  const p = strictCodeSeatbeltProfile(['/home/dev'], ['/home/dev/work/app'], ['/home/dev/.nvm/bin']);
  const writable = p.match(/\(allow file-read\* file-write\*[\s\S]*?\n\)/)?.[0] ?? '';
  assert.match(writable, /\/home\/dev\/work\/app/);
  assert.match(p, /\(allow file-read\*[\s\S]*\/home\/dev\/\.nvm\/bin/);
  assert.doesNotMatch(writable, /\/home\/dev\/\.nvm\/bin/);
  assert.ok(p.indexOf('(deny file-write*)') < p.indexOf('(allow file-read* file-write*'), 'the narrow worktree allow must follow the global write deny');
  assert.match(p, /\(deny network\*\)/);
  assert.match(p, /\(deny process-info\*\)/);
  assert.match(p, /\(deny signal \(target others\)\)/);
  assert.match(p, /\(deny appleevent-send\)/);
  assert.match(p, /\(deny mach-lookup[\s\S]*com\.apple\.securityd\.xpc/);
  assert.match(p, /com\.apple\.security\.XPCKeychainSandboxCheck/);
  assert.match(p, /com\.apple\.pboard/);
  assert.match(p, /com\.apple\.coreservices\.launchservicesd/);
});
