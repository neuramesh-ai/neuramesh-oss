// The coding gate's GitHub step is quiet (PR #694 review, findings 9 and 16). Its onDone opens the session again,
// and the resolve reads the room's repository while the machine clones the session's own, so the two can disagree:
// a mount answer of connected opened the session, the machine refused, the gate mounted again and asked again,
// every few seconds, without end. Only the person's own grant (its poll, Check again) or pick opens it now.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerFinishes } from './GitHubStep';

test('the coding gate: a connected answer before the person left for GitHub only sets the face', () => {
  assert.equal(answerFinishes(true, false), false);
});

test('the coding gate: the poll and Check again after the person\'s own grant open the session', () => {
  assert.equal(answerFinishes(true, true), true);
});

test('the settings step and the card finish on any connected answer, the mount ask included', () => {
  assert.equal(answerFinishes(false, false), true);
  assert.equal(answerFinishes(false, true), true);
});
