// THE END-TO-END CODE SHELL WITNESS (e2e-codeshell.ts): what it reads, what counts as a pass, and that a
// shell with no sandbox at all fails it (the negative control runs real bash here).
// Run: pnpm exec tsx --test src/main/cloudrun/e2e-codeshell.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolExecutors } from '@cline/sdk';
import { E2E_CODESHELL_FILE, E2E_DIR, firstFailure, probeCommand, probeLane, runCodeShellProbe } from './e2e-codeshell';
import type { CodeShellLane } from '../relay/engineering-safe-executors';

type Bash = NonNullable<ToolExecutors['bash']>;
const withDir = async (fn: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-e2e-codeshell-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

/** a shell that behaves as a perfect sandbox would: the tokens, the inside write, a failing exit */
const sandboxed = (o: { leakOutside?: boolean } = {}): ((root: string) => Bash) => (root) => (async (command: unknown) => {
  const text = String(command);
  if (text === 'exit 7') throw new Error('Code command exited via 7.');
  writeFileSync(join(root, 'nm-e2e-inside.txt'), 'inside');
  const outside = /printf outside > '([^']+)'/.exec(text)?.[1];
  if (o.leakOutside && outside) writeFileSync(outside, 'outside');
  return ['nm-run-ok', 'token-env:no', 'token-proc1:no', 'metadata:closed', 'public:closed', 'socket:denied', 'outside:wrote', 'usr:refused', 'inside:wrote'].join('\n');
}) as Bash;

test('the probe command reads back fixed tokens only and quotes the outside path', () => {
  const cmd = probeCommand("/nm/work/.nm-e2e/it's.txt");
  assert.match(cmd, /printf outside > '\/nm\/work\/\.nm-e2e\/it'\\''s\.txt'/);
  for (const token of ['nm-run-ok', 'token-env:', 'token-proc1:', 'metadata:', 'public:', 'socket:', 'outside:', 'usr:', 'inside:wrote']) assert.ok(cmd.includes(token), token);
  assert.doesNotMatch(cmd, /\$NM_MACHINE_TOKEN|printenv|cat \/proc\/1\/environ/, 'no value is ever printed');
});

test('a lane passes only when every boundary holds, and the host decides about writes', () => withDir(async (dir) => {
  const root = join(dir, 'wt');
  const outside = join(dir, 'outside.txt');
  const good = await probeLane(root, outside, sandboxed()(root));
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.equal(good.outsideWriteReachedHost, false, 'the sandbox said it wrote, but the host never saw it');
  assert.equal(firstFailure(good), 'ok');
  const leaky = await probeLane(root, outside, sandboxed({ leakOutside: true })(root));
  assert.equal(leaky.ok, false);
  assert.equal(firstFailure(leaky), 'outside write reached the host');
  const broken = await probeLane(root, outside, (async () => { throw new Error('bwrap: Creating new namespace failed: Operation not permitted'); }) as Bash);
  assert.equal(broken.ok, false);
  assert.equal(broken.ran, false);
  assert.match(firstFailure(broken), /^error: bwrap: Creating new namespace failed/);
}));

test('negative control: plain bash with no sandbox runs every check and fails the probe', { skip: process.platform !== 'linux' }, () => withDir(async (dir) => {
  const root = join(dir, 'wt');
  const bash = ((command: unknown, cwd: unknown) => new Promise<string>((resolve, reject) => {
    execFile('bash', ['-c', String(command)], { cwd: String(cwd), encoding: 'utf8', timeout: 30_000 }, (error, stdout, stderr) => (error ? reject(new Error(stdout + stderr)) : resolve(stdout + stderr)));
  })) as Bash;
  const r = await probeLane(root, join(dir, 'outside.txt'), bash);
  assert.equal(r.ran, true);
  assert.equal(r.insideWriteReachedHost, true);
  assert.equal(r.outsideWriteReachedHost, true, 'nothing confines plain bash');
  assert.equal(r.loopbackSocketDenied, false, 'a socket is not denied without the seccomp filter');
  assert.equal(r.failingCommandFails, true);
  assert.equal(r.tokenInEnv, false);
  assert.equal(r.ok, false);
}));

test('the witness: both lanes, the selected one decides ok, and the log line carries no output', () => withDir(async (dir) => {
  const lines: string[] = [];
  const lane: CodeShellLane = { name: 'box', run: async () => '' };
  const asked: string[] = [];
  const out = await runCodeShellProbe({
    workDir: dir, epoch: 4, boxLane: lane, log: (l) => lines.push(l),
    selection: Promise.resolve({ lane: 'box', mode: 'auto', reason: 'auto: Bubblewrap runs in the box and refuses a socket', checks: { box: null } }),
    executor: (root, which) => { asked.push(which === 'supervisor' ? 'supervisor' : which.name); return which === 'supervisor' ? (async () => { throw new Error('bwrap: setting up uid map: Permission denied'); }) as Bash : sandboxed()(root); },
  });
  assert.deepEqual(asked, ['supervisor', 'box']);
  assert.equal(out.ok, true);
  assert.equal(out.lanes.box.ok, true);
  assert.equal(out.lanes.supervisor.ok, false);
  const file = JSON.parse(readFileSync(join(dir, E2E_DIR, E2E_CODESHELL_FILE), 'utf8')) as Record<string, unknown>;
  assert.equal(file['selected'], 'box');
  assert.equal(file['epoch'], 4);
  assert.deepEqual(lines, ['e2e codeshell: selected=box ok=true box=ok supervisor=error: bwrap: setting up uid map: Permission denied']);

  const none = await runCodeShellProbe({
    workDir: dir, epoch: 5, boxLane: null, log: () => {},
    selection: Promise.resolve({ lane: 'none', mode: 'auto', reason: 'auto: both lanes failed', checks: {} }),
    executor: (root) => sandboxed()(root),
  });
  assert.equal(none.ok, false, 'no lane selected: Code commands are off, whatever the lanes did');
  assert.equal(none.lanes.box.error, 'this machine has no agent box');
}));
