import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { ClineCore, ToolExecutors } from '@cline/sdk';
import { createEngineeringToolExecutors } from './engineering-tools';
import { createEngineeringShellExecutor, engineeringBubblewrapArgv, engineeringNetworkSeccompFilter, validatedEngineeringGitMounts } from './engineering-safe-executors';
import { createClineEngineeringHost } from './engineering-host';

const context = {} as Parameters<NonNullable<ToolExecutors['readFile']>>[1];

function seccompVerdict(filter: Buffer, arch: number, syscall: number): number {
  let accumulator = 0; let cursor = 0;
  for (;;) {
    const offset = cursor * 8; const code = filter.readUInt16LE(offset);
    const jumpTrue = filter.readUInt8(offset + 2); const jumpFalse = filter.readUInt8(offset + 3);
    const value = filter.readUInt32LE(offset + 4);
    if (code === 0x20) { accumulator = value === 4 ? arch : syscall; cursor += 1; continue; }
    if (code === 0x15) { cursor += (accumulator === value ? jumpTrue : jumpFalse) + 1; continue; }
    if (code === 0x45) { cursor += ((accumulator & value) !== 0 ? jumpTrue : jumpFalse) + 1; continue; }
    if (code === 0x06) return value;
    throw new Error(`Unsupported seccomp test instruction ${String(code)}`);
  }
}

test('Linux Code shell sandbox isolates network and mounts only the selected worktree', () => {
  const argv = engineeringBubblewrapArgv('/nm/cache/worktrees/thread-1', 'pnpm test');
  assert.equal(argv.includes('--unshare-all'), true);
  assert.equal(argv.includes('--share-net'), true);
  assert.deepEqual(argv.slice(argv.indexOf('--seccomp'), argv.indexOf('--seccomp') + 2), ['--seccomp', '3']);
  assert.deepEqual(argv.slice(-7), ['--chdir', '/nm/cache/worktrees/thread-1', '/bin/bash', '--noprofile', '--norc', '-c', 'pnpm test']);
  assert.equal(argv.includes('/nm/home'), false);
  assert.equal(argv.includes('/nm/state'), false);
  assert.equal(argv.some((value, index) => value === '--bind' && argv[index + 1] === '/nm/cache/worktrees/thread-1'), true);
});

test('Linux Code shell supplies a native seccomp filter for its shared outer network namespace', () => {
  const filter = engineeringNetworkSeccompFilter();
  assert.equal(filter.length % 8, 0);
  assert.equal(filter.readUInt32LE(filter.length - 4), 0x7fff0000);
  if (process.arch === 'x64') {
    assert.equal(seccompVerdict(filter, 0xc000003e, 41), 0x00050001);
    assert.equal(seccompVerdict(filter, 0xc000003e, 0x40000000 | 41), 0x00050001);
    assert.equal(seccompVerdict(filter, 0xc000003e, 39), 0x7fff0000);
    assert.equal(seccompVerdict(filter, 0x40000003, 41), 0x80000000);
  }
});

test('Linux Code shell enforces the real Bubblewrap boundary used by the machine image', { skip: process.platform !== 'linux' }, async () => {
  const base = await mkdtemp('/tmp/nm-engineering-bwrap-');
  const root = `${base}/repo`;
  const outside = `${base}/outside.txt`;
  let networkHits = 0;
  const server = createServer((_request, response) => { networkHits += 1; response.end('reachable'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  await mkdir(root);
  await writeFile(outside, 'host secret\n');
  const hostPidNamespace = await readlink('/proc/self/ns/pid');
  const shell = createEngineeringShellExecutor(root, []);
  try {
    if (!existsSync('/usr/bin/bwrap')) {
      await assert.rejects(shell('true', root, context), /required OS sandbox is not installed/);
      assert.notEqual(process.env['CI'], 'true', 'CI must install Bubblewrap so the production Linux boundary is exercised');
      return;
    }
    assert.match(await shell('printf inside > proof.txt; cat proof.txt', root, context), /inside/);
    assert.equal(await readFile(`${root}/proof.txt`, 'utf8'), 'inside');
    await assert.rejects(shell(`cat '${outside}'`, root, context));
    assert.notEqual((await shell('readlink /proc/self/ns/pid', root, context)).trim(), hostPidNamespace);
    const port = (server.address() as { port: number }).port;
    await assert.rejects(shell(`exec 3<>/dev/tcp/127.0.0.1/${String(port)}; printf ping >&3`, root, context));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(networkHits, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(base, { recursive: true });
  }
});

test('the production machine image installs the mandatory Linux command sandbox', async () => {
  const dockerfile = await readFile(new URL('../../../../../infra/images/machine/Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /\bbubblewrap\b/);
});

test('Code shell refuses repository-controlled Git pointers outside machine-owned metadata', async () => {
  const base = await mkdtemp('/tmp/nm-engineering-git-mount-');
  const root = `${base}/worktrees/thread-1`;
  const repo = `${base}/repos/r1`;
  try {
    await mkdir(`${repo}/.git/worktrees/thread-1`, { recursive: true });
    await mkdir(root, { recursive: true });
    await writeFile(`${root}/.git`, 'gitdir: /\n');
    assert.throws(() => validatedEngineeringGitMounts(root, repo), /outside the selected repository/);
    await writeFile(`${root}/.git`, `gitdir: ${repo}/.git/worktrees/thread-1\n`);
    const mounts = validatedEngineeringGitMounts(root, repo);
    assert.equal(mounts.writable.some((path) => path === '/' || path === '/nm' || path === base), false);
    assert.deepEqual(mounts.readonly, [await realpath(`${repo}/.git`)]);
  } finally { await rm(base, { recursive: true }); }
});

test('Engineering native tools are rooted in the selected repository', async () => {
  const base = await mkdtemp('/tmp/nm-engineering-tools-');
  const root = `${base}/repo`;
  try {
    await mkdir(`${root}/src`, { recursive: true });
    await writeFile(`${root}/README.md`, 'fixture repository\n');
    const { createDefaultExecutors } = await import('@cline/sdk');
    const managed = await createEngineeringToolExecutors(root, createDefaultExecutors);
    const { executors } = managed;
    const canonicalRoot = await realpath(root);

    assert.match(String(await executors.readFile!({ path: 'README.md' }, context)), /fixture repository/);
    assert.equal((await executors.bash!('pwd', '/wrong/process/cwd', context)).trim(), canonicalRoot);
    await executors.editor!({ path: 'src/created.ts', new_text: 'export const rooted = true;\n' }, '/wrong/process/cwd', context);
    assert.equal(await readFile(`${root}/src/created.ts`, 'utf8'), 'export const rooted = true;\n');
    managed.close();
  } finally {
    await rm(base, { recursive: true });
  }
});

test('Engineering caps each native file read before it reaches a runtime event', async () => {
  const root = await mkdtemp('/tmp/nm-engineering-read-cap-');
  let options: Record<string, unknown> | undefined;
  try {
    const createDefaults = ((value: Record<string, unknown>) => { options = value; return {}; }) as unknown as typeof import('@cline/sdk').createDefaultExecutors;
    await createEngineeringToolExecutors(root, createDefaults);
    assert.deepEqual(options?.['fileRead'], { maxFileSizeBytes: 2_000_000 });
  } finally { await rm(root, { recursive: true }); }
});

test('Engineering native tools reject traversal, outside absolute paths, and symlink escapes', async () => {
  const base = await mkdtemp('/tmp/nm-engineering-boundary-');
  const root = `${base}/repo`;
  const outside = `${base}/outside`;
  try {
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(`${outside}/secret.txt`, 'must not escape\n');
    await symlink(outside, `${root}/escape`);
    const { createDefaultExecutors } = await import('@cline/sdk');
    const managed = await createEngineeringToolExecutors(root, createDefaultExecutors);
    const { executors } = managed;

    await assert.rejects(executors.readFile!({ path: '../outside/secret.txt' }, context), /outside the selected repository/);
    await assert.rejects(executors.readFile!({ path: `${outside}/secret.txt` }, context), /outside the selected repository/);
    await assert.rejects(executors.readFile!({ path: 'escape/secret.txt' }, context), /outside the selected repository/);
    await assert.rejects(
      executors.editor!({ path: 'escape/new.ts', new_text: 'leak' }, root, context),
      /outside the selected repository/,
    );
    managed.close();
    await assert.rejects(
      executors.applyPatch!({ input: '*** Begin Patch\n*** Add File: ../outside/leak.ts\n+leak\n*** End Patch' }, root, context),
      /outside the selected repository/,
    );
  } finally {
    await rm(base, { recursive: true });
  }
});

test('Engineering shell strips daemon and provider credentials from child processes', async () => {
  const root = await mkdtemp('/tmp/nm-engineering-env-');
  const previous = { machine: process.env['NM_MACHINE_TOKEN'], provider: process.env['ANTHROPIC_API_KEY'] };
  process.env['NM_MACHINE_TOKEN'] = 'nmm_must_not_leak'; process.env['ANTHROPIC_API_KEY'] = 'sk-must-not-leak';
  try {
    const { createDefaultExecutors } = await import('@cline/sdk');
    const managed = await createEngineeringToolExecutors(root, createDefaultExecutors);
    const output = await managed.executors.bash!(`if [ -n "\${NM_MACHINE_TOKEN:-}" ]; then printf true; else printf false; fi; printf :; if [ -n "\${ANTHROPIC_API_KEY:-}" ]; then printf true; else printf false; fi`, root, context);
    assert.equal(output.trim(), 'false:false');
    managed.close();
  } finally {
    if (previous.machine === undefined) delete process.env['NM_MACHINE_TOKEN']; else process.env['NM_MACHINE_TOKEN'] = previous.machine;
    if (previous.provider === undefined) delete process.env['ANTHROPIC_API_KEY']; else process.env['ANTHROPIC_API_KEY'] = previous.provider;
    await rm(root, { recursive: true });
  }
});

test('macOS Code shell blocks direct sockets and parent-process inspection', { skip: process.platform !== 'darwin' }, async () => {
  const server = createServer((_request, response) => response.end('should not arrive'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp('/tmp/nm-engineering-seatbelt-');
  try {
    const { createDefaultExecutors } = await import('@cline/sdk');
    const managed = await createEngineeringToolExecutors(root, createDefaultExecutors);
    const port = (server.address() as { port: number }).port;
    await assert.rejects(managed.executors.bash!(`/usr/bin/curl --max-time 1 http://127.0.0.1:${port}`, root, context));
    await assert.rejects(managed.executors.bash!('/bin/ps -p "$PPID" -o command=', root, context));
    managed.close();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true });
  }
});

test('macOS Code shell writes only to its worktree and private command temp directory', { skip: process.platform !== 'darwin' }, async () => {
  const base = await mkdtemp('/tmp/nm-engineering-write-boundary-');
  const root = `${base}/repo`; const outside = `${base}/outside.txt`;
  await mkdir(root); await writeFile(outside, 'original\n');
  try {
    const { createDefaultExecutors } = await import('@cline/sdk');
    const managed = await createEngineeringToolExecutors(root, createDefaultExecutors);
    await assert.rejects(managed.executors.bash!(`printf changed > '${outside}'`, root, context));
    assert.equal(await readFile(outside, 'utf8'), 'original\n');
    assert.match(await managed.executors.bash!('printf inside > proof.txt; cat proof.txt; printf temp > "$TMPDIR/proof"', root, context), /inside/);
    assert.equal(await readFile(`${root}/proof.txt`, 'utf8'), 'inside');
    managed.close();
  } finally { await rm(base, { recursive: true }); }
});

test('macOS Code shell cannot retrieve a credential through Keychain IPC', { skip: process.platform !== 'darwin' }, async () => {
  const base = await mkdtemp('/tmp/nm-engineering-keychain-');
  const root = `${base}/repo`; const keychain = `${base}/outside.keychain-db`;
  const service = `nm-code-test-${Date.now().toString(36)}`; const secret = `credential-${crypto.randomUUID()}`;
  await mkdir(root);
  try {
    execFileSync('/usr/bin/security', ['create-keychain', '-p', 'test-password', keychain]);
    execFileSync('/usr/bin/security', ['unlock-keychain', '-p', 'test-password', keychain]);
    execFileSync('/usr/bin/security', ['add-generic-password', '-a', 'code-test', '-s', service, '-w', secret, keychain]);
    assert.equal(execFileSync('/usr/bin/security', ['find-generic-password', '-a', 'code-test', '-s', service, '-w', keychain], { encoding: 'utf8' }).trim(), secret);
    const { createDefaultExecutors } = await import('@cline/sdk');
    const managed = await createEngineeringToolExecutors(root, createDefaultExecutors);
    await assert.rejects(managed.executors.bash!(`/usr/bin/security find-generic-password -a code-test -s '${service}' -w '${keychain}'`, root, context));
    managed.close();
  } finally {
    try { execFileSync('/usr/bin/security', ['delete-keychain', keychain]); } catch { /* best-effort fixture cleanup */ }
    await rm(base, { recursive: true });
  }
});

test('macOS Code shell cannot read the pasteboard or broker actions through LaunchServices', { skip: process.platform !== 'darwin' }, async () => {
  const root = await mkdtemp('/tmp/nm-engineering-brokers-');
  const priorPasteboard = execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' });
  const sentinel = `clipboard-${crypto.randomUUID()}`;
  try {
    execFileSync('/usr/bin/pbcopy', { input: sentinel });
    const { createDefaultExecutors } = await import('@cline/sdk');
    const managed = await createEngineeringToolExecutors(root, createDefaultExecutors);
    await assert.rejects(managed.executors.bash!('/usr/bin/pbpaste', root, context));
    await assert.rejects(managed.executors.bash!('/usr/bin/open -Ra Safari', root, context));
    managed.close();
  } finally {
    execFileSync('/usr/bin/pbcopy', { input: priorPasteboard });
    await rm(root, { recursive: true });
  }
});

test('Engineering web fetch refuses redirects before contacting their destination', async () => {
  let destinationHits = 0;
  const destination = createServer((_request, response) => { destinationHits += 1; response.end('secret'); });
  const redirect = createServer((_request, response) => { response.writeHead(302, { location: `http://127.0.0.1:${String((destination.address() as { port: number }).port)}/secret` }); response.end(); });
  await new Promise<void>((resolve) => destination.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => redirect.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp('/tmp/nm-engineering-web-');
  try {
    const { createDefaultExecutors } = await import('@cline/sdk');
    const managed = await createEngineeringToolExecutors(root, createDefaultExecutors);
    const port = (redirect.address() as { port: number }).port;
    await assert.rejects(managed.executors.webFetch!(`http://127.0.0.1:${port}/start`, 'read', context), /does not follow redirects/);
    assert.equal(destinationHits, 0);
    managed.close();
  } finally {
    await new Promise<void>((resolve) => redirect.close(() => resolve()));
    await new Promise<void>((resolve) => destination.close(() => resolve()));
    await rm(root, { recursive: true });
  }
});

test('Engineering host installs repository-rooted executors on every runtime core', async () => {
  const base = await mkdtemp('/tmp/nm-engineering-host-tools-');
  const root = `${base}/repo`;
  let capabilities: ToolExecutors | undefined;
  try {
    await mkdir(root, { recursive: true });
    await writeFile(`${root}/README.md`, 'host fixture\n');
    const { createDefaultExecutors } = await import('@cline/sdk');
    const fake = {
      subscribe: () => () => {}, listHistory: async () => [], readMessages: async () => [],
      start: async () => ({ sessionId: 'runtime-1' }), send: async () => undefined, abort: async () => {},
      stop: async () => {}, dispose: async () => {}, restore: async () => ({ messages: [], checkpoint: { ref: 'x', createdAt: Date.now(), runCount: 1 } }),
    } as unknown as ClineCore;
    const host = createClineEngineeringHost({
      apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1',
      fetchImpl: async () => new Response(JSON.stringify({ token: 'sk-test', authMode: 'apikey' })),
      resolveCwd: async () => root, resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }),
      createDefaultExecutors,
      createCore: (async (options) => { capabilities = options?.capabilities?.toolExecutors; return fake; }) as typeof import('@cline/sdk').ClineCore.create,
    });
    const session = await host.open({
      threadId: 'e-tools', actorId: 'u1', repoId: 'r1', repoName: 'fixture', branch: 'main', mode: 'plan',
      permissions: { read: true, edit: false, command: false, web: false, mcp: false },
      policy: { read: true, edit: true, command: true, web: true, mcp: true },
    }, () => {});

    assert.match(String(await capabilities!.readFile!({ path: 'README.md' }, context)), /host fixture/);
    session.close();
  } finally {
    await rm(base, { recursive: true });
  }
});
