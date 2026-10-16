import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { BrainCommitRequest, BrainThreadSnapshot } from '@neuramesh/shared';
import { bindConversationCallback, ConversationBrain, conversationContext, portableBrainValue, withConversationBrain } from './brain-sync';
import { recordRuntimeEvent } from '../runtime/brain-recording';

const workspace = '11111111-1111-4111-8111-111111111111';
const threadId = '22222222-2222-4222-8222-222222222222';
function service() {
  let head: BrainThreadSnapshot = { workspace, threadId, revision: 0, events: [] };
  const commits = new Map<string, { ok: true; revision: number; commitId: string; duplicate: boolean; sha256: string }>();
  let loseAcknowledgement = false;
  const requests: BrainCommitRequest[] = [];
  const fetchImpl: typeof fetch = async (_url, options) => {
    if (options?.method !== 'POST') return new Response(JSON.stringify(head));
    const request = JSON.parse(String(options.body)) as BrainCommitRequest;
    requests.push(request);
    if (commits.has(request.commitId)) return new Response(JSON.stringify({ ...commits.get(request.commitId), duplicate: true }));
    if (request.expectedRevision !== head.revision) return new Response('', { status: 409 });
    head = { ...head, revision: head.revision + 1, events: [...head.events, ...request.events], runtimeMessages: request.runtimeMessages ?? head.runtimeMessages, metadata: request.metadata ?? head.metadata };
    const response = { ok: true as const, revision: head.revision, commitId: request.commitId, duplicate: false, sha256: 'test-hash' };
    commits.set(request.commitId, response);
    if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('Connection dropped after commit'); }
    return new Response(JSON.stringify(response));
  };
  return { fetchImpl, head: () => head, requests, loseNextAcknowledgement: () => { loseAcknowledgement = true; } };
}
function open(root: string, server: ReturnType<typeof service>, actorId = 'member-a') {
  return new ConversationBrain({ root, workspace, actorId, threadId, apiUrl: 'https://api.test', headers: async () => ({ authorization: 'Bearer local-credential' }), fetchImpl: server.fetchImpl, intervalMs: 60_000 });
}

test('complete tool output and messages survive cloud hydration into a pristine device root', async () => {
  const root = mkdtempSync('/tmp/nm-brain-sync-');
  const server = service();
  try {
    const first = open(join(root, 'device-a'), server);
    const toolOutput = 'line with content\n'.repeat(30_000);
    first.record('user.message', { text: 'Remember amber-pelican-73' });
    await withConversationBrain(first, async () => {
      recordRuntimeEvent('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'notes.txt' } }] } });
      recordRuntimeEvent('claude', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: toolOutput }] } });
      recordRuntimeEvent('claude', { type: 'assistant', message: { content: [{ type: 'text', text: 'I kept the note.' }] } });
    });
    first.setRuntime([{ role: 'user', content: [{ type: 'text', text: 'Remember amber-pelican-73' }] }, { role: 'assistant', content: [{ type: 'text', text: 'I kept the note.' }] }], { provider: 'claude', model: 'first-model' });
    await first.close();
    const second = open(join(root, 'device-b'), server);
    assert.equal(second.events().length, 0);
    assert.equal(second.messages(), undefined);
    await second.hydrate();
    assert.equal((second.events().find((event) => event.type === 'tool.result')!.payload as { output: string }).output, toolOutput);
    assert.deepEqual(second.messages(), first.messages());
    await withConversationBrain(second, async () => {
      assert.match(conversationContext(), /amber-pelican-73/);
      second.record('model.change', { from: 'first-model', to: 'different-provider-model' });
      recordRuntimeEvent('codex', { type: 'item.completed', item: { type: 'agent_message', text: 'The note is amber-pelican-73.' } });
    });
    await second.close();
    assert.equal(server.head().revision, 2);
    assert.match(JSON.stringify(server.head()), /different-provider-model/);
    assert.equal(server.head().events.filter((event) => event.type === 'user.message').length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a lost acknowledgement replays the exact durable commit after restart without duplicate events', async () => {
  const root = mkdtempSync('/tmp/nm-brain-retry-');
  const server = service();
  try {
    const first = open(root, server);
    first.record('user.message', { text: 'Only once' });
    server.loseNextAcknowledgement();
    await assert.rejects(first.flush(), /dropped after commit/);
    const pending = JSON.parse(readFileSync(join(first.path, 'pending.json'), 'utf8')) as BrainCommitRequest;
    const restarted = open(root, server);
    await restarted.hydrate();
    assert.equal(server.requests[1]?.commitId, pending.commitId);
    assert.equal(restarted.pending(), 0);
    assert.equal(server.head().events.length, 1);
    assert.equal(existsSync(join(first.path, 'pending.json')), false);
    await restarted.close();
    // The killed-process simulation's original timer must not outlive the test root.
    await first.close().catch(() => {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('corrupt journal tail is quarantined and the next event remains replayable', async () => {
  const root = mkdtempSync('/tmp/nm-brain-tail-');
  const server = service();
  try {
    const original = open(root, server);
    original.record('user.message', { text: 'Durable prefix' });
    await original.close();
    appendFileSync(join(original.path, 'events.jsonl'), '{"id":"partial');
    const recovered = open(root, server);
    assert.equal(recovered.events().length, 1);
    assert.equal(readdirSync(original.path).some((file) => file.endsWith('.bad')), true);
    recovered.record('assistant.message', { text: 'After recovery' });
    await recovered.close();
    assert.equal(open(root, server).events().length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('credential fields and provider tokens never reach the portable JSON', async () => {
  const root = mkdtempSync('/tmp/nm-brain-secrets-');
  const server = service();
  try {
    const brain = open(root, server);
    const credential = 'test-provider-credential-with-random-format';
    brain.excludeSecret(credential);
    brain.record('runtime.event', { config: { apiKey: credential, headers: { authorization: `Bearer ${credential}` } }, output: `echo ${credential}` });
    brain.setRuntime([{ role: 'assistant', content: [{ text: credential }] }]);
    await brain.close();
    assert.doesNotMatch(JSON.stringify(server.head()), /test-provider-credential/);
    assert.match(JSON.stringify(server.head()), /redacted/);
    assert.equal(portableBrainValue({ refresh_token: 'private-value', text: 'safe' }).refresh_token, '[redacted]');
    assert.notEqual(open(root, server, 'other-member').path, brain.path);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('two offline branches cannot overwrite each other', async () => {
  const root = mkdtempSync('/tmp/nm-brain-conflict-');
  const server = service();
  const first = open(join(root, 'a'), server); const second = open(join(root, 'b'), server);
  try {
    first.record('user.message', { text: 'Branch A' }); second.record('user.message', { text: 'Branch B' });
    await first.close();
    await assert.rejects(second.flush(), /changed on another device/);
    assert.equal(second.pending(), 1);
    assert.equal((second.events()[0]!.payload as { text: string }).text, 'Branch B');
    assert.match(JSON.stringify(server.head()), /Branch A/);
    assert.doesNotMatch(JSON.stringify(server.head()), /Branch B/);
  } finally { await second.close().catch(() => {}); rmSync(root, { recursive: true, force: true }); }
});

test('long journals split at the API event limit and losslessly compress full large snapshots', async () => {
  const root = mkdtempSync('/tmp/nm-brain-long-');
  const server = service();
  try {
    const placeholder = open(root, server);
    const events = Array.from({ length: 4100 }, (_, index) => ({ id: `stored-${index}`, type: 'runtime.event', timestamp: '2026-10-10T00:00:00.000Z', payload: { index } }));
    writeFileSync(join(placeholder.path, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + '\n');
    const brain = open(root, server);
    const large = 'A full tool result, preserved without truncation.\n'.repeat(200_000);
    brain.record('tool.result', { id: 'big-output', output: large });
    brain.setRuntime([{ role: 'user', content: [{ type: 'text', text: large }] }]);
    await brain.close();
    assert.equal(server.requests.length, 2);
    assert.equal(server.requests[0]?.events.length, 4096);
    assert.equal(server.requests[0]?.runtimeMessages, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(server.requests[1])) < 16 * 1024 * 1024);
    const second = open(join(root, 'second-device'), server);
    await second.hydrate();
    assert.equal((second.events().at(-1)!.payload as { output: string }).output, large);
    assert.equal(((second.messages()![0] as any).content[0]).text, large);
    await second.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('credential redaction preserves repeated references and only marks actual cycles', () => {
  const shared = { output: 'same complete output' };
  assert.deepEqual(portableBrainValue({ first: shared, second: shared }), { first: shared, second: shared });
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  assert.deepEqual(portableBrainValue(cycle), { self: '[circular]' });
});


test('an exact persisted commit retries before a later oversized event and retains that event locally', async () => {
  const root = mkdtempSync('/tmp/nm-brain-pending-first-');
  const server = service(); const brain = open(root, server);
  try {
    brain.record('user.message', { text: 'Already committed' });
    server.loseNextAcknowledgement();
    await assert.rejects(brain.flush(), /dropped after commit/);
    const pending = JSON.parse(readFileSync(join(brain.path, 'pending.json'), 'utf8')) as BrainCommitRequest;
    brain.record('tool.result', { output: randomBytes(9 * 1024 * 1024).toString('base64') });
    await assert.rejects(brain.flush(), /8 MB sync limit/);
    assert.equal(server.requests[1]?.commitId, pending.commitId);
    assert.equal(brain.pending(), 1);
    assert.equal(brain.events().length, 2);
    assert.equal(server.head().events.length, 1);
  } finally { await brain.close().catch(() => {}); rmSync(root, { recursive: true, force: true }); }
});

test('more than 256 artifact references publish in validated batches', async () => {
  const root = mkdtempSync('/tmp/nm-brain-artifact-batches-');
  const server = service(); const brain = open(root, server);
  try {
    for (let index = 0; index < 260; index++) brain.record('artifact.created', { id: `artifact-${index}` });
    await brain.close();
    assert.deepEqual(server.requests.map((request) => request.artifactIds?.length), [256, 4]);
    assert.equal(server.head().events.length, 260);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bound tool callbacks retain the thread outside the request scope and the current prompt is not duplicated', async () => {
  const root = mkdtempSync('/tmp/nm-brain-bound-tools-');
  const server = service(); const brain = open(root, server);
  try {
    brain.record('user.message', { text: 'Remember the older context.' });
    brain.record('user.message', { text: 'This is the current question.' });
    const callback = await withConversationBrain(brain, async () => bindConversationCallback(() => conversationContext('This is the current question.')));
    assert.equal(conversationContext(), '');
    assert.match(callback(), /Remember the older context/);
    assert.doesNotMatch(callback(), /This is the current question/);
    await brain.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an artifact rollout gate explains the missing delivery and retains the upload', async () => {
  const root = mkdtempSync('/tmp/nm-brain-upload-gate-');
  const brain = new ConversationBrain({ root, workspace, actorId: 'member-a', threadId, apiUrl: 'https://api.test', headers: async () => ({}), intervalMs: 60_000,
    fetchImpl: async () => Response.json({ code: 'BRAIN_READER_UPGRADE_REQUIRED' }, { status: 409 }) });
  try {
    await assert.rejects(brain.artifact({ name: 'cover.png', inlineContent: 'data:image/png;base64,AA==' }, { kind: 'human', id: 'member-a' }), /Artifact uploads are not enabled/);
    assert.equal(readdirSync(join(brain.path, 'uploads')).length, 1);
  } finally { await brain.close().catch(() => {}); rmSync(root, { recursive: true, force: true }); }
});
