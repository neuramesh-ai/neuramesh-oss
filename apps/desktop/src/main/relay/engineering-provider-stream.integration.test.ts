import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The native SDK owns process-global state. Isolate it from the other host tests and
// from the developer's Cline sessions; all provider calls use an in-memory transport.
// Allow process startup and SDK disposal under a full workspace run. The transport deadlines
// below remain 60/45 ms, and the same timeout/zero-tool/no-replay/recovery assertions apply.
for (const failure of ['network', 'keepalive', 'padding', 'arguments']) test(`native SDK recovers from ${failure} stalls without executing partial tools or replaying`, { timeout: 40_000 }, async () => {
  const dir = await mkdtemp('/tmp/nm-native-stream-test-');
  try {
    const source = `
      import assert from 'node:assert/strict';
      import { ClineCore } from '@cline/sdk';
      import { setTimeout as delay } from 'node:timers/promises';
      import { createRequire } from 'node:module';
      const { engineeringProviderFetch } = createRequire(import.meta.url)(${JSON.stringify(fileURLToPath(new URL('./engineering-provider-stream.ts', import.meta.url)))});
      const events = [], receipts = []; let calls = 0, toolExecutions = 0;
      const frame = value => 'data: ' + JSON.stringify(value) + '\\n\\n';
      const response = { id: 'resp_test', created_at: 1700000000, model: 'gpt-5.6-sol' };
      const created = { type: 'response.created', response };
      const encoder = new TextEncoder();
      const core = await ClineCore.create({ clientName: 'native-timeout-test', backendMode: 'local', fetch: engineeringProviderFetch(async () => {
        calls++;
        if (calls === 1) return new Response(new ReadableStream({ start(c) {
          c.enqueue(encoder.encode(frame(created)));
          if (['padding', 'arguments'].includes(${JSON.stringify(failure)})) {
            c.enqueue(encoder.encode(frame({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup_fixture', arguments: '' } })));
            c.enqueue(encoder.encode(frame({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{' })));
            if (${JSON.stringify(failure)} === 'padding') c.enqueue(encoder.encode(frame({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: ' '.repeat(8193) })));
          }
        }, async pull(c) { if (${JSON.stringify(failure)} === 'arguments') { await delay(10); c.enqueue(encoder.encode(frame({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: 'word' }))); } else if (${JSON.stringify(failure)} === 'keepalive') { await delay(10); c.enqueue(encoder.encode(frame({ type: 'keepalive' }))); } } }), { headers: { 'content-type': 'text/event-stream' } });
        const item = { type: 'message', id: 'msg_test', role: 'assistant', content: [] };
        return new Response([
          created, { type: 'response.output_item.added', output_index: 0, item },
          { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Recovered.' },
          { type: 'response.output_item.done', output_index: 0, item },
          { type: 'response.completed', response: { ...response, status: 'completed', incomplete_details: null, usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } } },
        ].map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } });
      }, r => receipts.push(r), 60, 45) });
      core.subscribe(e => events.push(e));
      try {
        const session = await core.start({ source: 'web', interactive: true, prompt: 'Say hello.', localRuntime: { configExtensions: [], extraTools: [{ name: 'lookup_fixture', description: 'Read a test fixture.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => { toolExecutions++; return 'ok'; } }] }, config: {
          providerId: 'openai-native', modelId: 'gpt-5.6-sol', apiKey: 'fake-test-key', cwd: ${JSON.stringify(dir)}, workspaceRoot: ${JSON.stringify(dir)},
          systemPrompt: 'You are a test assistant.', mode: 'plan', maxIterations: 2, enableTools: true, enableSpawnAgent: false, enableAgentTeams: false, disableMcpSettingsTools: true,
        } });
        assert.equal(calls, 1);
        assert.equal(receipts[0].outcome, 'timeout');
        assert.equal(receipts[0].timeoutKind, ${JSON.stringify(failure === 'keepalive' ? 'provider_progress' : failure !== 'network' ? 'tool_arguments' : 'network')});
        assert.equal(toolExecutions, 0);
        assert.ok(events.some(e => e.type === 'agent_event' && e.payload.event.type === 'error'));
        assert.ok(events.some(e => e.type === 'status' && e.payload.status === 'idle'));
        const boundary = events.length;
        await core.send({ sessionId: session.sessionId, prompt: 'Try again.', mode: 'plan' });
        assert.equal(calls, 2);
        assert.equal(receipts[1].outcome, 'complete');
        assert.ok(events.slice(boundary).some(e => e.type === 'agent_event' && e.payload.event.type === 'done'));
        console.log('NATIVE_TIMEOUT_RECOVERY_PASS');
      } finally { await core.dispose(); }
      process.exit(0);
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { ...process.env, CLINE_DATA_DIR: `${dir}/cline` }, timeout: 30_000, maxBuffer: 200_000,
    });
    assert.match(stdout, /NATIVE_TIMEOUT_RECOVERY_PASS/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
