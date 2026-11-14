// TURNS THE BOX RUNTIMES ON (README.md, "Agent runtimes in the box"). machined calls this once, after
// `sandbox run` succeeded and before the agent host starts. Unless it completes, nothing changes:
// the runtimes keep spawning in the supervisor, as before this file existed.
//
//   1. prepare the box: /tmp/nm-exec for pid files, the host work path as a symlink to /work (so a
//      git worktree's absolute gitdir and any host path in a prompt resolve in there too), and read
//      the box's default gateway: the host's veth IP.
//   2. expose the tool bus there (runtime/orchmcp.ts `ensureBoxBridge`, per-box bearer) and put the
//      bus shim and agy's MCP config where the box sees them.
//   3. start the relay on 127.0.0.1 and write one wrapper per CLI (runtime-relay.ts).
//   4. publish the hooks (runtime-state.ts): from here the SDKs spawn the wrappers.
//
// THE BOX LINK (boxlink.ts, round 6). Since 2026-10-29 the box reaches no port on the veth gateway, so
// with a `link` the bus listens on the supervisor's loopback (still behind the per-box bearer) and the
// link opens it, and the egress proxy, on the box's own loopback: the URLs the box gets name
// 127.0.0.1:<box port>. Without one (NM_BOX_LINK=veth) everything binds the veth IP, as before.
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { BOX_HOME, BOX_WORK, SUPERVISOR_FROM_BOX, shQuote, type BoxResult, type ExecOptions } from './box';
import { BoxRuntimeSpawner, forwardTcp, parseDefaultGateway, PathMap, UrlRewrite, type BoxExecLike } from './runtime-box';
import { RelayServer, writeRelayWrappers } from './runtime-relay';
import type { BoxLink } from './boxlink';
import { BOX_TARGETS, E2E_SHELL_TARGET, RELAY_TICKET_ENV, setBoxRuntime, type BoxTarget } from './runtime-state';
import * as orchmcp from '../runtime/orchmcp';
import { agentProxyUrl } from '../runtime/adapter';

/** what the start needs of `BoxManager` (tests fake it) */
export interface BoxStartLike extends BoxExecLike {
  execWait(cmd: readonly string[], o?: ExecOptions): Promise<BoxResult>;
}

export interface StartBoxRuntimesOptions {
  box: BoxStartLike;
  /** the host work dir the box sees at /work */
  workDir: string;
  /** machined's in-memory home (/nm/home): its paths in argv/env map to the box HOME */
  homeDir: string;
  /** where the relay wrappers go (host only, never in the box) */
  stateDir: string;
  /** where `ensureShim` writes the host copy of the bus shim (NM_USERDATA) */
  userDataDir?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  /** test seams */
  bridge?: { ensureBridge(): Promise<number>; ensureBoxBridge(host: string, bearer: string): Promise<number> };
  proxyUrl?: () => string | null;
  /** the address the bus listener binds instead of the veth IP (tests) */
  bindHost?: string;
  /** the box link (boxlink.ts): the box reaches the bus and the proxy through it, on its own loopback */
  link?: Pick<BoxLink, 'expose'> | null;
}

export interface BoxRuntimeHandle {
  hostIp: string;
  relayPort: number;
  /** the bus port on the veth IP, null when it could not bind (the CLIs then run without nm tools) */
  busPort: number | null;
  /** one per target (the e2e shell too when NM_E2E_BOXCLI=1) */
  wrappers: Record<BoxTarget, string> & Record<string, string>;
  bins: Record<BoxTarget, string>;
  /** the loopback → veth port map the spawner rewrites URLs with */
  urls: UrlRewrite;
  /** forward the egress proxy to the box now (each spawn does it on demand) */
  exposeProxy(): Promise<void>;
  close(): Promise<void>;
}

/** the box's shim copy, under the work dir so the box sees it at /work/.nm-box */
export const BOX_SHIM_REL = '.nm-box/nm-orch-mcp-shim.mjs';
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const CLAUDE_OK = 'nm-box-claude-bin:ok';

/** the in-box preparation: pid dir, the host work path aliased to /work, the bundled claude present?,
 *  and the route table (for the veth IP) */
export function boxPrepScript(hostWork: string, claudeBin: string | null): string[] {
  const w = shQuote(hostWork);
  const lines = [
    'mkdir -p /tmp/nm-exec',
    `mkdir -p "$(dirname ${w})"`,
    // an empty dir the image left there gives way to the alias; anything else stays
    `rmdir ${w} 2>/dev/null || true`,
    `[ -e ${w} ] || ln -s ${BOX_WORK} ${w}`,
    ...(claudeBin ? [`[ -x ${shQuote(claudeBin)} ] && echo ${CLAUDE_OK} || true`] : []),
    'cat /proc/net/route 2>/dev/null || true',
    // a restored overlay may still carry the history an older image let bash write (box-terminal.ts
    // TERMINAL_ENV): it goes at every box start, so the next snapshot no longer has it
    `rm -f ${BOX_HOME}/.bash_history`,
  ];
  return ['/bin/sh', '-c', lines.join('; ')];
}

/** agy reads MCP servers from its global config: merge the nm shim into the box's copy */
export function agyBoxConfigCommand(shimBoxPath: string): string[] {
  const script = "const fs=require('fs'),path=require('path');const p=process.argv[1];let c={};try{c=JSON.parse(fs.readFileSync(p,'utf8')||'{}')}catch(e){}c.mcpServers=c.mcpServers||{};c.mcpServers.nm=JSON.parse(process.argv[2]);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(c,null,2))";
  return ['node', '-e', script, `${BOX_HOME}/.gemini/config/mcp_config.json`, JSON.stringify({ command: 'node', args: [shimBoxPath] })];
}

/** The Agent SDK's own native `claude` (the version it speaks to), resolved on the host: the box runs
 *  the same image, so the path is the same in there. null when it cannot be resolved. */
export function bundledClaudeBin(): string | null {
  try {
    const sdk = require.resolve('@anthropic-ai/claude-agent-sdk');
    return createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);
  } catch {
    return null;
  }
}

export async function startBoxRuntimes(o: StartBoxRuntimesOptions): Promise<BoxRuntimeHandle> {
  const env = o.env ?? process.env;
  const log = o.log ?? ((line: string) => console.log(`[box-runtime] ${line}`));
  const bridge = o.bridge ?? orchmcp;
  const proxyUrl = o.proxyUrl ?? agentProxyUrl;
  const closers: Array<() => Promise<void>> = [];

  // 1. the box
  const bundled = env['NM_BOX_BIN_CLAUDE'] ? null : bundledClaudeBin();
  const prep = await o.box.execWait(boxPrepScript(o.workDir, bundled));
  if (prep.code !== 0) throw new Error(`the box did not answer its preparation (exit ${prep.code}): ${prep.stderr.slice(-200)}`);
  const bins: Record<BoxTarget, string> = {
    claude: env['NM_BOX_BIN_CLAUDE'] || (bundled && prep.stdout.includes(CLAUDE_OK) ? bundled : 'claude'),
    codex: env['NM_BOX_BIN_CODEX'] || 'codex',
    agy: env['NM_BOX_BIN_AGY'] || 'agy',
  };
  const fromEnv = env['NM_BOX_HOST_IP']?.trim();
  const gateway = parseDefaultGateway(prep.stdout);
  const link = o.link ?? null;
  // with the link the box names its own loopback, which the link carries to this one
  const hostIp = link ? '127.0.0.1' : fromEnv || gateway || SUPERVISOR_FROM_BOX;
  if (!IPV4.test(hostIp)) throw new Error(`the host veth IP ${hostIp} is not an IPv4 address`);
  log(link ? `box reaches the supervisor through the box link (box 127.0.0.1) · claude=${bins.claude}`
    : `box host IP ${hostIp} (${fromEnv ? 'NM_BOX_HOST_IP' : gateway ? 'the box default gateway' : 'the measured default'}) · claude=${bins.claude}`);

  // 2. the tool bus where the box reaches it, and what the box needs to use it
  const urls = new UrlRewrite(hostIp);
  const bearer = randomBytes(32).toString('hex');
  let busPort: number | null = null;
  try {
    const loop = await bridge.ensureBridge();
    // the bearer stays: anything else on this loopback (or in the box) without it gets 401
    const bound = await bridge.ensureBoxBridge(link ? '127.0.0.1' : (o.bindHost ?? hostIp), bearer);
    busPort = link ? await link.expose('bus', bound) : bound;
    urls.ports.set(loop, busPort);
  } catch (err) {
    log(`the tool bus is not exposed to the box; CLI turns run without nm tools (${err instanceof Error ? err.message : String(err)})`);
  }
  const shimBox = `${BOX_WORK}/${BOX_SHIM_REL}`;
  const shimHost = join(o.userDataDir ?? env['NM_USERDATA'] ?? o.stateDir, 'nm-orch-mcp-shim.mjs');
  if (busPort) {
    orchmcp.writeShimFile(join(o.workDir, BOX_SHIM_REL));
    const agy = await o.box.execWait(agyBoxConfigCommand(shimBox));
    if (agy.code !== 0) log(`agy's MCP config in the box was not written (exit ${agy.code}); agy turns run without nm tools`);
  }
  const paths = new PathMap([
    { host: o.workDir, box: BOX_WORK, reverse: true },
    { host: shimHost, box: shimBox, file: true },
    { host: o.homeDir, box: BOX_HOME },
  ]);

  // the egress proxy binds loopback and starts with the agent host, after this: forward it on first use
  const forwarding = new Map<number, Promise<void>>();
  const beforeSpawn = async (): Promise<void> => {
    const url = proxyUrl();
    if (!url) return;
    let port = 0;
    try { port = Number(new URL(url).port); } catch { return; }
    if (!port || urls.ports.has(port)) return;
    if (!forwarding.has(port)) {
      const opened = link
        ? link.expose(`proxy-${port}`, port).then((boxPort) => ({ port: boxPort, close: async () => {} }))
        : forwardTcp(o.bindHost ?? hostIp, port);
      forwarding.set(port, opened
        .then((f) => { urls.ports.set(port, f.port); closers.push(f.close); log(`egress proxy :${port} reachable from the box at ${hostIp}:${f.port}${link ? ' (box link)' : ''}`); })
        .catch((err: unknown) => { forwarding.delete(port); log(`the egress proxy is not reachable from the box; agents there run un-proxied (${err instanceof Error ? err.message : String(err)})`); }));
    }
    await forwarding.get(port);
  };

  // 3. the relay and its wrappers
  // NM_E2E_BOXCLI=1 adds one more target, a plain shell, for the e2e witness (e2e-boxcli.ts) only
  const e2e = env['NM_E2E_BOXCLI'] === '1';
  const extra = e2e ? [E2E_SHELL_TARGET] : [];
  const spawner = new BoxRuntimeSpawner({ box: o.box, paths, urls, bearer: busPort ? bearer : null, bins: { ...bins, ...(e2e ? { [E2E_SHELL_TARGET]: '/bin/sh' } : {}) }, beforeSpawn, log });
  const relay = new RelayServer({ spawner, log, targets: [...BOX_TARGETS, ...extra] });
  const relayPort = await relay.listen('127.0.0.1');
  closers.push(() => relay.close());
  const wrappers = await (async (): Promise<Record<BoxTarget, string> & Record<string, string>> => {
    try {
      return writeRelayWrappers(join(o.stateDir, 'box-bin'), relayPort, process.execPath, extra);
    } catch (err) {
      await Promise.all(closers.map((c) => c().catch(() => {})));
      throw err;
    }
  })();

  // 4. from here every SDK spawn goes through the box
  setBoxRuntime({
    wrapper: (t) => wrappers[t],
    relayEnv: () => ({ [RELAY_TICKET_ENV]: relay.mintTicket() }),
    bearer: busPort ? bearer : null,
    e2eShell: e2e ? wrappers[E2E_SHELL_TARGET] ?? null : null,
  });
  log(`agent runtimes run in the box: relay 127.0.0.1:${relayPort}, wrappers in ${dirname(wrappers.claude)}, tool bus ${busPort ? `${hostIp}:${busPort}` : 'off'}`);
  return {
    hostIp,
    relayPort,
    busPort,
    wrappers,
    bins,
    urls,
    exposeProxy: beforeSpawn,
    close: async () => {
      setBoxRuntime(null);
      await Promise.all(closers.map((c) => c().catch(() => {})));
    },
  };
}
