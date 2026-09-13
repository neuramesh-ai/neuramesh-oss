// the shared uploader's contract: table coverage identical for desktop and machined,
// per-table error policy preserved exactly, unknown tables left to the caller.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CrudEntry } from '@powersync/node';
import { uploadCrudEntry, type UploadIdentity } from './upload';

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> };

function harness(status = 200, bodyText = '{}') {
  const calls: Call[] = [];
  const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    return new Response(bodyText, { status });
  }) as typeof fetch;
  const ident: UploadIdentity = {
    apiUrl: 'https://api.test',
    workspaceFallback: 'ws-fallback',
    defaultActor: { kind: 'human', id: 'u-1' },
    fetchImpl,
  };
  return { ident, calls };
}

const op = (table: string, kind: string, opData: Record<string, unknown>): CrudEntry =>
  ({ table, op: kind, id: 'row-1', opData }) as unknown as CrudEntry;

test('messages PUT posts with row authorship and the caller fallbacks', async () => {
  const { ident, calls } = harness();
  const outcome = await uploadCrudEntry(ident, op('messages', 'PUT', { channel_id: 'c1', body: 'hi', author_kind: 'agent', author_id: 'a-9' }));
  assert.equal(outcome, 'uploaded');
  assert.equal(calls[0]!.url, 'https://api.test/v1/messages');
  assert.deepEqual(JSON.parse(calls[0]!.headers['x-nm-actor']!), { kind: 'agent', id: 'a-9' });
  assert.equal(calls[0]!.body['workspace'], 'ws-fallback');
});

test('machine identity rides the bearer + default actor on every call', async () => {
  const { ident, calls } = harness();
  ident.authHeaders = { authorization: 'Bearer nmm_x' };
  ident.defaultActor = { kind: 'agent', id: 'owner-1' };
  await uploadCrudEntry(ident, op('messages', 'PUT', { channel_id: 'c1', body: 'hi' }));
  assert.equal(calls[0]!.headers['authorization'], 'Bearer nmm_x');
  assert.deepEqual(JSON.parse(calls[0]!.headers['x-nm-actor']!), { kind: 'agent', id: 'owner-1' });
});

test('messages non-409 failure throws (PowerSync must retry); 409 is converged', async () => {
  const bad = harness(500, 'boom');
  await assert.rejects(() => uploadCrudEntry(bad.ident, op('messages', 'PUT', { channel_id: 'c1' })), /upload failed 500/);
  const dupe = harness(409);
  assert.equal(await uploadCrudEntry(dupe.ident, op('messages', 'PUT', { channel_id: 'c1' })), 'uploaded');
});

test('artifacts PUT uploads attachments; rows without message_id are skipped', async () => {
  const { ident, calls } = harness();
  assert.equal(await uploadCrudEntry(ident, op('artifacts', 'PUT', { name: 'x.png' })), 'skipped');
  assert.equal(calls.length, 0);
  assert.equal(await uploadCrudEntry(ident, op('artifacts', 'PUT', { message_id: 'm1', name: 'x.png' })), 'uploaded');
  assert.equal(calls[0]!.url, 'https://api.test/v1/artifacts');
  assert.equal(calls[0]!.body['messageId'], 'm1');
});

test('whiteboards keep the LWW policy: 4xx logs + skips, 5xx throws, patch-without-rev drops', async () => {
  const conflict = harness(422, 'cap exceeded');
  assert.equal(await uploadCrudEntry(conflict.ident, op('whiteboards', 'PUT', { channel_id: 'c1', rev: 1 })), 'skipped');
  const down = harness(503, 'nope');
  await assert.rejects(() => uploadCrudEntry(down.ident, op('whiteboards', 'PUT', { channel_id: 'c1', rev: 1 })), /upload failed 503/);
  const noRev = harness();
  assert.equal(await uploadCrudEntry(noRev.ident, op('whiteboards', 'PATCH', { title: 't' })), 'skipped');
  assert.equal(noRev.calls.length, 0);
  const patch = harness();
  assert.equal(await uploadCrudEntry(patch.ident, op('whiteboards', 'PATCH', { rev: 3, archived_at: null })), 'uploaded');
  assert.equal(patch.calls[0]!.method, 'PATCH');
  assert.equal(patch.calls[0]!.url, 'https://api.test/v1/whiteboards/row-1');
  assert.equal('archivedAt' in patch.calls[0]!.body, true);
});

test('unknown tables are unhandled — the caller owns the policy', async () => {
  const { ident, calls } = harness();
  assert.equal(await uploadCrudEntry(ident, op('runs', 'PUT', {})), 'unhandled');
  assert.equal(await uploadCrudEntry(ident, op('messages', 'DELETE', {})), 'unhandled');
  assert.equal(calls.length, 0);
});

// The hosted write gate (control-api hosted-gate.ts): a `free` hosted workspace answers the upload
// lanes with 409 PLAN_LIMIT, the ONE status this uploader drops instead of retrying. A 402 (the
// commands lane's shape) would throw here, and a throw holds every download behind it.
test('the hosted write gate: 409 PLAN_LIMIT is dropped on every lane, a 402 is retried', async () => {
  const gated = () => harness(409, JSON.stringify({ error: 'This workspace needs Pro. Your threads stay readable. Get Pro to write again.', code: 'PLAN_LIMIT' }));
  assert.equal(await uploadCrudEntry(gated().ident, op('messages', 'PUT', { channel_id: 'c1', body: 'typed into a gated room' })), 'uploaded');
  assert.equal(await uploadCrudEntry(gated().ident, op('artifacts', 'PUT', { message_id: 'm1', name: 'x.png' })), 'uploaded');
  assert.equal(await uploadCrudEntry(gated().ident, op('whiteboards', 'PUT', { channel_id: 'c1', rev: 1 })), 'uploaded');
  assert.equal(await uploadCrudEntry(gated().ident, op('whiteboards', 'PATCH', { rev: 2, title: 't' })), 'uploaded');
  const paywall = harness(402, JSON.stringify({ code: 'PLAN_LIMIT' }));
  await assert.rejects(() => uploadCrudEntry(paywall.ident, op('messages', 'PUT', { channel_id: 'c1' })), /upload failed 402/);
});
