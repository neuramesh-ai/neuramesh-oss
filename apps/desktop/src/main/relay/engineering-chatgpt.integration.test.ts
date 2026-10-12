import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('native ChatGPT provider preserves command approval, tool results and secret-free persistence', { timeout: 45_000 }, async () => {
  const dir = await mkdtemp('/tmp/nm-chatgpt-native-test-');
  try {
    // The SDK has process-global settings. Use isolated state and fake credentials, never the
    // developer's login. A managed in-memory executor proves no subprocess owns the tools.
    const source = `
      import assert from 'node:assert/strict';
      import { readdir, readFile } from 'node:fs/promises';
      import { join } from 'node:path';
      import { createRequire } from 'node:module';
      import { ClineCore } from '@cline/sdk';
      const require = createRequire(import.meta.url);
      const { createChatGPTSubscriptionFetch, CHATGPT_LOCAL_CREDENTIAL } = require(${JSON.stringify(fileURLToPath(new URL('./engineering-chatgpt.ts', import.meta.url)))});
      const { engineeringCoreOptions } = require(${JSON.stringify(fileURLToPath(new URL('./engineering-core.ts', import.meta.url)))});
      const { engineeringRuntimeInput } = require(${JSON.stringify(fileURLToPath(new URL('./engineering-runtime-input.ts', import.meta.url)))});
      const secret = 'fake-subscription-access-never-persist';
      for (const approved of [false, true]) {
        let calls = 0, executions = 0, approvals = 0;
        const events = [], receipts = [];
        const runtimeFetch = createChatGPTSubscriptionFetch(async (input, init) => {
          assert.equal(String(input), 'https://chatgpt.com/backend-api/codex/responses');
          assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + secret);
          assert.equal(init.redirect, 'error');
          const body = JSON.parse(init.body);
          assert.equal(body.store, false); assert.equal(body.stream, true);
          assert.ok(body.tools.some(t => t.name === 'run_commands'));
          assert.ok(body.tools.every(t => t.type === 'function'));
          if (++calls === 2) assert.ok(body.input.some(item => item.type === 'function_call_output' && item.call_id === 'call_fixture'));
          assert.ok(calls <= 2);
          const response = { id: 'resp_fixture', created_at: 1700000000, model: 'gpt-6-astra' };
          const item = calls === 1
            ? { type: 'function_call', status: 'completed', id: 'fc_fixture', call_id: 'call_fixture', name: 'run_commands', arguments: '{"commands":["npm test"]}' }
            : { type: 'message', status: 'completed', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: 'Finished.', annotations: [] }] };
          const frames = [
            { type: 'response.created', response },
            { type: 'response.output_item.added', output_index: 0, item: { ...item, ...(calls === 1 ? { arguments: '' } : { content: [] }) } },
            calls === 1 ? { type: 'response.function_call_arguments.delta', output_index: 0, item_id: item.id, delta: item.arguments }
              : { type: 'response.output_text.delta', output_index: 0, item_id: item.id, content_index: 0, delta: 'Finished.' },
            { type: 'response.output_item.done', output_index: 0, item },
            { type: 'response.completed', response: { ...response, status: 'completed', incomplete_details: null, output: [item], usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } } },
          ];
          return new Response(frames.map(e => 'data: ' + JSON.stringify(e) + '\\n\\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
        }, async () => ({ accessToken: secret, accountId: 'fake-account' }));
        const provider = { providerId: 'openai-codex', modelId: 'gpt-6-astra', apiKey: CHATGPT_LOCAL_CREDENTIAL, runtimeFetch };
        const options = engineeringCoreOptions(provider, 'fixture', {
          toolExecutors: { bash: async () => { executions++; return { stdout: 'Fixture passed.', stderr: '', exitCode: 0 }; } },
          requestToolApproval: async request => {
            assert.equal(request.toolName, 'run_commands'); approvals++;
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(calls, 1); assert.equal(executions, 0);
            return { approved, reason: approved ? undefined : 'Declined by user' };
          },
        }, (type, receipt) => receipts.push({ type, receipt }), () => {});
        const core = await ClineCore.create(options);
        core.subscribe(e => events.push(e));
        try {
          const controls = { mode: 'act', permissions: { read: true, edit: false, command: false, web: false, mcp: false }, policy: { read: true, edit: true, command: true, web: false, mcp: false } };
          const start = engineeringRuntimeInput({ meta: { threadId: 'fixture-' + approved, actorId: 'fixture', repoId: 'fixture', repoName: 'fixture', branch: 'main', ...controls }, cwd: ${JSON.stringify(dir)}, provider, modelId: provider.modelId, brainPack: null, controls, prompt: 'Run the fixture tests.', emit: () => {} });
          const session = await core.start(start);
          assert.equal(calls, 2); assert.equal(approvals, 1); assert.equal(executions, approved ? 1 : 0);
          const errors = events.filter(e => e.type === 'agent_event' && e.payload.event.type === 'error');
          assert.equal(errors.length, approved ? 0 : 1, JSON.stringify(errors.map(e => String(e.payload.event.error))));
          if (!approved) assert.match(String(errors[0].payload.event.error), /Declined by user/);
          const messages = await core.readMessages(session.sessionId);
          assert.ok(messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && b.tool_use_id === 'call_fixture')));
          assert.equal(receipts.length, 2);
          assert.ok(receipts.every(r => r.receipt.outcome === 'complete'));
          assert.ok(!JSON.stringify({ events, messages, receipts, start }).includes(secret));
        } finally { await core.dispose(); }
      }
      async function inspect(path) {
        for (const item of await readdir(path, { withFileTypes: true })) {
          const target = join(path, item.name);
          if (item.isDirectory()) await inspect(target);
          else if (item.isFile()) assert.ok(!(await readFile(target)).includes(Buffer.from(secret)), 'credential persisted in SDK data');
        }
      }
      await inspect(${JSON.stringify(dir)});
      console.log('CHATGPT_NATIVE_APPROVALS_PASS');
      process.exit(0);
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { ...process.env, CLINE_DATA_DIR: `${dir}/cline` }, timeout: 40_000, maxBuffer: 200_000,
    });
    assert.match(stdout, /CHATGPT_NATIVE_APPROVALS_PASS/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
