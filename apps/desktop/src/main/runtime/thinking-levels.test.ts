// round 9 live narration: a routing turn thinks at most at Medium, and the API lane's first round one
// level lower, so the first words come sooner. The person's pick still governs coding and owned work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agyModelFor } from '../relay/engineering-agy-args';
import { firstRoundThinking, geminiThinking, triageThinking } from './thinking';

test('a triage turn caps High at Medium and keeps every other pick', () => {
  assert.equal(triageThinking('high'), 'medium');
  assert.equal(triageThinking('medium'), 'medium');
  assert.equal(triageThinking('low'), 'low');
  assert.equal(triageThinking(null), null);
  assert.equal(triageThinking(undefined), null);
  // on a Google sign-in the cap reaches agy as its model id
  assert.equal(agyModelFor('gemini-4-argon', triageThinking('high')), 'gemini-4-argon-medium');
});

test('the first API round thinks one level lower', () => {
  assert.equal(firstRoundThinking('high'), 'medium');
  assert.equal(firstRoundThinking('medium'), 'low');
  assert.equal(firstRoundThinking('low'), 'low');
  assert.equal(firstRoundThinking(null), null);
  assert.deepEqual(geminiThinking({ model: 'gemini-4-argon', thinking: firstRoundThinking('medium') }), { thinkingConfig: { thinkingLevel: 'LOW' } });
});
