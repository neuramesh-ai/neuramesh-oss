// Marketing MCP attach (integrations-and-skills-plan.md P1/P2): the room's synced toggles
// (channels.marketing.mcp) pick WHICH official servers a marketer research run gets; the
// credentials are MACHINE-LOCAL (userData/mcp-keys.json, set from room settings, never
// synced, never sent to our server) — BYOS extended to marketing. Read paths only by
// credential scope: PostHog personal API key, Meta's connector token as the user scoped it.
// Publishing custody stays on the sealed-connector approve-gate — these servers never replace
// it, and reading X is NOT here: that rides the X connector itself (see the URL note below).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface McpKeys {
  posthog?: string;
  meta?: string;
  /** Meta's connector endpoint is in beta and account-scoped — the user pastes the URL
   * their Ads console shows beside the token; empty = meta stays detached even if toggled */
  metaUrl?: string;
  /** TikTok's official Ads MCP is account-scoped the same way — URL + token from its console */
  tiktok?: string;
  tiktokUrl?: string;
}

export interface McpToggles { posthog?: boolean; meta?: boolean; tiktok?: boolean }

// documented hosted endpoint (July 2026): PostHog's official server.
// X's XMCP is GONE from here (2026-08-09): reading X rides the room's X CONNECTOR, server-side
// (control-api /v1/x/search). The XMCP path needed each user to own an X developer app and paste
// its bearer — true of a developer, false of a customer — and having BOTH meant two "X" rows in
// Connections for one capability, which is exactly how it read.
export const POSTHOG_MCP_URL = 'https://mcp.posthog.com/mcp';

/** Probe an MCP endpoint with a JSON-RPC `initialize` — the same first request a research
 * run makes, so ✓ means the credential actually works (round 12: verify before save).
 * fetchImpl is injectable for tests. */
export async function verifyMcpEndpoint(url: string, token: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'neuramesh', version: '1.0' } } }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, detail: 'credential rejected' };
    if (!res.ok) return { ok: false, detail: `endpoint answered ${res.status}` };
    return { ok: true, detail: 'connected' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'unreachable' };
  }
}

const keysPath = (userData: string) => join(userData, 'mcp-keys.json');

export function readMcpKeys(userData: string): McpKeys {
  try {
    if (!existsSync(keysPath(userData))) return {};
    return JSON.parse(readFileSync(keysPath(userData), 'utf8')) as McpKeys;
  } catch {
    return {};
  }
}

export function writeMcpKey(userData: string, provider: keyof McpKeys, value: string): McpKeys {
  const cur = readMcpKeys(userData);
  const next = { ...cur, [provider]: value.trim() || undefined };
  mkdirSync(dirname(keysPath(userData)), { recursive: true });
  writeFileSync(keysPath(userData), JSON.stringify(next, null, 2));
  return next;
}

/** Which providers have a usable local credential (for the UI's ✓ badges). Instagram
 * publishing rides Meta's connector, so its presence mirrors meta's. */
export function mcpKeyPresence(keys: McpKeys): Record<'posthog' | 'meta' | 'instagram' | 'tiktok', boolean> {
  const meta = !!keys.meta && !!keys.metaUrl;
  return { posthog: !!keys.posthog, meta, instagram: meta, tiktok: !!keys.tiktok && !!keys.tiktokUrl };
}

/** The Agent-SDK `mcpServers` map for one marketer research run — only toggled-on
 * providers whose local key exists attach; an empty map means "run without MCP". */
export function mcpServersFor(toggles: McpToggles | undefined, keys: McpKeys): Record<string, { type: 'http'; url: string; headers: Record<string, string> }> {
  const out: Record<string, { type: 'http'; url: string; headers: Record<string, string> }> = {};
  if (toggles?.posthog && keys.posthog) {
    out['posthog'] = { type: 'http', url: POSTHOG_MCP_URL, headers: { Authorization: `Bearer ${keys.posthog}` } };
  }
  if (toggles?.meta && keys.meta && keys.metaUrl) {
    out['meta'] = { type: 'http', url: keys.metaUrl, headers: { Authorization: `Bearer ${keys.meta}` } };
  }
  if (toggles?.tiktok && keys.tiktok && keys.tiktokUrl) {
    out['tiktok'] = { type: 'http', url: keys.tiktokUrl, headers: { Authorization: `Bearer ${keys.tiktok}` } };
  }
  return out;
}
