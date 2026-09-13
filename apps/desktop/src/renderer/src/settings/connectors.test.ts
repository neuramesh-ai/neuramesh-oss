// The one derivation of "connected" behind the Connections list and the composer foot.
// Run from apps/desktop: pnpm exec tsx --test src/renderer/src/settings/connectors.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTORS, FOOT_MARKS, connectorStates, mcpFlagsOf } from './connectors';

const row = (provider: string, status: string, handle = '@acme') => ({ id: `${provider}-${status}`, provider, handle, status });
const empty = { conns: [], presence: {}, mcp: {}, creds: [] };
const stateOf = (id: string, input: Partial<Parameters<typeof connectorStates>[0]> = {}) =>
  connectorStates({ ...empty, ...input }).find((s) => s.id === id)!;

test('nothing connected: every connector is a Connect, none carries a handle', () => {
  for (const s of connectorStates(empty)) { assert.equal(s.connected, false); assert.equal(s.handle, null); assert.equal(s.dead, null); }
});

test('a connected OAuth row connects its provider and names the account', () => {
  const s = stateOf('x', { conns: [row('x', 'connected', '@_neuramesh')] });
  assert.equal(s.connected, true);
  assert.equal(s.handle, '@_neuramesh');
  assert.equal(s.conn?.id, 'x-connected');
  assert.equal(stateOf('linkedin', { conns: [row('x', 'connected')] }).connected, false, 'one provider never connects another');
});

test('a dead grant that names an account is dead, not connected — and a live row wins over it', () => {
  const dead = stateOf('linkedin', { conns: [row('linkedin', 'reauth_required', '@george')] });
  assert.equal(dead.connected, false);
  assert.equal(dead.dead?.handle, '@george');
  assert.equal(stateOf('linkedin', { conns: [row('linkedin', 'revoked', '')] }).dead, null, 'a handle-less dead row is a plain Connect');
  const both = stateOf('x', { conns: [row('x', 'connected', '@live'), row('x', 'reauth_required', '@old')] });
  assert.equal(both.connected, true);
  assert.equal(both.dead, null);
});

test('a key connector needs the machine key AND the room flag', () => {
  assert.equal(stateOf('posthog', { presence: { posthog: true } }).connected, false);
  assert.equal(stateOf('posthog', { mcp: { posthog: true } }).connected, false);
  assert.equal(stateOf('posthog', { presence: { posthog: true }, mcp: { posthog: true } }).connected, true);
  // TikTok Ads reads the `tiktok` key, a different row from the TikTok publish connector
  assert.equal(stateOf('tiktokads', { presence: { tiktok: true }, mcp: { tiktok: true } }).connected, true);
  assert.equal(stateOf('tiktok', { presence: { tiktok: true }, mcp: { tiktok: true } }).connected, false);
});

test('the image model is an apikey credential, the dedicated one first, and its handle says which', () => {
  const cred = (provider: string, authMode: 'apikey' | 'subscription', last4: string | null) => ({ provider, scope: 'workspace', agentId: null, authMode, last4, updatedAt: '' });
  assert.equal(stateOf('images', { creds: [cred('openai', 'subscription', null)] }).connected, false);
  assert.equal(stateOf('images', { creds: [cred('gemini', 'apikey', 'a1b2')] }).handle, 'gemini ····a1b2');
  assert.equal(stateOf('images', { creds: [cred('gemini', 'apikey', 'a1b2'), cred('openai-image', 'apikey', '4f2a')] }).handle, 'openai ····4f2a');
});

test('the foot draws a fixed subset of the registry, in registry order', () => {
  const ids = CONNECTORS.map((c) => c.id);
  assert.deepEqual(FOOT_MARKS.map((id) => ids.indexOf(id)), [0, 1, 2, 3]);
  assert.equal(new Set(ids).size, ids.length);
});

test('mcpFlagsOf reads the room profile and survives junk', () => {
  assert.deepEqual(mcpFlagsOf(JSON.stringify({ mcp: { posthog: true } })), { posthog: true });
  assert.deepEqual(mcpFlagsOf(null), {});
  assert.deepEqual(mcpFlagsOf('{not json'), {});
});
