// The card's reading of a row: caption, script, or both. Run from apps/desktop:
// pnpm exec tsx --test src/renderer/src/marketing/cardparts.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardParts, filmFacts, filmFile, filmingOn, isScript } from './cardparts';

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

const CATALOG = { served: true, tier: 'starter', tiers: [{ tier: 'starter', label: 'NeuraMesh Video Starter', model: 'Seedance 2.0', seconds: 8, credits: 194 }, { tier: 'xpress', label: 'NeuraMesh Video Xpress', model: 'MiniMax H3', seconds: 8, credits: 48 }] };

test('the facts line: the tier and the price before a film, the record after, the own key named, nothing when nothing is known', () => {
  assert.deepEqual(filmFacts(null, CATALOG), ['NeuraMesh Video Starter', 'Seedance 2.0', '8 s', 'about 194 credits', '2 min']);
  assert.deepEqual(filmFacts({ video: { tier: 'starter', model: 'seedance-2.0-fast', seconds: 8, credits: 194, at: '2026-09-19T09:14:00.000Z' } }, CATALOG)!.slice(0, 4), ['NeuraMesh Video Starter', 'seedance-2.0-fast', '8 s', '194 credits']);
  assert.deepEqual(filmFacts({ video: { tier: 'own', model: 'gemini-omni-1.1-flash', seconds: 8, credits: 0, at: 'bad' } }, null), ['gemini-omni-1.1-flash', '8 s', 'your key', 'no credits']);
  assert.equal(filmFacts({ video_pending: true }, CATALOG), null);
  assert.equal(filmFacts(null, { served: false, tier: null, tiers: [] }), null);
  assert.equal(filmFacts(null, null), null);
  assert.equal(filmingOn(CATALOG), 'NeuraMesh Video Starter (Seedance 2.0)');
  assert.equal(filmingOn(null), 'the platform');
});


test('the film as a file: the bytes the card plays, named for the card, and nothing for a picture', () => {
  assert.deepEqual(filmFile('data:video/mp4;base64,AAAA', 'marketing-e-hook'), { name: 'marketing-e-hook.mp4', content: 'AAAA', base64: true });
  // the stem is a file name: no slashes, no spaces, no leading dashes, a 60-character cap
  assert.equal(filmFile('data:video/webm;base64,AAAA', ' growth / #12·b ')?.name, 'growth-12-b.webm');
  assert.equal(filmFile('data:video/quicktime;base64,AAAA', 'x'.repeat(80))?.name, `${'x'.repeat(60)}.mov`);
  assert.equal(filmFile('data:video/mp4;base64,AAAA', '///')?.name, 'film.mp4');
  // a picture, a remote URL and nothing at all hand over nothing
  assert.equal(filmFile('data:image/png;base64,AAAA', 'a'), null);
  assert.equal(filmFile('https://cdn.example/clip.mp4', 'a'), null);
  assert.equal(filmFile(null, 'a'), null);
});
