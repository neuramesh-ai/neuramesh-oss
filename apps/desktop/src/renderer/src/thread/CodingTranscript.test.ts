// The machine's GitHub sentence stays in the session as the phone's reason (PR #694 review, finding 12): the phone
// has no gate. Here the gate and the connected divider say it, so the transcript never shows the sentence, and
// the greeting ("Ready in app") hides while the session waits, since it would say the opposite of the gate.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt, createEngineeringSession } from '@neuramesh/shared';
import { transcriptMessages } from './CodingTranscript';

const repo = { id: 'r1', name: 'app', owner: 'acme', branch: 'main', root: null };
const asked = beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Fix the login');
const blocked = applyRemoteEngineeringEvent(asked, { type: 'error', code: 'ENGINEERING_GITHUB_REQUIRED', message: 'app needs its GitHub copy on this cloud machine. Connect GitHub, and the session starts.' });

test('while the session waits for GitHub, the transcript holds only the person\'s message', () => {
  assert.equal(blocked.blockedOn, 'github');
  assert.deepEqual(transcriptMessages(blocked.messages, true).map((m) => [m.role, m.body]), [['user', 'Fix the login']]);
});

test('after the grant, the greeting returns and the stale sentence stays hidden', () => {
  const shown = transcriptMessages(blocked.messages, false);
  assert.deepEqual(shown.map((m) => m.role), ['assistant', 'user']);
  assert.match(shown[0]!.body, /Ready in/);
});

test('any other refusal keeps its words in the transcript', () => {
  const failed = applyRemoteEngineeringEvent(asked, { type: 'error', code: 'ENGINEERING_START_FAILED', message: 'The clone failed.' });
  assert.equal(transcriptMessages(failed.messages, false).at(-1)?.body, 'The clone failed.');
});
