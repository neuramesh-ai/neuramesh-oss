// Containment L1b: the agy Seatbelt profile generator. Run: pnpm exec tsx --test src/main/sandbox/seatbelt.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildSeatbeltProfile, canonicalPath, cleanupTempProfile, sandboxExecArgv, seatbeltProfile, strictCodeSeatbeltProfile, writeTempProfile } from './seatbelt';

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
  assert.match(p, /\(allow process-info-pidinfo \(target self\)\)/);
  assert.match(p, /\(deny signal \(target others\)\)/);
  assert.match(p, /\(deny appleevent-send\)/);
  assert.match(p, /\(deny mach-lookup[\s\S]*com\.apple\.securityd\.xpc/);
  assert.match(p, /com\.apple\.SecurityServer/);
  assert.match(p, /com\.apple\.security\.XPCKeychainSandboxCheck/);
  assert.match(p, /com\.apple\.pboard/);
  assert.match(p, /com\.apple\.pasteboard\.1/);
  assert.match(p, /com\.apple\.coreservices\.launchservicesd/);
});

test('macOS Code sandbox runs nested Node tests while denying outside files, sockets, and other process inspection', { skip: process.platform !== 'darwin' }, () => {
  const base = realpathSync(mkdtempSync('/tmp/nm-seatbelt-node-'));
  const brain = join(base, 'device-a', 'brain');
  const root = join(brain, 'cache', 'worktrees', 'repo');
  const aliasRoot = root.replace(/^\/private\/tmp\//, '/tmp/');
  mkdirSync(root, { recursive: true });
  const outside = join(base, 'outside.txt');
  writeFileSync(outside, 'private fixture');
  const profile = writeTempProfile(strictCodeSeatbeltProfile([homedir(), base], [root], [dirname(process.execPath)]));
  try {
    const probe = `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const { spawnSync } = require('node:child_process');
      fs.writeFileSync('inside.txt', 'allowed');
      assert.equal(fs.readFileSync('inside.txt', 'utf8'), 'allowed');
      assert.throws(() => fs.readFileSync(${JSON.stringify(outside)}), { code: 'EPERM' });
      assert.throws(() => fs.writeFileSync(${JSON.stringify(outside)}, 'denied'), { code: 'EPERM' });
      const other = spawnSync('/bin/ps', ['-p', ${JSON.stringify(String(process.pid))}, '-o', 'command='], { encoding: 'utf8' });
      assert.notEqual(other.status, 0, other.stdout);
      const server = require('node:net').createServer();
      server.on('error', (error) => { assert.equal(error.code, 'EPERM'); console.log('sandbox-boundaries-verified'); });
      server.on('listening', () => { server.close(); throw new Error('network unexpectedly allowed'); });
      server.listen(0, '127.0.0.1');
    `;
    const result = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, process.execPath, '-e', probe], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      // The real executor gives commands a clean environment, so CoreFoundation initializes itself.
      env: { HOME: homedir(), PATH: '/usr/bin:/bin', TMPDIR: root },
    });
    assert.equal(result.status, 0, `${result.signal ?? ''}: ${result.stderr}`);
    assert.match(result.stdout, /sandbox-boundaries-verified/);
    writeFileSync(join(root, 'boundary.test.cjs'), `
      const { test } = require('node:test');
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      test('nested worktree metadata does not expose its ancestors', () => {
        assert.equal(fs.realpathSync(${JSON.stringify(aliasRoot)}), ${JSON.stringify(root)});
        assert.ok(fs.lstatSync(${JSON.stringify(brain)}).isDirectory());
        assert.throws(() => fs.readdirSync(${JSON.stringify(brain)}), { code: 'EPERM' });
        assert.throws(() => fs.lstatSync(${JSON.stringify(outside)}), { code: 'EPERM' });
        assert.throws(() => fs.readFileSync(${JSON.stringify(outside)}), { code: 'EPERM' });
        assert.throws(() => fs.writeFileSync(${JSON.stringify(join(brain, 'outside.txt'))}, 'denied'), { code: 'EPERM' });
      });
    `);
    const tests = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, process.execPath, '--test', 'boundary.test.cjs'], {
      cwd: aliasRoot, encoding: 'utf8', timeout: 10_000,
      env: { HOME: homedir(), PATH: '/usr/bin:/bin', TMPDIR: root },
    });
    assert.equal(tests.status, 0, `${tests.signal ?? ''}: ${tests.stderr}\n${tests.stdout}`);
    assert.match(tests.stdout, /(?:#|ℹ) pass 1/);
  } finally {
    cleanupTempProfile(profile);
    rmSync(base, { recursive: true, force: true });
  }
});
