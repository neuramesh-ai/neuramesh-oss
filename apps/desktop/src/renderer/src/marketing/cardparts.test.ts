// The card's reading of a row: caption, script, or both. Run from apps/desktop:
// pnpm exec tsx --test src/renderer/src/marketing/cardparts.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardParts, isScript } from './cardparts';

const SCRIPT = '[0:00-0:03] HOOK, phone in hand\nSpoken: "My laptop is in my bag."\n[0:03-0:08] the app on screen';

test('a video post: the caption posts, the script beside it films', () => {
  assert.deepEqual(cardParts('Three things in the new update. #neuramesh', { script: SCRIPT, brief: 'phone in hand' }), { caption: 'Three things in the new update. #neuramesh', script: SCRIPT });
});

test('a draft from before the script field: a timestamped body IS the script, with no caption', () => {
  assert.equal(isScript(SCRIPT), true);
  assert.deepEqual(cardParts(SCRIPT, { brief: 'x' }), { caption: null, script: SCRIPT });
});

test('a plain post: the body is the caption and there is nothing to film', () => {
  assert.equal(isScript('[0:00-0:03] one beat only'), false);
  assert.deepEqual(cardParts('Ship on Friday.', null), { caption: 'Ship on Friday.', script: null });
});
