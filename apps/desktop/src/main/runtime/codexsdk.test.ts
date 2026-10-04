// a failed codex turn, as codex-cli 0.153.4 streams it (the #694 review, measured against a mock
// provider): `error`, then `turn.failed` with the reason, then exit 1. Past `turn.failed` the SDK's
// exec generator throws "Codex Exec exited with code 1: …", which carries no reason. A drain that read
// on threw that line, so a rex whose model the plan lacks never reached the account-default fallback.
//   node --import tsx --test apps/desktop/src/main/runtime/codexsdk.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drainTurn, runResilient, type CodexClient } from './codexsdk';

const NOT_SUPPORTED = "The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT account.";

/** a failed turn, then what the SDK's generator does next when codex exits 1 */
async function* failedTurn(words?: string) {
  yield { type: 'thread.started', thread_id: 't-1' };
  yield { type: 'turn.started' };
  if (words) yield { type: 'item.completed', item: { id: 'i-1', type: 'agent_message', text: words } };
  yield { type: 'error', message: NOT_SUPPORTED };
  yield { type: 'turn.failed', error: { message: NOT_SUPPORTED } };
  throw new Error('Codex Exec exited with code 1: Reading prompt from stdin...\n');
}

async function* answeredTurn(text: string) {
  yield { type: 'thread.started', thread_id: 't-2' };
  yield { type: 'turn.started' };
  yield { type: 'item.completed', item: { id: 'i-2', type: 'agent_message', text } };
  yield { type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 2 } };
}

test('a failed turn gives its own reason, not the exit code that follows it', async () => {
  assert.deepEqual(await drainTurn(failedTurn()), { text: '', tokens: undefined, failure: NOT_SUPPORTED });
});

test('words before the failure are no reply: the turn fails with its reason, as run() makes it fail', async () => {
  const turn = await drainTurn(failedTurn('Let me read the board.'));
  assert.deepEqual([turn.text, turn.failure], ['', NOT_SUPPORTED]);
});

test('a model the plan lacks runs the turn again on the account default', async () => {
  const asked: Array<string | undefined> = [];
  const codex: CodexClient = {
    startThread: (opts) => {
      asked.push(opts?.model);
      return {
        id: null,
        run: async () => { throw new Error('the drain streams the turn, it never calls run()'); },
        runStreamed: async () => ({ events: opts?.model ? failedTurn() : answeredTurn('hello from the default model') }),
      };
    },
    resumeThread: () => { throw new Error('a turn here starts its own thread'); },
  };
  const turn = await runResilient(codex, { model: 'gpt-5-codex', modelReasoningEffort: 'high' }, 'hello', {});
  assert.equal(turn.text, 'hello from the default model');
  assert.deepEqual(asked, ['gpt-5-codex', undefined], 'the second turn names no model');
});
