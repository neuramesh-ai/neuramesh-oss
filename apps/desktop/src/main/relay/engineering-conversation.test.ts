import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ClineCore, CoreSessionEvent } from '@cline/sdk';
import type { BrainCommitRequest, BrainThreadSnapshot } from '@neuramesh/shared';
import { createClineEngineeringHost } from './engineering-host';
import { EngineeringConversation } from './engineering-conversation';
import { portableRuntimeMessages } from './engineering-runtime-input';
import { ConversationBrain, publishConversationArtifact, withConversationBrain } from '../harness/brain-sync';

const workspace = '11111111-1111-4111-8111-111111111111';
const threadId = '22222222-2222-4222-8222-222222222222';
const options = { workspace, actorId: 'owner', threadId, apiUrl: 'https://api.test', headers: async () => ({}) };
function cloud() {
  let head: BrainThreadSnapshot = { workspace, threadId, revision: 0, events: [] };
  const bytes = new Map<string, Buffer>();
  const fetchImpl: typeof fetch = async (url, init) => {
    if (String(url).includes('/credentials')) return new Response(JSON.stringify({ token: 'private-provider-credential', authMode: 'apikey' }));
    if (String(url).includes('/artifacts')) {
      if (init?.method === 'POST') {
        const artifact = JSON.parse(String(init.body));
        const content = Buffer.from(artifact.contentBase64, 'base64');
        assert.equal(createHash('sha256').update(content).digest('hex'), artifact.sha256);
        bytes.set(artifact.id, content);
        return new Response(JSON.stringify({ ok: true, id: artifact.id }));
      }
      const id = new URL(String(url)).pathname.split('/').pop()!;
      return new Response(new Uint8Array(bytes.get(id)!));
    }
    if (init?.method === 'POST') {
      const request = JSON.parse(String(init.body)) as BrainCommitRequest;
      assert.equal(request.expectedRevision, head.revision);
      for (const artifactId of request.artifactIds ?? []) assert.ok(bytes.has(artifactId));
      head = { ...head, revision: head.revision + 1, events: [...head.events, ...request.events], runtimeMessages: request.runtimeMessages, metadata: request.metadata };
      return new Response(JSON.stringify({ ok: true, commitId: request.commitId, revision: head.revision, sha256: 'test' }));
    }
    return new Response(JSON.stringify(head));
  };
  return { fetchImpl, head: () => head, bytes };
}

test('Code records full raw tool output before relay projection, then restores runtime messages and files for another model', async () => {
  const root = await mkdtemp('/tmp/nm-code-brain-');
  const remote = cloud();
  const body = 'full-output-'.repeat(32_000);
  const messages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'The secret project word is copper-kestrel-91.' }] }, { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'I saved the word.' }] }];
  const input: Array<Parameters<ClineCore['start']>[0]> = [];
  const disposed: Promise<void>[] = [];
  let coreCount = 0;
  const createCore = (async () => {
    const id = `session-${++coreCount}`;
    let subscriber = (_event: CoreSessionEvent) => {};
    let didDispose!: () => void;
    disposed.push(new Promise<void>((resolve) => { didDispose = resolve; }));
    return {
      subscribe: (listener: typeof subscriber) => { subscriber = listener; return () => {}; },
      listHistory: async () => [], // There is NO provider-local history on either device.
      readMessages: async () => messages,
      start: async (value: Parameters<ClineCore['start']>[0]) => {
        input.push(value);
        subscriber({ type: 'agent_event', payload: { sessionId: id, event: { type: 'content_end', contentType: 'tool', toolName: 'read_file', toolCallId: 'read-1', output: body } } } as CoreSessionEvent);
        subscriber({ type: 'status', payload: { sessionId: id, status: 'idle' } });
        return { sessionId: id };
      },
      send: async () => {}, stop: async () => {}, abort: async () => {}, dispose: async () => { didDispose(); },
    } as unknown as ClineCore;
  }) as typeof ClineCore.create;
  const meta = { threadId, actorId: 'owner', repoId: 'repo-1', repoName: 'example', branch: 'main', mode: 'act' as const, permissions: { read: true, edit: true, command: false, web: false, mcp: false }, policy: { read: true, edit: true, command: true, web: true, mcp: true } };
  try {
    const firstDir = join(root, 'repo-a'); const secondDir = join(root, 'repo-b');
    await mkdir(join(firstDir, '.nm-artifacts'), { recursive: true }); await mkdir(secondDir);
    await writeFile(join(firstDir, '.nm-artifacts', 'proof.txt'), 'copper-kestrel-91');
    const first = await createClineEngineeringHost({ apiUrl: options.apiUrl, workspaceId: workspace, machineToken: 'test-machine', fetchImpl: remote.fetchImpl, brainRoot: join(root, 'brain-a'), resolveCwd: async () => firstDir, resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }), createCore, log: () => {} }).open(meta, () => {});
    first.command({ type: 'prompt', prompt: 'Remember the project word.' });
    while (!input.length) await new Promise((resolve) => setImmediate(resolve));
    await first.flush!();
    assert.equal((remote.head().events.find((event) => event.type === 'runtime.event')!.payload as any).payload.event.output, body);
    assert.equal(remote.bytes.size, 1);
    first.close(); await disposed[0];
    const second = await createClineEngineeringHost({ apiUrl: options.apiUrl, workspaceId: workspace, machineToken: 'test-machine', fetchImpl: remote.fetchImpl, brainRoot: join(root, 'brain-b'), resolveCwd: async () => secondDir, resolveBrain: async () => ({ modelId: 'gpt-5.5' }), createCore, log: () => {} }).open({ ...meta, modelId: 'gpt-5.5' }, () => {});
    assert.equal(await readFile(join(secondDir, '.nm-artifacts', 'proof.txt'), 'utf8'), 'copper-kestrel-91');
    second.command({ type: 'prompt', prompt: 'Continue. What was the project word?' });
    while (input.length < 2) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(input[1]?.initialMessages, messages);
    assert.equal(input[1]?.config?.modelId, 'gpt-5.5');
    assert.equal(input[1]?.sessionMetadata?.['neurameshThreadId'], threadId);
    await second.flush!(); second.close(); await disposed[1];
    assert.doesNotMatch(JSON.stringify(remote.head()), /private-provider-credential/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cross-model replay keeps visible messages and tool pairs, while native reasoning stays in the archive', () => {
  const original: Awaited<ReturnType<ClineCore['readMessages']>> = [{ role: 'assistant', modelInfo: { provider: 'anthropic', id: 'claude-a' }, content: [{ type: 'thinking', thinking: 'native thought', signature: 'provider-only' }, { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'notes.txt' }, signature: 'other-signature' }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', name: 'read_file', content: 'Complete result' }] }];
  const replay = portableRuntimeMessages(original, 'openai', 'gpt-b');
  assert.doesNotMatch(JSON.stringify(replay), /provider-only|other-signature|native thought/);
  assert.match(JSON.stringify(replay), /Complete result/);
  assert.match(JSON.stringify(original), /native thought/);
});

test('artifact upload refuses symbolic links outside the portable output folder', async () => {
  const root = await mkdtemp('/tmp/nm-artifact-escape-');
  const remote = cloud();
  const conversation = new EngineeringConversation({ ...options, root: join(root, 'brain'), fetchImpl: remote.fetchImpl }, root);
  try {
    await mkdir(join(root, '.nm-artifacts')); await writeFile(join(root, 'private.txt'), 'must stay local');
    await symlink(join(root, 'private.txt'), join(root, '.nm-artifacts', 'leak.txt'));
    await assert.rejects(conversation.checkpoint({ readMessages: async () => [] } as unknown as ClineCore, 'session', {}), /symbolic links/);
    assert.equal(remote.bytes.size, 0);
  } finally { await conversation.close().catch(() => {}); await rm(root, { recursive: true, force: true }); }
});

test('an interrupted tool call restores with an explicit unknown outcome and no reused approval', () => {
  const original: Awaited<ReturnType<ClineCore['readMessages']>> = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'external-action', name: 'publish', input: { item: 'draft-1' } }] }];
  const portable = portableRuntimeMessages(original, 'openai', 'gpt-next');
  assert.equal(original.length, 1);
  assert.equal(portable.length, 2);
  assert.match(JSON.stringify(portable[1]), /outcome is unknown/);
  assert.match(JSON.stringify(portable[1]), /Prior approvals do not grant permission/);
  assert.match(JSON.stringify(portable[1]), /"is_error":true/);
});

test('parallel tool results replay once per call even when their results arrived separately', () => {
  const original: Awaited<ReturnType<ClineCore['readMessages']>> = [
    { role: 'assistant', content: [
      { type: 'tool_use', id: 'read', name: 'read_files', input: {} },
      { type: 'tool_use', id: 'search', name: 'search_codebase', input: {} },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read', name: 'read_files', content: 'file contents' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'search', name: 'search_codebase', content: 'search matches' }, { type: 'text', text: 'Keep this user note.' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Both tools completed.' }] },
  ];
  const before = structuredClone(original);
  const replay = portableRuntimeMessages(original, 'anthropic', 'claude-next');
  assert.deepEqual(replay[1]?.content, [original[1]!.content[0], original[2]!.content[0]]);
  assert.doesNotMatch(JSON.stringify(replay), /outcome is unknown/);
  assert.match(JSON.stringify(replay[2]), /Keep this user note/);
  assert.deepEqual(portableRuntimeMessages(replay, 'anthropic', 'claude-next'), replay);
  assert.deepEqual(original, before);
});

test('replay repairs previously saved unknown placeholders without losing the actual tool result', () => {
  const call: Awaited<ReturnType<ClineCore['readMessages']>> = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'read', name: 'read_files', input: {} }] }];
  const incomplete = portableRuntimeMessages(call, 'openai', 'first');
  const recorded = [...incomplete, { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 'read', name: 'read_files', content: 'Actual complete result' }] }];
  const replay = portableRuntimeMessages(recorded, 'anthropic', 'next');
  assert.equal(replay.length, 2);
  assert.deepEqual(replay[1]?.content, recorded[2]?.content);
  assert.match(JSON.stringify(recorded[1]), /outcome is unknown/);
});

test('conflicting tool outcomes are retained as one explicit error instead of guessed away', () => {
  const messages: Awaited<ReturnType<ClineCore['readMessages']>> = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'write', name: 'editor', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'write', name: 'editor', content: 'written' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'write', name: 'editor', content: 'not written', is_error: true }] },
  ];
  const replay = portableRuntimeMessages(messages, 'anthropic', 'next');
  assert.equal(replay.length, 2);
  assert.match(JSON.stringify(replay[1]), /Conflicting recorded results/);
  assert.match(JSON.stringify(replay[1]), /not written/);
  assert.match(JSON.stringify(replay[1]), /"is_error":true/);
});

test('generic thread files and image tools publish GCS artifacts and only references enter the journal', async () => {
  const root = await mkdtemp('/tmp/nm-generic-artifact-');
  const remote = cloud();
  const brain = new ConversationBrain({ ...options, root, fetchImpl: remote.fetchImpl });
  try {
    await withConversationBrain(brain, async () => {
      const doc = await publishConversationArtifact('/v1/commands', { type: 'artifact.create', kind: 'doc', name: 'report.md', inlineContent: '# Report\nFull contents', mime: 'text/markdown' }, { kind: 'agent', id: 'agent-a' });
      assert.equal(doc?.status, 200);
      assert.ok((await doc!.json() as { artifactId: string }).artifactId);
      const image = await publishConversationArtifact('/v1/artifacts', { kind: 'file', name: 'diagram.svg', inlineContent: 'data:image/svg+xml;base64,' + Buffer.from('<svg>Actual image bytes</svg>').toString('base64') }, { kind: 'agent', id: 'agent-a' });
      assert.equal(image?.status, 200);
    });
    await brain.close();
    assert.equal(remote.bytes.size, 2);
    assert.equal(remote.head().events.filter((event) => event.type === 'artifact.created').length, 2);
    assert.doesNotMatch(JSON.stringify(remote.head().events), /Full contents|Actual image bytes|contentBase64/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a fresh device restores the selected agent, model and reasoning from the brain before resolving its runtime', async () => {
  const root = await mkdtemp('/tmp/nm-selection-restore-');
  const remote = cloud();
  const agent = { id: 'patch-id', name: 'patch', role: 'developer' };
  const selection = { agentId: agent.id, modelId: 'gpt-5.6-sol', reasoningEffort: 'high' as const };
  const original = new ConversationBrain({ ...options, root: join(root, 'first'), fetchImpl: remote.fetchImpl });
  try {
    await original.hydrate();
    original.setRuntime([{ role: 'user', content: 'Remember selection restore.' }], { selection, agent });
    await original.flush();
    const head = original.revision();
    await original.close();
    let chosen: unknown;
    const events: unknown[] = [];
    const fake = { subscribe: () => {}, listHistory: async () => [], dispose: async () => {} } as unknown as ClineCore;
    const session = await createClineEngineeringHost({ apiUrl: options.apiUrl, workspaceId: workspace, machineToken: 'test', fetchImpl: remote.fetchImpl,
      brainRoot: join(root, 'fresh'), resolveCwd: async () => root,
      resolveBrain: async (meta) => { chosen = { agentId: meta.agentId, modelId: meta.modelId, reasoningEffort: meta.reasoningEffort }; return { modelId: meta.modelId!, agent }; },
      createCore: (async () => fake) as typeof ClineCore.create, log: () => {},
    }).open({ threadId, actorId: 'owner', repoId: 'repo', repoName: 'app', branch: 'main', mode: 'plan', permissions: { read: true, edit: false, command: false, web: false, mcp: false }, policy: { read: true, edit: true, command: true, web: true, mcp: true } }, (event) => events.push(event));
    assert.deepEqual(chosen, selection);
    assert.ok(events.some((event: any) => event.type === 'ready' && event.agent.id === agent.id && event.reasoningEffort === 'high'));
    // ready names the revision the recording reaches, so a client whose restore read an older one reads again
    assert.ok(head > 0);
    assert.ok(events.some((event: any) => event.type === 'ready' && event.recordedRevision === head));
    session.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally { await rm(root, { recursive: true, force: true }); }
});
