// threadTranscript — the newest-kept contract (2026-08-18 audit defect A2).
//
// The regression this pins: `order by created_at asc limit 40` took the OLDEST 40 rows, so a
// thread past 40 messages silently dropped its newest ones — including the human message that
// triggered the wake — and the agent answered an old conversation. The fix reads newest-first,
// renders chronologically, and caps older bodies while the live exchange stays whole.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeTurnContext } from './turncontext';

type Row = { author_kind: string; author_id: string; body: string; created_at: string };

function harness(messages: Row[]) {
  // a db stub honoring the query's own ORDER/LIMIT semantics, so the assertion is about what the
  // SQL ASKS FOR, not about a mock's fixed answer
  const db = {
    getAll: async (sql: string) => {
      const desc = /order by created_at desc/i.test(sql);
      const limit = Number(/limit (\d+)/i.exec(sql)?.[1] ?? messages.length);
      const sorted = [...messages].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      if (desc) sorted.reverse();
      return sorted.slice(0, limit);
    },
  };
  const tc = makeTurnContext({ db, blockFor: async () => '', alog: () => () => {} } as never);
  return tc.threadTranscript(
    { id: 'agent-1', name: 'pat' } as never,
    { id: 'task-1', number: 7, title: 'long thread', state: 'in_progress', channel_id: 'ch-1', description: null } as never,
  );
}

const row = (i: number, body: string, author = 'human'): Row => ({
  author_kind: author === 'human' ? 'human' : 'agent',
  author_id: author === 'human' ? 'u-1' : author,
  body,
  created_at: `2026-08-18T10:${String(i).padStart(2, '0')}:00Z`,
});

test('a thread past 40 messages keeps its NEWEST rows — the trigger is always present', async () => {
  const messages = Array.from({ length: 45 }, (_, i) => row(i, `message ${i}`));
  messages.push(row(46, 'THE TRIGGERING MESSAGE'));
  const out = await harness(messages);
  assert.match(out, /THE TRIGGERING MESSAGE/, 'the newest message fell out of the transcript');
  assert.ok(!out.includes('message 0'), 'the oldest rows should be the ones trimmed');
  // still rendered oldest→newest for the model
  assert.ok(out.indexOf('message 44') < out.indexOf('THE TRIGGERING MESSAGE'), 'transcript lost chronological order');
});

test('older bodies are capped; the recent exchange stays whole', async () => {
  const long = 'x'.repeat(5_000);
  const messages = [
    ...Array.from({ length: 30 }, (_, i) => row(i, i === 0 ? long : `old ${i}`)),
    row(58, long, 'agent-2'),
  ];
  const out = await harness(messages);
  // the old long body is truncated with a visible mark…
  assert.match(out, /x{600} \[…\]/, 'an older long body was not capped');
  // …and the newest long body is untouched
  assert.ok(out.includes(`agent: ${long}`), 'a recent body was truncated — the live exchange must stay whole');
});

test('short threads are unchanged: everything present, in order, uncapped', async () => {
  const out = await harness([row(1, 'first'), row(2, 'second', 'agent-1'), row(3, 'third')]);
  assert.ok(out.indexOf('human: first') < out.indexOf('you: second'), 'order or authorship broke');
  assert.ok(out.indexOf('you: second') < out.indexOf('human: third'));
});
