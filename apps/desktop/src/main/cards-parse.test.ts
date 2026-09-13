// renderer cards/parse.ts (track A3b) — the fence regexes Md scans for and the two
// derivations behind the suggestion pills and the failover card's reset line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NMQ_BLOCK, NMAUTH_BLOCK, NMSCHED_BLOCK, FILE_NAME_RE, isHexColor, foResetLabel, suggestionTarget } from '../renderer/src/cards/parse';
import type { MessageRow } from '../renderer/src/bridge/rows-rooms';
import type { AgentRow } from '../renderer/src/bridge/rows-crew';

const scan = (re: RegExp, text: string): string[] => {
  re.lastIndex = 0; // module-scope /g regexes carry lastIndex between calls
  return [...text.matchAll(re)].map((m) => m[1]!.trim());
};

test('each card fence matches its own block and nothing else', () => {
  const body = 'intro\n```nmq\n{"q":"ship it?"}\n```\ntail\n```nmauth\n{"provider":"anthropic"}\n```';
  assert.deepEqual(scan(NMQ_BLOCK, body), ['{"q":"ship it?"}']);
  assert.deepEqual(scan(NMAUTH_BLOCK, body), ['{"provider":"anthropic"}']);
  assert.deepEqual(scan(NMSCHED_BLOCK, body), [], 'an absent fence yields nothing, never a partial match');
  assert.deepEqual(scan(NMQ_BLOCK, '```ts\nconst a = 1;\n```'), [], 'a plain code fence is not a card');
});

test('the fence regexes are reusable — lastIndex cannot leak between renders', () => {
  const body = '```nmq\nfirst\n```';
  assert.equal(scan(NMQ_BLOCK, body).length, 1);
  assert.equal(scan(NMQ_BLOCK, body).length, 1, 'a second render of the same message must still find the card');
});

// FILE_NAME_RE has no capture group — it matches the whole name, so read m[0]
const names = (text: string): string[] => {
  FILE_NAME_RE.lastIndex = 0;
  return [...text.matchAll(FILE_NAME_RE)].map((m) => m[0]);
};

test('FILE_NAME_RE linkifies deliverable names, not prose', () => {
  assert.deepEqual(names('see plan.md and shot.png'), ['plan.md', 'shot.png']);
  assert.deepEqual(names('e.g. the end.'), [], 'a sentence ending is not a file');
  assert.deepEqual(names('ship-plan-v2.md'), ['ship-plan-v2.md'], 'hyphens and versions survive');
});

test('isHexColor accepts 3- and 6-digit hex only', () => {
  for (const s of ['#fff', '#834a2b', ' #FFF ']) assert.equal(isHexColor(s), true, s);
  for (const s of ['#ff', '834a2b', '#12345', 'rgb(0,0,0)']) assert.equal(isHexColor(s), false, s);
});

test('foResetLabel counts forward from now, and degrades on junk', () => {
  const at = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
  assert.equal(foResetLabel(at(30)), 'in 30m');
  assert.equal(foResetLabel(at(120)), 'in 2h');
  assert.equal(foResetLabel(at(150)), 'in 2h 30m');
  assert.equal(foResetLabel(at(-5)), 'now', 'a cap that already reset reads as now, never as negative time');
  assert.equal(foResetLabel(null), null);
  assert.equal(foResetLabel('not a date'), null);
});

const msg = (over: Partial<MessageRow>): MessageRow =>
  ({ id: 'm1', author_kind: 'agent', author_id: 'a-rex', body: 'hi', channel_id: 'c1', created_at: '', ...over }) as MessageRow;
const rex = [{ id: 'a-rex', role: 'orchestrator' }] as AgentRow[];

test('suggestion pills attach to the orchestrator’s LAST word, and never after a human reply', () => {
  assert.equal(suggestionTarget([msg({ id: 'm2' })], rex), 'm2');
  assert.equal(suggestionTarget([msg({ id: 'm2' }), msg({ id: 'm3', author_kind: 'human', author_id: 'u1' })], rex), null,
    'once the human has replied the pills are stale');
  assert.equal(suggestionTarget([msg({ id: 'm2', author_id: 'a-patch' })], [{ id: 'a-patch', role: 'developer' }] as AgentRow[]), null,
    'only the orchestrator offers pills');
  assert.equal(suggestionTarget([], rex), null);
});

test('a message that already carries a card gets no pills — one ask at a time', () => {
  const carded = msg({ id: 'm9', body: 'here:\n```nmq\n{"question":"Add @market-analyst?","options":["yes","no"]}\n```' });
  assert.equal(suggestionTarget([carded], rex), null);
});
