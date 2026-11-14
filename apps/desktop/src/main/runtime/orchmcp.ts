// Daemon-side bridge that lets Google's Antigravity `agy` CLI drive the orchestrator's in-process
// tools over MCP. agy spawns an MCP server as a SEPARATE process, so it can't see our
// buildOrchestratorTools(ctx) closures directly. Instead the daemon exposes them on a loopback
// (127.0.0.1) HTTP endpoint guarded by a per-turn secret; a tiny stdio MCP shim — installed once in
// agy's global mcp_config, and INERT outside an orchestrator turn — proxies tools/list + tools/call
// to it. Per-turn context + the secret ride in the env we set when spawning agy, which agy passes
// down to the shim. Nothing leaves the machine (loopback only); the secret stops other local procs
// from invoking orchestrator tools.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { BOX_BEARER_ENV, boxRuntime } from '../cloudrun/runtime-state';

export interface BridgeTool { name: string; description: string; inputSchema: unknown; run: (input: unknown) => Promise<string> }

interface TurnReg { secret: string; tools: Map<string, BridgeTool> }
const turns = new Map<string, TurnReg>();
let server: Server | null = null;
let port = 0;
// A Cloud Run machine's agent box cannot reach 127.0.0.1 (cloudrun/README.md), so the same handler also
// listens on the host's veth IP — never 0.0.0.0 — and there it demands the per-box bearer as well as the
// per-turn secret. The loopback listener stays for host-side callers.
let boxServer: Server | null = null;
let boxPort = 0;

function handle(req: IncomingMessage, res: ServerResponse): void {
  const u = new URL(req.url ?? '/', 'http://127.0.0.1');
  const reg = turns.get(u.searchParams.get('turn') ?? '');
  if (!reg || reg.secret !== u.searchParams.get('secret')) { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"forbidden"}'); return; }
  if (u.pathname === '/tools' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tools: [...reg.tools.values()].map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }));
    return;
  }
  if (u.pathname === '/call' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += String(d); if (body.length > 2_000_000) req.destroy(); });
    req.on('end', () => { void (async () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.flushHeaders();
      // A human may take minutes to decide. JSON whitespace keeps the transport alive (loopback, or the
      // box bridge over the veth or the box link) while the handler waits for that exact decision.
      const heartbeat = setInterval(() => res.write(' '), 15000);
      res.once('close', () => clearInterval(heartbeat));
      let result: string;
      try {
        const { name, args } = JSON.parse(body || '{}') as { name?: string; args?: unknown };
        const t = name ? reg.tools.get(name) : undefined;
        result = t ? await t.run(objectArgs(args)) : `error: unknown tool ${name}`;
      } catch (e) { result = `error: ${e instanceof Error ? e.message : 'tool failed'}`; }
      clearInterval(heartbeat);
      if (!res.destroyed) res.end(JSON.stringify({ result }));
    })(); });
    return;
  }
  res.writeHead(404); res.end('{}');
}

/** `authorization: Bearer <bearer>`, compared in constant time */
export function bearerOk(header: string | undefined, bearer: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? '');
  if (!m || !bearer) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(bearer);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Lazy-start the loopback bridge once; returns its port.
export async function ensureBridge(): Promise<number> {
  if (server && port) return port;
  await new Promise<void>((resolve, reject) => {
    const s = createServer(handle);
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { server = s; port = (s.address() as { port: number }).port; resolve(); });
  });
  return port;
}

/** The bridge on the host veth IP for the agent box (one per process; the box starts once). Every
 *  request there must carry the per-box bearer, which reaches the box only through secretEnv. */
export async function ensureBoxBridge(host: string, bearer: string): Promise<number> {
  if (boxServer && boxPort) return boxPort;
  if (!bearer) throw new Error('The box bridge needs a bearer.');
  if (host === '0.0.0.0' || host === '::') throw new Error('The box bridge binds the veth IP, never every interface.');
  await new Promise<void>((resolve, reject) => {
    const s = createServer((req, res) => {
      if (!bearerOk(req.headers['authorization'], bearer)) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthorized"}'); return; }
      handle(req, res);
    });
    s.on('error', reject);
    s.listen(0, host, () => { boxServer = s; boxPort = (s.address() as { port: number }).port; resolve(); });
  });
  return boxPort;
}

/** The box bridge's port, or 0 when it is not listening. */
export function boxBridgePort(): number { return boxPort; }

/** agy's call_mcp_tool forwards a model's Arguments as it was written, and Gemini sometimes writes a JSON
 *  string (seen live 2026-10-16). every tool here takes an object */
export function objectArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args ?? {};
  try {
    const parsed: unknown = JSON.parse(args);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : args;
  } catch { return args; }
}

export function registerTurn(turnId: string, secret: string, tools: BridgeTool[]): void {
  turns.set(turnId, { secret, tools: new Map(tools.map((t) => [t.name, t])) });
}
export function unregisterTurn(turnId: string): void { turns.delete(turnId); }

// Close the listener and drop every registration. The daemon does not need this — its bridge lives as
// long as the process — but a TEST does: an open server handle keeps the event loop alive, so a suite
// that starts the bridge can never exit. Idempotent, so app shutdown may also call it.
export async function closeBridge(): Promise<void> {
  turns.clear();
  const s = server;
  const b = boxServer;
  server = null;
  port = 0;
  boxServer = null;
  boxPort = 0;
  await Promise.all([s, b].filter((x): x is Server => !!x).map((x) => new Promise<void>((resolve) => x.close(() => resolve()))));
}

/** The live port, or 0 when the bridge is not listening — lets a caller assert without starting it. */
export function bridgePort(): number { return port; }

/**
 * The codex `mcp_servers.nm` entry — ONE builder for the two codex spawn sites (the
 * orchestrator turn and the worker bus), because they drifted once and it cost a round:
 * orchturn carried `default_tools_approval_mode: 'approve'` and turntools did not, so every
 * codex-seated WORKER had its whole nm bus cancelled ("user cancelled MCP tool call",
 * openai/codex#16685/#24135 — headless, the per-call approval prompt reads EOF as a
 * rejection) while rex's tools worked one file over. The key pre-approves only OUR bus (the
 * per-turn secret is the boundary); codex's own sandbox stays on.
 *
 * On a Cloud Run machine codex runs in the agent box, where the shim must also present the per-box
 * bearer: it rides this env too (the relay stages the whole config word as a file, so neither it nor
 * the turn secret reaches a logged command line), and the relay rewrites the URL to the veth IP.
 */
export function codexNmServer(command: string, shimPath: string, env: { NM_ORCH_URL: string; NM_ORCH_TURN: string; NM_ORCH_SECRET: string }): Record<string, unknown> {
  const bearer = boxRuntime()?.bearer;
  return { command, args: [shimPath], default_tools_approval_mode: 'approve', tool_timeout_sec: 660, env: bearer ? { ...env, [BOX_BEARER_ENV]: bearer } : env };
}

// The stdio MCP shim agy spawns. Written to userData for a stable path. Uses string concatenation
// (no template literals) so it embeds cleanly here. Inert (zero tools) when NM_ORCH_* is unset, so
// the user's own interactive `agy` sessions never see the orchestrator tools.
const SHIM_SOURCE = [
  "import { createInterface } from 'node:readline';",
  "const URL_ = process.env.NM_ORCH_URL, TURN = process.env.NM_ORCH_TURN, SECRET = process.env.NM_ORCH_SECRET || '';",
  "const BEARER = process.env.NM_BOX_BEARER || '';",
  "const H = BEARER ? { authorization: 'Bearer ' + BEARER } : {};",
  "const rl = createInterface({ input: process.stdin });",
  "const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');",
  "const active = () => !!(URL_ && TURN);",
  "const q = (s) => encodeURIComponent(s);",
  "async function loadTools() {",
  "  if (!active()) return [];",
  "  try { const r = await fetch(URL_ + '/tools?turn=' + q(TURN) + '&secret=' + q(SECRET), { headers: H }); if (!r.ok) return []; return (await r.json()).tools || []; } catch { return []; }",
  "}",
  "async function callTool(name, args) {",
  "  if (!active()) return 'error: orchestrator bridge not active';",
  "  try {",
  "    const r = await fetch(URL_ + '/call?turn=' + q(TURN) + '&secret=' + q(SECRET), { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, H), body: JSON.stringify({ name: name, args: args }) });",
  "    const j = await r.json(); return r.ok ? String(j.result || '') : ('error: ' + (j.error || r.status));",
  "  } catch (e) { return 'error: bridge unreachable'; }",
  "}",
  "rl.on('line', async (line) => {",
  "  const s = line.trim(); if (!s) return;",
  "  let req; try { req = JSON.parse(s); } catch { return; }",
  "  if (req.method === 'initialize') send({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: (req.params && req.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'nm', version: '1.0.0' } } });",
  "  else if (req.method === 'tools/list') send({ jsonrpc: '2.0', id: req.id, result: { tools: await loadTools() } });",
  "  else if (req.method === 'tools/call') { const text = await callTool(req.params && req.params.name, (req.params && req.params.arguments) || {}); send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: text }] } }); }",
  "  else if (req.id != null) send({ jsonrpc: '2.0', id: req.id, result: {} });",
  "});",
  '',
].join('\n');

export function ensureShim(userDataDir: string): string {
  const p = join(userDataDir, 'nm-orch-mcp-shim.mjs');
  writeFileSync(p, SHIM_SOURCE);
  return p;
}

/** The same shim at a path of the caller's choosing: the agent box's copy under the work dir. */
export function writeShimFile(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, SHIM_SOURCE);
  return path;
}

/** agy's MCP config with the nm shim merged in (the box writes its own copy, cloudrun/runtime-start.ts) */
export function agyMcpConfigJson(existing: string, shimPath: string, nodeBin = 'node'): string {
  let cfg: { mcpServers?: Record<string, unknown> } = {};
  try { cfg = JSON.parse(existing || '{}') as typeof cfg; } catch { /* empty/new file */ }
  cfg.mcpServers = cfg.mcpServers ?? {};
  cfg.mcpServers['nm'] = { command: nodeBin, args: [shimPath] };
  return JSON.stringify(cfg, null, 2);
}

// Idempotently register the nm shim in agy's global MCP config — MERGE, never clobber other servers.
export function ensureAgyMcpConfig(shimPath: string, nodeBin = 'node'): void {
  const cfgPath = join(homedir(), '.gemini', 'config', 'mcp_config.json');
  let existing = '';
  try { existing = readFileSync(cfgPath, 'utf8'); } catch { /* empty/new file */ }
  mkdirSync(dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, agyMcpConfigJson(existing, shimPath, nodeBin));
  ensureAgyMcpAllow();
}

/** the rule that lets headless agy call the nm tools. agy 1.4.0 refuses an MCP call it cannot prompt for
 *  ("a tool required the mcp permission that headless mode cannot prompt for") unless its own settings
 *  allow it, which took rex's board tools and the coding lane's shell away (verified 2026-10-16, docs/design/
 *  gemini-code-lane-2026-10). merged, and a file that does not parse is left alone. nm offers no tool outside
 *  a NeuraMesh turn, so the person's own agy sessions gain nothing from it */
export const NM_MCP_ALLOW = 'mcp(nm/*)';
export function ensureAgyMcpAllow(home = homedir()): boolean {
  const path = join(home, '.gemini', 'antigravity-cli', 'settings.json');
  let raw = '';
  try { raw = readFileSync(path, 'utf8'); } catch { /* no settings yet */ }
  let cfg: Record<string, unknown>;
  try {
    const parsed: unknown = raw.trim() ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    cfg = parsed as Record<string, unknown>;
  } catch { return false; }
  const current = cfg['permissions'];
  const permissions = current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : {};
  const allow: unknown[] = Array.isArray(permissions['allow']) ? permissions['allow'] : [];
  if (allow.includes(NM_MCP_ALLOW)) return true;
  cfg['permissions'] = { ...permissions, allow: [...allow, NM_MCP_ALLOW] };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  return true;
}

/** A managed turn can reach only the host's registered tools. In particular
 * a saved CLI Turbo preference must never grant a second path to shell or files. */
export function managedAgySettings(home = homedir()): string {
  const path = join(home, '.gemini', 'config', 'mcp_config.json');
  let servers: Record<string, unknown> = {};
  if (existsSync(path)) servers = JSON.parse(readFileSync(path, 'utf8')).mcpServers ?? {};
  const external = Object.keys(servers).filter(name => name !== 'nm');
  if (external.some(name => !/^[\w.-]+$/.test(name))) throw new Error('Cannot isolate an unrecognized MCP server name.');
  return JSON.stringify({ allowNonWorkspaceAccess: false, permissions: {
    allow: [NM_MCP_ALLOW], deny: ['read_file(*)', 'write_file(*)', 'command(*)', 'unsandboxed(*)',
      'read_url(*)', 'execute_url(*)', ...external.map(name => `mcp(${name}/*)`)],
  } });
}
