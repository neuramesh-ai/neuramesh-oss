import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClineCore, ToolApprovalRequest } from '@cline/sdk';
import { createClineEngineeringHost, resolveEngineeringProvider } from './engineering-host';
import { createStarterEngineeringFetch } from './engineering-provider';
import type { EngineeringRuntimeEvent } from '../../engineering-protocol';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

const keyFetch: typeof fetch = async () => new Response(JSON.stringify({ token: 'sk-test', authMode: 'apikey' }), { status: 200 });

test('Engineering provider resolution uses workspace API-key credentials', async () => {
  let resolvedUrl = '';
  const provider = await resolveEngineeringProvider({
    apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1',
    fetchImpl: async (input) => { resolvedUrl = String(input); return keyFetch(input); },
  }, { modelId: 'claude-opus-4-8', agentId: 'patch-1' }, {});
  assert.deepEqual(provider, { providerId: 'anthropic', modelId: 'claude-opus-4-8', apiKey: 'sk-test' });
  assert.equal(new URL(resolvedUrl).searchParams.get('provider'), 'anthropic');
  assert.equal(new URL(resolvedUrl).searchParams.get('agentId'), 'patch-1');
});

test('Engineering provider resolution passes an explicit OpenAI-compatible base URL to Cline', async () => {
  const provider = await resolveEngineeringProvider(
    { apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1', fetchImpl: keyFetch },
    { modelId: 'claude-opus-4-8' }, {
      NM_ENGINEERING_API_KEY: 'local-test-key',
      NM_ENGINEERING_PROVIDER: 'openai-compatible',
      NM_ENGINEERING_MODEL: 'neuramesh-harness',
      NM_ENGINEERING_BASE_URL: 'http://127.0.0.1:8790/v1',
    },
  );
  assert.deepEqual(provider, {
    providerId: 'openai-compatible', modelId: 'neuramesh-harness', apiKey: 'local-test-key',
    baseUrl: 'http://127.0.0.1:8790/v1',
  });
});

test('Engineering provider resolution uses the configured brain subscription transport', async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const provider = await resolveEngineeringProvider({
    apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w 1',
    fetchImpl: async (input, init) => {
      const url = String(input);
      requests.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ token: null, authMode: 'subscription' }), { status: 200 });
    },
  }, { modelId: 'gpt-5.5', agentId: 'patch-1' }, {});
  assert.deepEqual(provider, { providerId: 'openai-codex-cli', modelId: 'gpt-5.5' });
  assert.deepEqual(requests.map((request) => new URL(request.url).searchParams.get('provider')), ['openai']);
  assert.equal(requests.every((request) => request.authorization === 'Bearer nmm_test'), true);
  assert.equal(new URL(requests[0]!.url).searchParams.get('workspace'), 'w 1');
});

test('local web validation uses the configured brain with the machine provider settings', async () => {
  const dir = await mkdtemp('/tmp/nm-engineering-provider-');
  const path = `${dir}/providers.json`;
  try {
    await writeFile(path, JSON.stringify({ providers: { anthropic: { settings: { apiKey: 'sk-local' } } } }));
    const provider = await resolveEngineeringProvider({
      apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1',
      fetchImpl: async () => { throw new Error('workspace credential should not be read'); },
    }, { modelId: 'claude-opus-4-8' }, { NM_ENGINEERING_LOCAL_PROVIDER_SETTINGS: path });
    assert.deepEqual(provider, { providerId: 'anthropic', modelId: 'claude-opus-4-8', apiKey: 'sk-local' });
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('Engineering provider resolution ends with an actionable error when no API key works', async () => {
  await assert.rejects(
    resolveEngineeringProvider({
      apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1',
      fetchImpl: async () => new Response(JSON.stringify({ authMode: null }), { status: 200 }),
    }, { modelId: 'claude-sonnet-5' }, {}),
    /configured developer brain.*has no usable anthropic connection/,
  );
});

test('starter brain requests stay on the authenticated metered control-plane route', async () => {
  let seen: { url: string; authorization: string | null; body: Record<string, unknown> } | null = null;
  const starterFetch = createStarterEngineeringFetch({
    apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: '00000000-0000-0000-0000-000000000001',
    fetchImpl: async (input, init) => {
      seen = { url: String(input), authorization: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'ready' }] } }] }));
    },
  });
  const response = await starterFetch('https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent?alt=sse', {
    method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hello' }] }], systemInstruction: { parts: [{ text: 'system' }] } }),
  });
  const captured = seen as unknown as { url: string; authorization: string | null; body: Record<string, unknown> };
  assert.equal(captured.url, 'https://api.test/v1/starter/generate');
  assert.equal(captured.authorization, 'Bearer nmm_test');
  assert.equal(captured.body['system'], 'system');
  assert.match(await response.text(), /^data: /);
});

test('machine-side Cline approvals enforce Plan and current session controls', async () => {
  let capability: ((request: ToolApprovalRequest) => Promise<{ approved: boolean; reason?: string }> | { approved: boolean; reason?: string }) | undefined;
  const fake = {
    subscribe: () => () => {},
    listHistory: async () => [],
    readMessages: async () => [],
    start: async () => ({ sessionId: 'cline-1' }),
    send: async () => undefined,
    abort: async () => {},
    stop: async () => {},
    dispose: async () => {},
    restore: async () => ({ messages: [], checkpoint: { ref: 'x', createdAt: Date.now(), runCount: 1 } }),
  } as unknown as ClineCore;
  const createCore = (async (options?: Parameters<typeof import('@cline/sdk').ClineCore.create>[0]) => {
    capability = options?.capabilities?.requestToolApproval;
    return fake;
  }) as typeof import('@cline/sdk').ClineCore.create;
  const events: EngineeringRuntimeEvent[] = [];
  const host = createClineEngineeringHost({
    apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1', fetchImpl: keyFetch,
    resolveCwd: async () => '/work/app', resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }), createCore, log: () => {},
  });
  const session = await host.open({
    threadId: 'e1', actorId: 'u1', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'plan',
    permissions: { read: true, edit: true, command: true, web: false, mcp: false },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
  }, (event) => events.push(event));
  assert.ok(capability);
  const request = (toolName: string, id: string): ToolApprovalRequest => ({
    sessionId: 's', agentId: 'a', conversationId: 'c', iteration: 1, toolCallId: id, toolName,
    input: toolName === 'editor' ? { path: 'src/app.ts' } : {}, policy: {},
  });
  assert.deepEqual(await capability!(request('read_files', 'read-1')), { approved: true });
  assert.equal((await capability!(request('editor', 'edit-plan'))).approved, false);
  assert.equal(events.some((event) => event.type === 'mode_blocked' && event.category === 'edit' && event.toolName === 'editor'), true);
  session.command({
    type: 'controls',
    controls: {
      mode: 'act', permissions: { read: true, edit: false, command: false, web: false, mcp: false },
      policy: { read: true, edit: true, command: true, web: true, mcp: true },
    },
  });
  const pending = capability!(request('editor', 'edit-ask'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.some((event) => event.type === 'approval' && event.approvalId === 'edit-ask'), true);
  session.command({ type: 'approval', approvalId: 'edit-ask', approved: true });
  assert.deepEqual(await pending, { approved: true });
  session.close();
});

test('browser controls cannot widen a locked machine-side workspace policy', async () => {
  let capability: ((request: ToolApprovalRequest) => Promise<{ approved: boolean; reason?: string }> | { approved: boolean; reason?: string }) | undefined;
  const fake = {
    subscribe: () => () => {}, listHistory: async () => [], readMessages: async () => [],
    start: async () => ({ sessionId: 'cline-policy' }), send: async () => undefined, abort: async () => {},
    stop: async () => {}, dispose: async () => {}, restore: async () => ({ messages: [], checkpoint: { ref: 'x', createdAt: Date.now(), runCount: 1 } }),
  } as unknown as ClineCore;
  const host = createClineEngineeringHost({
    apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1', fetchImpl: keyFetch,
    resolveCwd: async () => '/work/app', resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }),
    resolvePolicyRules: async () => [{ id: 'locked-shell', scope: 'workspace', capability: 'shell.exec', selector: { kind: 'any' }, verdict: 'deny', locked: true }],
    createCore: (async (options) => { capability = options?.capabilities?.requestToolApproval; return fake; }) as typeof import('@cline/sdk').ClineCore.create,
    log: () => {},
  });
  const session = await host.open({
    threadId: 'e-policy', actorId: 'u1', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'act',
    permissions: { read: true, edit: true, command: true, web: true, mcp: true },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
  }, () => {});
  session.command({
    type: 'controls',
    controls: { mode: 'act', permissions: { read: true, edit: true, command: true, web: true, mcp: true }, policy: { read: true, edit: true, command: true, web: true, mcp: true } },
  });
  const request: ToolApprovalRequest = { sessionId: 's', agentId: 'a', conversationId: 'c', iteration: 1, toolCallId: 'cmd', toolName: 'run_commands', input: { commands: ['pnpm test'] }, policy: {} };
  assert.deepEqual(await capability!(request), { approved: false, reason: 'Blocked by Neuramesh workspace policy' });
  session.close();
});

test('relay attachment chunks reach the real Code turn as machine-local user files', async () => {
  let startInput: Record<string, unknown> | null = null;
  let startFileBody: string | null = null;
  const events: EngineeringRuntimeEvent[] = [];
  const fake = {
    subscribe: () => () => {}, listHistory: async () => [], readMessages: async () => [],
    start: async (input: Record<string, unknown>) => {
      startInput = input;
      const path = (input as { userFiles?: string[] }).userFiles?.[0];
      startFileBody = path ? await readFile(path, 'utf8') : null;
      return { sessionId: 'cline-attachment' };
    },
    send: async () => undefined, abort: async () => {}, stop: async () => {}, dispose: async () => {},
    restore: async () => ({ messages: [], checkpoint: { ref: 'x', createdAt: Date.now(), runCount: 1 } }),
  } as unknown as ClineCore;
  const host = createClineEngineeringHost({
    apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1', fetchImpl: keyFetch,
    resolveCwd: async () => '/work/app', resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }),
    createCore: (async () => fake) as typeof import('@cline/sdk').ClineCore.create, log: () => {},
  });
  const session = await host.open({
    threadId: `e-attachment-${crypto.randomUUID()}`, actorId: 'u1', projectId: 'p1', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'plan',
    permissions: { read: true, edit: false, command: false, web: false, mcp: false },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
  }, (event) => events.push(event));
  const bytes = Buffer.from('# Feature\nBuild the project-specific timer.');
  session.command({ type: 'attachment_start', id: 'spec-1', name: 'spec.md', mime: 'text/markdown', size: bytes.length });
  session.command({ type: 'attachment_chunk', id: 'spec-1', index: 0, data: bytes.toString('base64') });
  session.command({ type: 'attachment_end', id: 'spec-1' });
  while (events.filter((event) => event.type === 'attachment_ack').length < 3) await new Promise((resolve) => setImmediate(resolve));
  session.command({ type: 'prompt', prompt: 'Read the attached specification', attachments: [{ id: 'spec-1', name: 'spec.md', mime: 'text/markdown' }] });
  while (startFileBody === null) await new Promise((resolve) => setImmediate(resolve));
  const files = (startInput as unknown as { userFiles?: string[] }).userFiles ?? [];
  assert.equal(files.length, 1);
  assert.equal(startFileBody, bytes.toString());
  session.close();
});

test('live Code sessions close when attachment commands outrun the bounded validator queue', async () => {
  let disposed = false;
  const events: EngineeringRuntimeEvent[] = [];
  const fake = {
    subscribe: () => () => {}, listHistory: async () => [], readMessages: async () => [],
    start: async () => ({ sessionId: 'unused' }), send: async () => undefined, abort: async () => {},
    stop: async () => {}, dispose: async () => { disposed = true; },
    restore: async () => ({ messages: [], checkpoint: { ref: 'x', createdAt: Date.now(), runCount: 1 } }),
  } as unknown as ClineCore;
  const host = createClineEngineeringHost({
    apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1', fetchImpl: keyFetch,
    resolveCwd: async () => '/work/app', resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }),
    createCore: (async () => fake) as typeof import('@cline/sdk').ClineCore.create, log: () => {},
  });
  const session = await host.open({
    threadId: 'e-attachment-flood', actorId: 'u1', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'plan',
    permissions: { read: true, edit: false, command: false, web: false, mcp: false },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
  }, (event) => events.push(event));

  for (let index = 0; index < 65; index += 1) {
    session.command({ type: 'attachment_chunk', id: 'missing', index, data: 'eA==' });
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.some((event) => event.type === 'error' && event.code === 'ENGINEERING_PROTOCOL_LIMIT'), true);
  assert.equal(disposed, true);
});

test('Code keeps prompts, controls, and restores locked until the active Cline turn ends', async () => {
  let forward: (event: unknown) => void = () => {};
  const starts: Array<Record<string, unknown>> = []; const sent: Array<Record<string, unknown>> = []; const restores: unknown[] = [];
  const fake = {
    subscribe: (listener: (event: unknown) => void) => { forward = listener; return () => {}; },
    listHistory: async () => [], readMessages: async () => [],
    start: async (input: Record<string, unknown>) => { starts.push(input); return { sessionId: 'cline-running' }; },
    send: async (input: Record<string, unknown>) => { sent.push(input); }, abort: async () => {}, stop: async () => {}, dispose: async () => {},
    restore: async (input: unknown) => { restores.push(input); return { sessionId: 'restored', checkpoint: { ref: 'x', createdAt: Date.now(), runCount: 1 } }; },
  } as unknown as ClineCore;
  const events: EngineeringRuntimeEvent[] = [];
  const host = createClineEngineeringHost({
    apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1', fetchImpl: keyFetch,
    resolveCwd: async () => '/work/app', resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }),
    createCore: (async () => fake) as typeof import('@cline/sdk').ClineCore.create, log: () => {},
  });
  const session = await host.open({
    threadId: 'e-lock', actorId: 'u1', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'plan',
    permissions: { read: true, edit: false, command: false, web: false, mcp: false },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
  }, (event) => events.push(event));
  session.command({ type: 'prompt', prompt: 'first' });
  await new Promise((resolve) => setImmediate(resolve));
  session.command({ type: 'prompt', prompt: 'overlap' });
  session.command({ type: 'controls', controls: { mode: 'act', permissions: { read: true, edit: false, command: false, web: false, mcp: false }, policy: { read: true, edit: true, command: true, web: true, mcp: true } } });
  session.command({ type: 'restore', checkpointRunCount: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts.length, 1); assert.equal(sent.length, 0); assert.equal(restores.length, 0);
  assert.equal(events.filter((event) => event.type === 'error' && event.code === 'TURN_RUNNING').length >= 2, true);
  forward({ type: 'ended', payload: { reason: 'completed', sessionId: 'cline-running' } });
  session.command({ type: 'prompt', prompt: 'after completion' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  session.close();
});

test('switching Plan to Act resumes history in a new Cline session with Act tools', async () => {
  const starts: Array<Record<string, unknown>> = [];
  const stopped: string[] = [];
  let forward: (event: unknown) => void = () => {};
  const fake = {
    subscribe: (listener: (event: unknown) => void) => { forward = listener; return () => {}; },
    listHistory: async () => [],
    readMessages: async (sessionId: string) => [{ role: 'user', content: `history:${sessionId}` }],
    start: async (input: Record<string, unknown>) => {
      starts.push(input);
      return { sessionId: `cline-${starts.length}` };
    },
    send: async () => undefined,
    abort: async () => {},
    stop: async (sessionId: string) => { stopped.push(sessionId); },
    dispose: async () => {},
    restore: async () => ({ messages: [], checkpoint: { ref: 'x', createdAt: Date.now(), runCount: 1 } }),
  } as unknown as ClineCore;
  const createCore = (async () => fake) as typeof import('@cline/sdk').ClineCore.create;
  const host = createClineEngineeringHost({
    apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1', fetchImpl: keyFetch,
    resolveCwd: async () => '/work/app', resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }), createCore, log: () => {},
  });
  const session = await host.open({
    threadId: 'e-mode', actorId: 'u1', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'plan',
    permissions: { read: true, edit: false, command: false, web: false, mcp: false },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
  }, () => {});

  session.command({ type: 'prompt', prompt: 'plan this' });
  await new Promise((resolve) => setImmediate(resolve));
  forward({ type: 'ended', payload: { reason: 'completed', sessionId: 'cline-1' } });
  session.command({
    type: 'controls',
    controls: {
      mode: 'act', permissions: { read: true, edit: false, command: false, web: false, mcp: false },
      policy: { read: true, edit: true, command: true, web: true, mcp: true },
    },
  });
  session.command({ type: 'prompt', prompt: 'act on this' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(starts.length, 2);
  assert.equal((starts[0]!.config as { mode: string }).mode, 'plan');
  assert.equal((starts[1]!.config as { mode: string }).mode, 'act');
  const reasoningConfig = starts[0]!.config as { reasoningEffort?: string; thinking?: boolean };
  assert.deepEqual(
    { reasoningEffort: reasoningConfig.reasoningEffort, thinking: reasoningConfig.thinking },
    { reasoningEffort: 'low', thinking: true },
  );
  assert.deepEqual(starts[1]!.initialMessages, [{ role: 'user', content: 'history:cline-1' }]);
  assert.deepEqual(stopped, ['cline-1']);
  session.close();
});

test('switching the Code model carries transcript context into the selected model', async () => {
  const starts: Array<{ core: number; input: Record<string, unknown> }> = [];
  const disposed: number[] = [];
  let coreSerial = 0;
  let forward: (event: unknown) => void = () => {};
  const createCore = (async () => {
    const coreNumber = ++coreSerial;
    return {
      subscribe: (listener: (event: unknown) => void) => { forward = listener; return () => {}; },
      listHistory: async () => [],
      readMessages: async (sessionId: string) => [{ role: 'user', content: `history:${sessionId}` }],
      start: async (input: Record<string, unknown>) => {
        starts.push({ core: coreNumber, input });
        return { sessionId: `runtime-${coreNumber}` };
      },
      send: async () => undefined,
      abort: async () => {},
      stop: async () => {},
      dispose: async () => { disposed.push(coreNumber); },
      restore: async () => ({ messages: [], checkpoint: { ref: 'x', createdAt: Date.now(), runCount: 1 } }),
    } as unknown as ClineCore;
  }) as typeof import('@cline/sdk').ClineCore.create;
  const events: EngineeringRuntimeEvent[] = [];
  const host = createClineEngineeringHost({
    apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1', fetchImpl: keyFetch,
    resolveCwd: async () => '/work/app',
    resolveBrain: async (meta) => ({ modelId: meta.modelId ?? 'claude-sonnet-4-6' }),
    createCore,
    log: () => {},
  });
  const session = await host.open({
    threadId: 'e-brain', actorId: 'u1', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'plan',
    permissions: { read: true, edit: false, command: false, web: false, mcp: false },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
  }, (event) => events.push(event));

  session.command({ type: 'prompt', prompt: 'inspect this' });
  await new Promise((resolve) => setImmediate(resolve));
  forward({ type: 'ended', payload: { reason: 'completed', sessionId: 'runtime-1' } });
  session.command({ type: 'model', modelId: 'gpt-5.5' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  session.command({ type: 'prompt', prompt: 'continue with Codex' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(starts.length, 2);
  assert.equal((starts[0]!.input.config as { modelId: string }).modelId, 'claude-sonnet-4-6');
  assert.equal((starts[1]!.input.config as { modelId: string }).modelId, 'gpt-5.5');
  assert.deepEqual(starts[1]!.input.initialMessages, [{ role: 'user', content: 'history:runtime-1' }]);
  assert.equal(events.some((event) => event.type === 'model_changed' && event.modelId === 'gpt-5.5' && event.model === 'gpt-5.5'), true);
  assert.deepEqual(disposed, [1]);
  session.close();
});

test('restoring a Cline checkpoint rewinds workspace and seeds the next session transcript', async () => {
  const starts: Array<Record<string, unknown>> = [];
  const restores: Array<Record<string, unknown>> = [];
  const stopped: string[] = [];
  const sent: Array<Record<string, unknown>> = [];
  const restoredMessages = [{ role: 'assistant', content: 'restored transcript' }];
  let forward: (event: unknown) => void = () => {};
  const fake = {
    subscribe: (listener: (event: unknown) => void) => { forward = listener; return () => {}; }, listHistory: async () => [], readMessages: async () => [],
    start: async (input: Record<string, unknown>) => { starts.push(input); return { sessionId: `cline-${starts.length}` }; },
    send: async (input: Record<string, unknown>) => { sent.push(input); }, abort: async () => {},
    stop: async (sessionId: string) => { stopped.push(sessionId); }, dispose: async () => {},
    restore: async (input: Record<string, unknown>) => {
      restores.push(input);
      return { sessionId: 'cline-restored', startResult: { sessionId: 'cline-restored' }, messages: restoredMessages, checkpoint: { ref: 'restored', createdAt: Date.now(), runCount: 2 } };
    },
  } as unknown as ClineCore;
  const host = createClineEngineeringHost({
    apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1', fetchImpl: keyFetch,
    resolveCwd: async () => '/work/app', resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }), createCore: (async () => fake) as typeof import('@cline/sdk').ClineCore.create, log: () => {},
  });
  const events: EngineeringRuntimeEvent[] = [];
  const session = await host.open({
    threadId: 'e-restore', actorId: 'u1', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'act',
    permissions: { read: true, edit: false, command: false, web: false, mcp: false },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
  }, (event) => events.push(event));

  session.command({ type: 'prompt', prompt: 'make a change' });
  await new Promise((resolve) => setImmediate(resolve));
  forward({ type: 'ended', payload: { reason: 'completed', sessionId: 'cline-1' } });
  session.command({ type: 'restore', checkpointRunCount: 2 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(restores.length, 1);
  assert.equal(restores[0]?.['sessionId'], 'cline-1');
  assert.equal(restores[0]?.['checkpointRunCount'], 2);
  assert.equal(restores[0]?.['cwd'], '/work/app');
  assert.deepEqual(restores[0]?.['restore'], { workspace: true, messages: true, omitCheckpointMessageFromSession: false });
  const restoreStart = restores[0]?.['start'] as Record<string, unknown>;
  assert.equal((restoreStart['config'] as Record<string, unknown>)['mode'], 'act');
  assert.equal((restoreStart['config'] as Record<string, unknown>)['checkpoint'] instanceof Object, true);
  assert.deepEqual(restoreStart['sessionMetadata'], { neurameshThreadId: 'e-restore', repoId: 'r1', repoName: 'app', actorId: 'u1' });
  assert.deepEqual(stopped, ['cline-1']);
  assert.equal(events.some((event) => event.type === 'restored' && event.checkpointRunCount === 2), true);

  session.command({ type: 'prompt', prompt: 'continue after restore' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts.length, 1, 'restore already started the resumed Cline session');
  assert.deepEqual(sent, [{ sessionId: 'cline-restored', prompt: 'continue after restore', mode: 'act' }]);
  session.close();
});

test('the desktop host speaks as the signed-in member: its headers replace the machine bearer on every call', async () => {
  const seen: Array<string | null> = [];
  const provider = await resolveEngineeringProvider({
    apiUrl: 'https://api.test', machineToken: '', workspaceId: 'w1',
    authHeaders: async () => ({ 'x-nm-actor': '{"kind":"human","id":"u1"}' }),
    fetchImpl: async (_input, init) => { seen.push(new Headers(init?.headers).get('x-nm-actor')); return keyFetch(_input); },
  }, { modelId: 'claude-opus-4-8' }, {});
  assert.deepEqual(provider, { providerId: 'anthropic', modelId: 'claude-opus-4-8', apiKey: 'sk-test' });
  assert.deepEqual(seen, ['{"kind":"human","id":"u1"}']);
});
