// THE END-TO-END CODE SHELL WITNESS (NM_E2E_CODESHELL=1, called by machined-e2e.ts once the boot's
// Code shell choice is made). It runs the production Code shell executor (relay/engineering-safe-
// executors.ts) once per lane on a scratch worktree under the work dir, and proves on a real Cloud Run
// machine what unit tests cannot: that Bubblewrap starts under Cloud Run's sandbox (the supervisor
// lane) and inside the agent box (the box lane, code-shell.ts), and that each keeps its boundary.
//
//   <workDir>/.nm-e2e/codeshell.json   {ok, epoch, selected, reason, lanes: {supervisor, box}, at}
//
// Per lane: a command runs; NM_MACHINE_TOKEN is in neither its env nor /proc/1/environ; the metadata
// server, a public address and a loopback socket are unreachable; a write outside the worktree does
// not reach the host while one inside does; /usr is read-only; a failing command fails (the box lane's
// exit code crosses `sandbox exec`). Only fixed tokens are read back, never the command's env or output,
// so nothing secret reaches the witness or the log.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolExecutors } from '@cline/sdk';
import { createEngineeringShellExecutor, type CodeShellLane } from '../relay/engineering-safe-executors';
import type { CodeShellSelection } from './code-shell';

export const E2E_DIR = '.nm-e2e';
export const E2E_CODESHELL_FILE = 'codeshell.json';

export interface CodeShellLaneResult {
  ok: boolean;
  ran: boolean;
  tokenInEnv: boolean | null;
  tokenInProc1: boolean | null;
  metadataReachable: boolean | null;
  publicReachable: boolean | null;
  loopbackSocketDenied: boolean | null;
  outsideWriteReachedHost: boolean | null;
  insideWriteReachedHost: boolean | null;
  usrWritable: boolean | null;
  failingCommandFails: boolean | null;
  ms: number;
  error?: string;
}

export interface CodeShellProbeResult {
  ok: boolean;
  epoch: number;
  selected: CodeShellSelection['lane'];
  reason: string;
  checks: CodeShellSelection['checks'];
  lanes: { supervisor: CodeShellLaneResult; box: CodeShellLaneResult };
  at: string;
}

export interface CodeShellProbeOptions {
  workDir: string;
  epoch: number;
  selection: Promise<CodeShellSelection>;
  /** the box lane (code-shell.ts), or null when there is no box */
  boxLane: CodeShellLane | null;
  log?: (line: string) => void;
  /** test seam: the executor for one lane */
  executor?: (root: string, lane: CodeShellLane | 'supervisor') => NonNullable<ToolExecutors['bash']>;
}

/** the one command whose output the checks read: fixed tokens only */
export function probeCommand(outsideFile: string): string {
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
  return [
    'echo nm-run-ok',
    "if env | grep -q '^NM_MACHINE_TOKEN='; then echo token-env:yes; else echo token-env:no; fi",
    "if grep -qa -e NM_MACHINE_TOKEN -e nmm_ /proc/1/environ 2>/dev/null; then echo token-proc1:yes; else echo token-proc1:no; fi",
    "if timeout 5 bash -c 'exec 3<>/dev/tcp/169.254.169.254/80' 2>/dev/null; then echo metadata:open; else echo metadata:closed; fi",
    "if timeout 5 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' 2>/dev/null; then echo public:open; else echo public:closed; fi",
    "if (exec 3<>/dev/tcp/127.0.0.1/9) 2>&1 | grep -qi 'not permitted'; then echo socket:denied; else echo socket:other; fi",
    `if (printf outside > ${q(outsideFile)}) 2>/dev/null; then echo outside:wrote; else echo outside:refused; fi`,
    "if (printf x > /usr/nm-e2e-probe) 2>/dev/null; then echo usr:wrote; else echo usr:refused; fi",
    'printf inside > nm-e2e-inside.txt && echo inside:wrote',
  ].join('\n');
}

const context = {} as Parameters<NonNullable<ToolExecutors['bash']>>[2];

export async function probeLane(root: string, outsideFile: string, run: NonNullable<ToolExecutors['bash']>): Promise<CodeShellLaneResult> {
  const t0 = Date.now();
  const result: CodeShellLaneResult = {
    ok: false, ran: false, tokenInEnv: null, tokenInProc1: null, metadataReachable: null, publicReachable: null, loopbackSocketDenied: null,
    outsideWriteReachedHost: null, insideWriteReachedHost: null, usrWritable: null, failingCommandFails: null, ms: 0,
  };
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  rmSync(outsideFile, { force: true });
  try {
    const out = String(await run(probeCommand(outsideFile), root, context));
    const has = (token: string): boolean => out.split('\n').some((line) => line.trim() === token);
    result.ran = has('nm-run-ok');
    result.tokenInEnv = has('token-env:yes') ? true : has('token-env:no') ? false : null;
    result.tokenInProc1 = has('token-proc1:yes') ? true : has('token-proc1:no') ? false : null;
    result.metadataReachable = has('metadata:open') ? true : has('metadata:closed') ? false : null;
    result.publicReachable = has('public:open') ? true : has('public:closed') ? false : null;
    result.loopbackSocketDenied = has('socket:denied') ? true : has('socket:other') ? false : null;
    result.usrWritable = has('usr:wrote') ? true : has('usr:refused') ? false : null;
    // the host decides: inside the sandbox an outside path may land on its own tmpfs and vanish
    result.outsideWriteReachedHost = existsSync(outsideFile);
    result.insideWriteReachedHost = existsSync(join(root, 'nm-e2e-inside.txt')) && readFileSync(join(root, 'nm-e2e-inside.txt'), 'utf8') === 'inside';
  } catch (e) {
    result.error = (e instanceof Error ? e.message : String(e)).trim().slice(0, 300);
  }
  if (result.ran) {
    try { await run('exit 7', root, context); result.failingCommandFails = false; } catch { result.failingCommandFails = true; }
  }
  result.ms = Date.now() - t0;
  result.ok = result.ran && result.tokenInEnv === false && result.tokenInProc1 === false && result.metadataReachable === false
    && result.publicReachable === false && result.loopbackSocketDenied === true && result.outsideWriteReachedHost === false
    && result.insideWriteReachedHost === true && result.usrWritable === false && result.failingCommandFails === true;
  rmSync(outsideFile, { force: true });
  return result;
}

const notRun = (error: string): CodeShellLaneResult => ({
  ok: false, ran: false, tokenInEnv: null, tokenInProc1: null, metadataReachable: null, publicReachable: null, loopbackSocketDenied: null,
  outsideWriteReachedHost: null, insideWriteReachedHost: null, usrWritable: null, failingCommandFails: null, ms: 0, error,
});

/** the first check a lane failed, for the log line */
export function firstFailure(r: CodeShellLaneResult): string {
  if (r.ok) return 'ok';
  if (r.error && !r.ran) return `error: ${r.error.slice(0, 120)}`;
  const named: Array<[string, boolean]> = [
    ['did not run', !r.ran], ['token in env', r.tokenInEnv !== false], ['token in /proc/1/environ', r.tokenInProc1 !== false],
    ['metadata reachable', r.metadataReachable !== false], ['public network reachable', r.publicReachable !== false],
    ['loopback socket not denied', r.loopbackSocketDenied !== true], ['outside write reached the host', r.outsideWriteReachedHost !== false],
    ['inside write missing', r.insideWriteReachedHost !== true], ['/usr writable', r.usrWritable !== false], ['a failing command succeeded', r.failingCommandFails !== true],
  ];
  return named.find(([, bad]) => bad)?.[0] ?? 'failed';
}

export async function runCodeShellProbe(o: CodeShellProbeOptions): Promise<CodeShellProbeResult> {
  const log = o.log ?? (() => {});
  const dir = join(o.workDir, E2E_DIR);
  mkdirSync(dir, { recursive: true });
  const executor = o.executor ?? ((root: string, lane: CodeShellLane | 'supervisor') => createEngineeringShellExecutor(root, [], undefined, undefined, { lane }));
  const selection = await o.selection;
  const lane = async (name: 'supervisor' | 'box'): Promise<CodeShellLaneResult> => {
    if (name === 'box' && !o.boxLane) return notRun('this machine has no agent box');
    const root = join(dir, `codeshell-${name}-wt`);
    const outside = join(dir, `codeshell-${name}-outside.txt`);
    return probeLane(root, outside, executor(root, name === 'box' ? o.boxLane! : 'supervisor'));
  };
  const supervisor = await lane('supervisor');
  const box = await lane('box');
  const chosen = selection.lane === 'box' ? box : selection.lane === 'supervisor' ? supervisor : null;
  const result: CodeShellProbeResult = {
    ok: !!chosen?.ok, epoch: o.epoch, selected: selection.lane, reason: selection.reason, checks: selection.checks,
    lanes: { supervisor, box }, at: new Date().toISOString(),
  };
  writeFileSync(join(dir, E2E_CODESHELL_FILE), `${JSON.stringify(result, null, 2)}\n`);
  log(`e2e codeshell: selected=${selection.lane} ok=${result.ok} box=${firstFailure(box)} supervisor=${firstFailure(supervisor)}`);
  return result;
}
