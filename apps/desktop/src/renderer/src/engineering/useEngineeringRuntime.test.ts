// a prompt from the composer ends the session's wait on GitHub (PR #694 review, second round, finding 6). send() kept
// blockedOn, so the gate's connected face stayed over the turn the prompt started, hid the approval card behind it,
// and its one door closed the live channel and cut the turn off. A new refusal sets the wait again through the reducer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createEngineeringSession } from './domain';
import { applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt } from './remote';
import { beginComposerPrompt } from './useEngineeringRuntime';

const refusal = { type: 'error', code: 'ENGINEERING_GITHUB_REQUIRED', message: 'Connect GitHub to code here.' };
const blocked = applyRemoteEngineeringEvent(createEngineeringSession({ id: 'r1', name: 'app', owner: 'acme', branch: 'main', root: null }), refusal);

test('the reducer alone keeps the wait over a new prompt', () => {
  assert.equal(blocked.blockedOn, 'github');
  assert.equal(beginRemoteEngineeringPrompt(blocked, 'Fix the build').blockedOn, 'github');
});

test('a prompt from the composer ends the wait, and its turn runs', () => {
  const sent = beginComposerPrompt(blocked, 'Fix the build', [{ name: 'log.txt', mime: 'text/plain' }]);
  assert.equal(sent.blockedOn, null);
  assert.equal(sent.state, 'streaming');
  assert.equal(sent.messages.at(-1)?.body, 'Fix the build');
  assert.deepEqual(sent.messages.at(-1)?.attachments, [{ name: 'log.txt', mime: 'text/plain' }]);
});

test('a new refusal sets the wait again', () => {
  assert.equal(applyRemoteEngineeringEvent(beginComposerPrompt(blocked, 'Fix the build'), refusal).blockedOn, 'github');
});

test('send() takes the composer step', () => {
  const src = readFileSync(join(import.meta.dirname, 'useEngineeringRuntime.ts'), 'utf8');
  assert.match(src, /update\(beginComposerPrompt\(session, prompt, uploads\.map\(/);
});
