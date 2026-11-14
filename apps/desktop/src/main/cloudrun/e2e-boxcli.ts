// THE E2E WITNESS FOR THE BOX RUNTIMES (README.md, "Agent runtimes in the box").
//
// machined-e2e calls `runBoxCliProbe` when NM_E2E_BOXCLI=1, after `startBoxRuntimes` succeeded. Every
// command goes the exact way an SDK's CLI goes: this process spawns a relay wrapper as its child (as
// `pathToClaudeCodeExecutable` / `ensureCli` hand it to an SDK), with the env `providerEnv` builds
// (and so its relay ticket); the wrapper reaches the relay on 127.0.0.1; machined (PID 1) runs the
// command in the box through `BoxManager.exec`. A synthetic credential rides every spawn through
// the normal lane (NM_AGENT_ENV_PASSTHROUGH → the box env allowlist → secretEnv, by its name), so a
// grep of the sandbox launcher's command-line logs for its value proves it never reached argv.
//
// The steps: the runtime CLI's `--version`; in-box env (the secret present and equal by sha256, in no
// process's cmdline, uid, cwd under /work, the host work path an alias of /work, hostname); the
// metadata server unreachable (no proxy);
// the tool bus on the veth IP with and without the per-box bearer; and the real bus shim listing a
// tool over MCP. The result (codes, durations, the secret's sha256, never its value) lands in
// <workDir>/.nm-e2e/boxcli.json and one `[machined] e2e boxcli:` line.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as orchmcp from '../runtime/orchmcp';
import { providerEnv } from '../runtime/adapter';
import { BOX_WORK } from './box';
import { BOX_SHIM_REL } from './runtime-start';
import { boxRuntime, type BoxRuntimeHooks } from './runtime-state';

export const PROBE_SECRET_ENV = 'NM_E2E_SECRET_PROBE';
export const PROBE_TOOL = 'nm_e2e_ping';
export const METADATA_URL = 'http://169.254.169.254/';

export interface WrapperRun { code: number | null; signal: string | null; stdout: string; stderr: string; ms: number; timedOut: boolean }

export interface ProbeStep {
  name: 'version' | 'env' | 'metadata' | 'bus' | 'shim';
  target: string;
  ok: boolean;
  code: number | null;
  signal: string | null;
  ms: number;
  detail: Record<string, unknown>;
  stderrTail?: string;
}

export interface BoxCliProbeResult {
  ok: boolean;
  /** the e2e driver's contract (run.mjs --with-boxcli): the version step passed */
  cliRan: boolean;
  /** the env step: the secret present in the box, sha256 equal, in no /proc/<pid>/cmdline */
  secretInBox: boolean;
  /** the metadata server was unreachable from the box, with no proxy */
  metadataBlocked: boolean;
  /** the bus answered 200 with the per-box bearer and 401/403 without it, and the real shim listed the tool */
  toolBusAuth: boolean;
  /** a file written under the box work dir is there through the host work path (R5's alias) */
  hostPathAlias: boolean;
  at: string;
  secretSha256: string;
  steps: ProbeStep[];
  summary: string;
  file: string | null;
}

export interface BoxCliProbeOptions {
  /** the host work dir (the box sees it at /work) */
  workDir: string;
  /** receives the synthetic secret's raw value, and nothing else does */
  onSecret?: (value: string) => void;
  log?: (line: string) => void;
  /** which runtime CLI answers `--version` */
  versionTarget?: 'agy' | 'claude' | 'codex';
  timeoutMs?: number;
  /** test seams */
  hooks?: BoxRuntimeHooks | null;
  bridge?: Pick<typeof orchmcp, 'ensureBridge' | 'registerTurn' | 'unregisterTurn'>;
  metadataUrl?: string;
  /** where the box sees the work dir and the bus shim */
  boxWork?: string;
  boxShim?: string;
  /** passed by machined-e2e and not needed here (the hooks carry the box); accepted so the call type-checks */
  box?: unknown;
  runtimes?: unknown;
  epoch?: number;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Spawn a relay wrapper the way an SDK does: a plain child with an env, a cwd and piped stdio. */
export function runWrapper(file: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string, timeoutMs: number): Promise<WrapperRun> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, [...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: null, signal: null, stdout: '', stderr: err instanceof Error ? err.message : String(err), ms: Date.now() - t0, timedOut: false });
      return;
    }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { stdout = (stdout + d.toString('utf8')).slice(-65536); });
    child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-4096); });
    child.once('error', (err) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${err.message}`, ms: Date.now() - t0, timedOut }); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: Date.now() - t0, timedOut }); });
  });
}

const parse = (s: string): Record<string, unknown> => {
  try { const j: unknown = JSON.parse(s.trim()); return j && typeof j === 'object' ? (j as Record<string, unknown>) : { raw: s.slice(0, 200) }; } catch { return { raw: s.slice(0, 200) }; }
};

// node scripts for the box: each passed as `$0` to `sh -c 'exec node -e "$0"'`, so no quoting games.
// The env script reports its cwd base64-encoded: the relay maps the CLI's stdout box → host (R5), so
// a plain "/work/…" comes back as the host work path and cannot show where the process ran. It also
// writes a marker under the box work dir and looks for it through the host work path (both passed
// base64, so the argv mapping leaves them alone): the alias R5 promises for host paths in a prompt.
const ENV_JS = [
  'const c=require("crypto"),fs=require("fs"),os=require("os");',
  `const v=process.env.${PROBE_SECRET_ENV};`,
  'const hw=Buffer.from(process.argv[1]||"","base64").toString(),bw=Buffer.from(process.argv[2]||"","base64").toString();',
  'let inCmdline=false;',
  'try{for(const p of fs.readdirSync("/proc")){if(!/^\\d+$/.test(p))continue;try{if(v&&fs.readFileSync("/proc/"+p+"/cmdline").includes(v)){inCmdline=true;break}}catch(e){}}}catch(e){}',
  'let hostPathLive=null;if(hw&&bw){const m="/.nm-e2e/hostpath-"+process.pid;try{fs.writeFileSync(bw+m,"x");hostPathLive=fs.existsSync(hw+m)}catch(e){hostPathLive=false}try{fs.rmSync(bw+m,{force:true})}catch(e){}}',
  'process.stdout.write(JSON.stringify({secretPresent:!!v,secretSha256:v?c.createHash("sha256").update(v).digest("hex"):null,secretInAnyCmdline:inCmdline,',
  'uid:typeof process.getuid==="function"?process.getuid():null,cwd:process.cwd(),cwdB64:Buffer.from(process.cwd()).toString("base64"),hostPathLive,hostname:os.hostname(),home:process.env.HOME||null}))',
].join('');

const META_SH = 'if command -v curl >/dev/null 2>&1; then exec curl --noproxy "*" -sS -m 3 -o /dev/null -w "%{http_code}" "$0"; else exec node -e "$1" "$0"; fi';
const META_JS = 'fetch(process.argv[1],{signal:AbortSignal.timeout(3000)}).then(r=>{process.stdout.write(String(r.status));process.exit(0)},e=>{process.stderr.write(String(e&&e.message||e));process.exit(7)})';

const BUS_JS = [
  '(async()=>{const u=process.env.NM_ORCH_URL||"",t=process.env.NM_ORCH_TURN||"",s=process.env.NM_ORCH_SECRET||"",b=process.env.NM_BOX_BEARER||"";',
  'const q="/tools?turn="+encodeURIComponent(t)+"&secret="+encodeURIComponent(s);',
  'const go=async(h)=>{if(!u)return{status:0,error:"no NM_ORCH_URL in the box"};try{const r=await fetch(u+q,{headers:h,signal:AbortSignal.timeout(5000)});const j=r.ok?await r.json():null;return{status:r.status,tools:j?(j.tools||[]).map(x=>x.name):[]}}catch(e){return{status:0,error:String(e&&e.message||e)}}};',
  'const withBearer=await go(b?{authorization:"Bearer "+b}:{});const withoutBearer=await go({});',
  'process.stdout.write(JSON.stringify({url:u,bearerPresent:!!b,withBearer,withoutBearer}))})()',
].join('');

const SHIM_SH = 'printf "%s\\n" "$0" | exec node "$1"';

export async function runBoxCliProbe(o: BoxCliProbeOptions): Promise<BoxCliProbeResult> {
  const log = o.log ?? ((line: string) => console.log(line));
  const hooks = o.hooks === undefined ? boxRuntime() : o.hooks;
  const bridge = o.bridge ?? orchmcp;
  const timeoutMs = o.timeoutMs ?? 120_000;
  const boxWork = o.boxWork ?? BOX_WORK;
  const secret = `nm-e2e-${randomBytes(12).toString('hex')}`;
  const secretSha256 = sha256(secret);
  o.onSecret?.(secret);
  const scrub = (s: string): string => s.split(secret).join('[redacted]');
  const steps: ProbeStep[] = [];
  const passed = (name: ProbeStep['name']): boolean => steps.some((x) => x.name === name && x.ok);
  const finish = (summary: string, ok: boolean): BoxCliProbeResult => {
    const result: BoxCliProbeResult = {
      ok,
      cliRan: passed('version'),
      secretInBox: passed('env'),
      metadataBlocked: passed('metadata'),
      toolBusAuth: passed('bus') && passed('shim'),
      hostPathAlias: steps.some((x) => x.name === 'env' && x.detail['hostPathLive'] === true),
      at: new Date().toISOString(),
      secretSha256,
      steps,
      summary,
      file: null,
    };
    try {
      const dir = join(o.workDir, '.nm-e2e');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'boxcli.json');
      writeFileSync(file, `${scrub(JSON.stringify(result, null, 2))}\n`);
      result.file = file;
    } catch (err) {
      log(`[machined] e2e boxcli: could not write the result (${err instanceof Error ? err.message : String(err)})`);
    }
    log(`[machined] e2e boxcli: ${scrub(summary)}`);
    return result;
  };
  if (!hooks) return finish('ok=false the box runtimes are off (startBoxRuntimes did not run or failed)', false);
  const cwd = join(o.workDir, '.nm-e2e');
  mkdirSync(cwd, { recursive: true });

  // the env an SDK's spawn gets, plus the synthetic credential and the extension that lets it cross
  const spawnEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
    const base = providerEnv('gemini', null);
    const passthrough = [process.env['NM_AGENT_ENV_PASSTHROUGH'], PROBE_SECRET_ENV].filter(Boolean).join(',');
    return { ...base, ...extra, [PROBE_SECRET_ENV]: secret, NM_AGENT_ENV_PASSTHROUGH: passthrough };
  };
  const step = async (name: ProbeStep['name'], target: string, file: string | null | undefined, args: string[], judge: (r: WrapperRun, detail: Record<string, unknown>) => { ok: boolean; detail: Record<string, unknown> }, extraEnv?: Record<string, string>): Promise<ProbeStep> => {
    if (!file) {
      const s: ProbeStep = { name, target, ok: false, code: null, signal: null, ms: 0, detail: { error: `no wrapper for ${target}${target.startsWith('nm-e2e') ? ' (NM_E2E_BOXCLI=1 must be set when machined starts)' : ''}` } };
      steps.push(s);
      return s;
    }
    const r = await runWrapper(file, args, spawnEnv(extraEnv), cwd, timeoutMs);
    const { ok, detail } = judge(r, parse(r.stdout));
    const s: ProbeStep = { name, target, ok: ok && !r.timedOut, code: r.code, signal: r.signal, ms: r.ms, detail: r.timedOut ? { ...detail, timedOut: true } : detail, ...(ok ? {} : { stderrTail: scrub(r.stderr.slice(-600)) }) };
    steps.push(s);
    return s;
  };

  // 1. a runtime CLI, through its own production wrapper
  const vt = o.versionTarget ?? 'agy';
  const version = await step('version', vt, hooks.wrapper(vt), ['--version'], (r) => ({ ok: r.code === 0, detail: { version: scrub(r.stdout.trim().split('\n')[0] ?? '').slice(0, 120) } }));

  // 2. the box env
  const sh = hooks.e2eShell ?? null;
  const b64 = (s: string): string => Buffer.from(s).toString('base64');
  const envStep = await step('env', 'nm-e2e-sh', sh, ['-c', 'exec node -e "$0" "$1" "$2"', ENV_JS, b64(o.workDir), b64(boxWork)], (_r, d) => {
    const cwdIn = typeof d['cwdB64'] === 'string' ? Buffer.from(d['cwdB64'], 'base64').toString('utf8') : typeof d['cwd'] === 'string' ? d['cwd'] : '';
    return { ok: d['secretPresent'] === true && d['secretSha256'] === secretSha256 && d['secretInAnyCmdline'] === false && (cwdIn === boxWork || cwdIn.startsWith(`${boxWork}/`)), detail: { ...d, cwdInBox: cwdIn, secretMatches: d['secretSha256'] === secretSha256 } };
  });

  // 3. the metadata server, without any proxy: the box itself must not reach it
  const meta = await step('metadata', 'nm-e2e-sh', sh, ['-c', META_SH, o.metadataUrl ?? METADATA_URL, META_JS], (r) => {
    const http = /^\d{3}$/.test(r.stdout.trim()) ? Number(r.stdout.trim()) : null;
    return { ok: r.code !== 0 || http === null || http === 0, detail: { exit: r.code, httpCode: http, blocked: r.code !== 0 || !http } };
  });

  // 4 + 5. the tool bus on the veth IP (a real turn registration), raw and through the real shim
  let bus: ProbeStep | null = null;
  let shim: ProbeStep | null = null;
  const turnId = randomBytes(9).toString('hex');
  try {
    const loop = await bridge.ensureBridge();
    const turnSecret = randomBytes(24).toString('hex');
    bridge.registerTurn(turnId, turnSecret, [{ name: PROBE_TOOL, description: 'NeuraMesh e2e probe: answers pong', inputSchema: { type: 'object', properties: {} }, run: async () => 'pong' }]);
    const busEnv = { NM_ORCH_URL: `http://127.0.0.1:${loop}`, NM_ORCH_TURN: turnId, NM_ORCH_SECRET: turnSecret };
    bus = await step('bus', 'nm-e2e-sh', sh, ['-c', 'exec node -e "$0"', BUS_JS], (_r, d) => {
      const w = (d['withBearer'] ?? {}) as { status?: number; tools?: string[] };
      const wo = (d['withoutBearer'] ?? {}) as { status?: number };
      const url = typeof d['url'] === 'string' ? d['url'] : '';
      // the URL the box saw must be the rewritten one (veth IP, box port), never the loopback it was given
      return { ok: w.status === 200 && !!w.tools?.includes(PROBE_TOOL) && (wo.status === 401 || wo.status === 403) && !!url && url !== busEnv.NM_ORCH_URL, detail: d };
    }, busEnv);
    const listReq = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    shim = await step('shim', 'nm-e2e-sh', sh, ['-c', SHIM_SH, listReq, o.boxShim ?? `${boxWork}/${BOX_SHIM_REL}`], (r) => {
      const listed = r.stdout.includes(`"${PROBE_TOOL}"`);
      return { ok: r.code === 0 && listed, detail: { listed } };
    }, busEnv);
  } catch (err) {
    steps.push({ name: 'bus', target: 'nm-e2e-sh', ok: false, code: null, signal: null, ms: 0, detail: { error: err instanceof Error ? err.message : String(err) } });
  } finally {
    bridge.unregisterTurn(turnId);
  }

  const e = envStep.detail;
  const hostPathAlias = e['hostPathLive'] === true;
  const ok = steps.length === 5 && steps.every((s) => s.ok) && hostPathAlias;
  const bd = (bus?.detail ?? {}) as { withBearer?: { status?: number }; withoutBearer?: { status?: number } };
  const summary = [
    `ok=${ok}`,
    `version=${version.code}${version.detail['version'] ? `(${String(version.detail['version'])})` : ''}`,
    `secret=${e['secretPresent'] === true ? (e['secretMatches'] ? 'present,sha-match' : 'present,sha-MISMATCH') : 'ABSENT'}${e['secretInAnyCmdline'] === true ? ',IN-CMDLINE' : ''}`,
    `uid=${String(e['uid'] ?? '?')}`,
    `cwd=${String(e['cwdInBox'] ?? e['cwd'] ?? '?')}`,
    `hostpath=${hostPathAlias ? 'alias' : `MISSING(${String(e['hostPathLive'])})`}`,
    `host=${String(e['hostname'] ?? '?')}`,
    `metadata=${meta.ok ? `blocked(exit ${meta.code})` : `OPEN(http ${String(meta.detail['httpCode'])})`}`,
    `bus=${bd.withBearer?.status ?? '?'}/${bd.withoutBearer?.status ?? '?'}`,
    `shim=${shim?.ok ? 'ok' : 'FAIL'}`,
    `secretSha256=${secretSha256.slice(0, 16)}`,
    `ms=${steps.reduce((n, s) => n + s.ms, 0)}`,
  ].join(' ');
  return finish(summary, ok);
}
