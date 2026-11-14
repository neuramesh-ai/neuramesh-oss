// The Home composer keeps what the person typed when the app's intro draft lands late (stage-draft.ts).
// Run from apps/desktop:  pnpm exec tsx --test src/renderer/src/views/stage-draft.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { adoptDraft } from './stage-draft';

const ASK = 'build a palindrome html app that checks if a string is a palindrome';
const INTRO = '@rex introduce yourself. What can you do for this team?';

describe('adoptDraft', () => {
  test('a late intro seed never replaces what the person typed (live build f4f9c91a)', () => {
    assert.equal(adoptDraft(ASK, INTRO, true), ASK);
  });
  test('the intro seed fills an empty box, or one with only spaces', () => {
    assert.equal(adoptDraft('', INTRO, true), INTRO);
    assert.equal(adoptDraft('  \n', INTRO, true), INTRO);
  });
  test('a door draft the person chose (a playbook pill, New routine) replaces the box', () => {
    assert.equal(adoptDraft(ASK, 'Draft a week of posts', false), 'Draft a week of posts');
  });
  test('no draft handed over leaves the box alone', () => {
    assert.equal(adoptDraft(ASK, null, false), ASK);
    assert.equal(adoptDraft(ASK, undefined, true), ASK);
  });
});

describe('the wiring', () => {
  const stage = readFileSync(join(import.meta.dirname, 'NewChatStage.tsx'), 'utf8');
  const app = readFileSync(join(import.meta.dirname, '../App.tsx'), 'utf8');
  test('the stage adopts a handed draft through adoptDraft, with the seed flag', () => {
    assert.match(stage, /setDraft\(\(d\) => adoptDraft\(d, initialDraft, initialDraftSeed === true\)\)/);
  });
  test('the app marks the first-send intro as a seed', () => {
    assert.match(app, /initialDraftSeed=\{chatDraft === introDraft\}/);
  });
});
