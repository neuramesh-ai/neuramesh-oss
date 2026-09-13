// Daemon-side bridge that lets Google's Antigravity `agy` CLI drive the orchestrator's in-process
// tools over MCP. agy spawns an MCP server as a SEPARATE process, so it can't see our
// buildOrchestratorTools(ctx) closures directly. Instead the daemon exposes them on a loopback
// (127.0.0.1) HTTP endpoint guarded by a per-turn secret; a tiny stdio MCP shim — installed once in
// agy's global mcp_config, and INERT outside an orchestrator turn — proxies tools/list + tools/call
// to it. Per-turn context + the secret ride in the env we set when spawning agy, which agy passes
// down to the shim. Nothing leaves the machine (loopback only); the secret stops other local procs
// from invoking orchestrator tools.
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface BridgeTool { name: string; description: string; inputSchema: unknown; run: (input: unknown) => Promise<string> }

interface TurnReg { secret: string; tools: Map<string, BridgeTool> }
const turns = new Map<string, TurnReg>();
let server: Server | null = null;
let port = 0;

// Lazy-start the loopback bridge once; returns its port.
export async function ensureBridge(): Promise<number> {
  if (server && port) return port;
  await new Promise<void>((resolve, reject) => {
    const s = createServer((req, res) => {
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
          let result: string;
          try {
            const { name, args } = JSON.parse(body || '{}') as { name?: string; args?: unknown };
            const t = name ? reg.tools.get(name) : undefined;
            result = t ? await t.run(args ?? {}) : `error: unknown tool ${name}`;
          } catch (e) { result = `error: ${e instanceof Error ? e.message : 'tool failed'}`; }
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ result }));
        })(); });
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { server = s; port = (s.address() as { port: number }).port; resolve(); });
  });
  return port;
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
  server = null;
  port = 0;
  if (!s) return;
  await new Promise<void>((resolve) => s.close(() => resolve()));
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
 */
export function codexNmServer(command: string, shimPath: string, env: { NM_ORCH_URL: string; NM_ORCH_TURN: string; NM_ORCH_SECRET: string }): Record<string, unknown> {
  return { command, args: [shimPath], default_tools_approval_mode: 'approve', env };
}

// The stdio MCP shim agy spawns. Written to userData for a stable path. Uses string concatenation
// (no template literals) so it embeds cleanly here. Inert (zero tools) when NM_ORCH_* is unset, so
// the user's own interactive `agy` sessions never see the orchestrator tools.
const SHIM_SOURCE = [
  "import { createInterface } from 'node:readline';",
  "const URL_ = process.env.NM_ORCH_URL, TURN = process.env.NM_ORCH_TURN, SECRET = process.env.NM_ORCH_SECRET || '';",
  "const rl = createInterface({ input: process.stdin });",
  "const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');",
  "const active = () => !!(URL_ && TURN);",
  "const q = (s) => encodeURIComponent(s);",
  "async function loadTools() {",
  "  if (!active()) return [];",
  "  try { const r = await fetch(URL_ + '/tools?turn=' + q(TURN) + '&secret=' + q(SECRET)); if (!r.ok) return []; return (await r.json()).tools || []; } catch { return []; }",
  "}",
  "async function callTool(name, args) {",
  "  if (!active()) return 'error: orchestrator bridge not active';",
  "  try {",
  "    const r = await fetch(URL_ + '/call?turn=' + q(TURN) + '&secret=' + q(SECRET), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name, args: args }) });",
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

// Idempotently register the nm shim in agy's global MCP config — MERGE, never clobber other servers.
export function ensureAgyMcpConfig(shimPath: string, nodeBin = 'node'): void {
  const cfgPath = join(homedir(), '.gemini', 'config', 'mcp_config.json');
  let cfg: { mcpServers?: Record<string, unknown> } = {};
  try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8') || '{}') as typeof cfg; } catch { /* empty/new file */ }
  cfg.mcpServers = cfg.mcpServers ?? {};
  cfg.mcpServers['nm'] = { command: nodeBin, args: [shimPath] };
  mkdirSync(dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}
