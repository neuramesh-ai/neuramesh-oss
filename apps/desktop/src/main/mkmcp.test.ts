import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpServersFor, mcpKeyPresence, readMcpKeys, writeMcpKey, verifyMcpEndpoint } from './mkmcp';

test('verify: 200 → ok; 401 → credential rejected; network error → unreachable', async () => {
  const mk = (status: number) => (async () => ({ ok: status < 400, status })) as unknown as typeof fetch;
  assert.deepEqual(await verifyMcpEndpoint('https://u', 't', mk(200)), { ok: true, detail: 'connected' });
  assert.deepEqual(await verifyMcpEndpoint('https://u', 't', mk(401)), { ok: false, detail: 'credential rejected' });
  assert.deepEqual(await verifyMcpEndpoint('https://u', 't', mk(503)), { ok: false, detail: 'endpoint answered 503' });
  const boom = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
  assert.deepEqual(await verifyMcpEndpoint('https://u', 't', boom), { ok: false, detail: 'unreachable' });
});

test('no toggles or no keys → empty map (the run proceeds without MCP)', () => {
  assert.deepEqual(mcpServersFor(undefined, {}), {});
  assert.deepEqual(mcpServersFor({ posthog: true }, {}), {});
  assert.deepEqual(mcpServersFor({}, { posthog: 'k' }), {});
});

test('a toggled provider with a local key attaches its hosted server', () => {
  const m = mcpServersFor({ posthog: true }, { posthog: 'phx_123' });
  assert.equal(m['posthog']!.url, 'https://mcp.posthog.com/mcp');
  assert.equal(m['posthog']!.headers['Authorization'], 'Bearer phx_123');
  assert.equal(m['x'], undefined);
});

test('meta needs BOTH token and url; X is not an MCP provider here at all', () => {
  const m = mcpServersFor({ meta: true }, { meta: 'tok' });
  assert.equal(m['meta'], undefined); // no metaUrl → detached even though toggled
  const withUrl = mcpServersFor({ meta: true }, { meta: 'tok', metaUrl: 'https://example.test/ads-mcp' });
  assert.equal(withUrl['meta']!.url, 'https://example.test/ads-mcp');
  // reading X rides the room's X CONNECTOR (control-api /v1/x/search), never a local bearer —
  // two X credentials for one capability is what this removal ended (2026-08-09)
  assert.equal(Object.keys(mcpServersFor({ posthog: true } as never, { posthog: 'k' })).includes('x'), false);
});

test('presence mirrors the attach rules (meta/tiktok need token + url; instagram rides meta)', () => {
  assert.deepEqual(mcpKeyPresence({}), { posthog: false, meta: false, instagram: false, tiktok: false });
  assert.deepEqual(mcpKeyPresence({ posthog: 'k', meta: 'tok' }), { posthog: true, meta: false, instagram: false, tiktok: false });
  assert.deepEqual(mcpKeyPresence({ meta: 'tok', metaUrl: 'https://u' }), { posthog: false, meta: true, instagram: true, tiktok: false });
  assert.deepEqual(mcpKeyPresence({ tiktok: 'tok', tiktokUrl: 'https://t' }).tiktok, true);
});

test('tiktok attaches like meta — account-scoped url + bearer', () => {
  assert.deepEqual(mcpServersFor({ tiktok: true }, { tiktok: 'tok' }), {});
  const m = mcpServersFor({ tiktok: true }, { tiktok: 'tok', tiktokUrl: 'https://ads.tiktok.example/mcp' });
  assert.equal(m['tiktok']!.url, 'https://ads.tiktok.example/mcp');
  assert.equal(m['tiktok']!.headers['Authorization'], 'Bearer tok');
});

test('keys round-trip on disk; empty value clears', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mkmcp-'));
  assert.deepEqual(readMcpKeys(dir), {});
  writeMcpKey(dir, 'posthog', 'phx_9');
  assert.equal(readMcpKeys(dir).posthog, 'phx_9');
  writeMcpKey(dir, 'posthog', '  ');
  assert.equal(readMcpKeys(dir).posthog, undefined);
});
