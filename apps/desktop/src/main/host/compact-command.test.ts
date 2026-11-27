import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCompactCommand } from '@neuramesh/shared';
import { runManualCompaction } from './compact-command';
import { agentHomeTranscript } from './team-context';
import type { TeamContext } from '@neuramesh/shared';

test('productive compaction renews its deadline and a late provider cannot publish after a stall', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let finishProvider!: (value: string) => void;
  let writes = 0;
  let signal!: AbortSignal;
  const result = runManualCompaction(async (abort, progress) => {
    signal = abort;
    return agentHomeTranscript({
      signal: abort, status: progress, read: async () => ({
        home: null, threadId: 'chat', summary: null, revision: 0, compactThrough: 'old',
        messages: [{id: 'old', author_kind: 'human', author_id: 'u', body: 'work', created_at: ''}],
      }),
      summarize: () => new Promise(resolve => { finishProvider = resolve; }),
      compact: async () => { writes++; },
    }, true);
  }, 1000);
  t.mock.timers.tick(750);
  await Promise.resolve();
  t.mock.timers.tick(750);
  assert.equal(signal.aborted, false);
  const rejected = assert.rejects(result, /stopped making progress/);
  t.mock.timers.tick(251);
  await rejected;
  finishProvider('Late summary');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 0);
});

test('only a whole human command compacts; examples, agent messages and other addresses do not', () => {
  assert.equal(isCompactCommand(' /compact\n', 'human', 'rex'), true);
  assert.equal(isCompactCommand('@Rex /compact', 'human', 'rex'), true);
  for (const body of ['Explain /compact', '`/compact`', '> /compact', '@patch /compact', '/compact then implement']) {
    assert.equal(isCompactCommand(body, 'human', 'rex'), false);
  }
  assert.equal(isCompactCommand('/compact', 'agent', 'rex'), false);
});

test('a requested chat compaction processes large inputs in bounded segments and never drops the latest message', async () => {
  let saved = false; const inputs: string[] = [];
  const context: TeamContext = { home: null, threadId: 'chat', projectId: 'project', summary: null, revision: 0, compactThrough: 'old', messages: [
    { id: 'old', author_kind: 'human', author_id: 'person', created_at: '2026-10-01', body: 'retain-this-constraint '.repeat(7000) },
    { id: 'new', author_kind: 'human', author_id: 'person', created_at: '2026-10-02', body: 'latest request' },
  ] };
  const result = await agentHomeTranscript({ read: async () => saved ? { ...context, compactThrough: null, messages: context.messages.slice(-1) } : context,
    summarize: async (_system, input) => { inputs.push(input); return 'The user constraints remain binding; work is unfinished.'; },
    compact: async () => { saved = true; }, status: () => {}, toolsThrough: () => 'read repo/src/index.ts; tests passed, no PR yet',
  }, true);
  assert.ok(inputs.length > 1); assert.ok(inputs.every(input => input.length < 77000));
  assert.ok(inputs.some(input => input.includes('repo/src/index.ts')));
  assert.ok(inputs.every(input => !input.includes('latest request')));
  assert.match(result!, /latest request/); assert.doesNotMatch(result!, /Use list_team/);
});

test('a later segment failure preserves the previous summary and cursor', async () => {
  let writes = 0, calls = 0;
  await assert.rejects(agentHomeTranscript({ read: async () => ({ home: null, threadId: 'chat', revision: 2, summary: 'Existing summary', compactThrough: 'old',
    messages: [{ id: 'old', body: 'x'.repeat(130000), created_at: '', author_id: 'u', author_kind: 'human' }] }),
    summarize: async () => { if (++calls === 2) throw new Error('Provider unavailable'); return 'First segment'; },
    compact: async () => { writes++; }, status: () => {},
  }, true), /Provider unavailable/);
  assert.equal(writes, 0);
});
