// who approved the plan (cards/planapprover.ts): the plan card's record reads "auto-approved · routine"
// only when a routine approved it (George, 2026-09-27, "Guard the routine rules"). a person's approval in
// a scheduled draft's session, or on repo work, reads "approved".
// run from apps/hq: pnpm exec tsx --test src/cards/planapprover.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedByRoutine } from './planapprover';

const marked = { schedule_id: 's-1', schedule_payload: '{"prompt":"Audit the account.","routine":true}', schedule_room_kind: 'marketing' };
const legacy = { schedule_id: 's-2', schedule_payload: '{"prompt":"Check the deps."}', schedule_room_kind: 'build' };
const draft = { schedule_id: 's-3', schedule_payload: '{"prompt":"Draft one X post."}', schedule_room_kind: 'marketing' };
const repoLess = { repo_id: null };

test('a routine approves a repo-less unit\'s plan by itself', () => {
  assert.equal(approvedByRoutine(repoLess, marked), true);
  assert.equal(approvedByRoutine(repoLess, legacy), true, 'a row armed before the marker, outside a marketing room');
});

test('a plan approved in a scheduled draft\'s session was a person\'s word', () => {
  assert.equal(approvedByRoutine(repoLess, draft), false);
});

test('repo work is approved by a person, whatever opened the conversation', () => {
  assert.equal(approvedByRoutine({ repo_id: 'r-1' }, marked), false);
});

test('a person\'s conversation, and a schedule row the replica does not hold yet, read as a person\'s approval', () => {
  assert.equal(approvedByRoutine(repoLess, { schedule_id: null }), false);
  assert.equal(approvedByRoutine(repoLess, undefined), false);
  assert.equal(approvedByRoutine(repoLess, { schedule_id: 's-4', schedule_payload: null, schedule_room_kind: null }), false);
});
