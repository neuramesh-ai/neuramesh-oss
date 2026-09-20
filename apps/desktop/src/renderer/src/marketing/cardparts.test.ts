// The card's reading of a row: caption, script, or both. Run from apps/desktop:
// pnpm exec tsx --test src/renderer/src/marketing/cardparts.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardParts, filmFacts, filmFile, filmSeconds, filmingOn, isScript } from './cardparts';

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

const CATALOG = { served: true, tier: 'starter', tiers: [{ tier: 'starter', label: 'NeuraMesh Video Starter', model: 'Seedance 2.0', seconds: 8, credits: 194, lengths: [5, 8, 10, 15], perSecondMicros: 241_900 }, { tier: 'xpress', label: 'NeuraMesh Video Xpress', model: 'MiniMax H3', seconds: 8, credits: 48 }] };

test('the length on the facts line (plan §8): the draft\'s pick priced by the door\'s own formula, held inside the tier\'s lengths, the default when it has none', () => {
  assert.deepEqual(filmFacts({ seconds: 15 }, CATALOG), ['NeuraMesh Video Starter', 'Seedance 2.0', '15 s', 'about 363 credits', '4 min']);
  assert.deepEqual(filmFacts({ seconds: 30 }, CATALOG)!.slice(2, 4), ['15 s', 'about 363 credits']); // 30 s on a 15 s tier: the door films 15, the card says 15
  assert.deepEqual(filmFacts({ seconds: 5 }, CATALOG)!.slice(2, 5), ['5 s', 'about 121 credits', '2 min']);
  assert.equal(filmSeconds(null, CATALOG.tiers[0]), 8);
  assert.equal(filmSeconds({ seconds: 12 }, CATALOG.tiers[1]), 12); // a tier without lengths takes the pick as it is
  assert.equal(filmSeconds({ seconds: 12 }, null), 12);
});

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

test('the frame on the facts line: named before the film, and after it whether the lane took it', () => {
  assert.deepEqual(filmFacts({ frame: 'App-Home.png' }, CATALOG)!.at(-1), 'frame · App-Home.png');
  assert.deepEqual(filmFacts({ video: { tier: 'starter', model: 'Seedance 2.0', seconds: 8, credits: 194, at: 'bad', frame: 'App-Home.png', frameUsed: true } }, CATALOG), ['NeuraMesh Video Starter', 'Seedance 2.0', '8 s', '194 credits', 'frame · App-Home.png']);
  assert.deepEqual(filmFacts({ video: { tier: 'xpress', model: 'MiniMax H3', seconds: 8, credits: 48, at: 'bad', frame: 'App-Home.png', frameUsed: false } }, CATALOG)!.at(-1), 'frame · App-Home.png · not used');
  assert.deepEqual(filmFacts({ video: { tier: 'starter', model: 'Seedance 2.0', seconds: 8, credits: 194, at: 'bad' } }, CATALOG), ['NeuraMesh Video Starter', 'Seedance 2.0', '8 s', '194 credits']);
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

test('the product shots on the facts line (plan §9): the script\'s SHOW images before the film, what landed after', () => {
  const script = '[0:00-0:03] Hook.\n[0:03-0:07] Cut to the app. SHOW: app-home.jpg\n[0:07-0:11] Close on pricing. SHOW: pricing.png';
  assert.equal(filmFacts({ seconds: 15 }, CATALOG, script)!.at(-1), 'product shot · app-home.jpg, pricing.png');
  assert.equal(filmFacts({ seconds: 15 }, CATALOG, '[0:00-0:03] Hook.')!.at(-1), '4 min');
  const v = { tier: 'starter', model: 'Seedance 2.0', seconds: 15, credits: 363, at: 'bad' };
  assert.equal(filmFacts({ video: { ...v, shots: { asked: 1, applied: 1 } } }, CATALOG)!.at(-1), 'product shot');
  assert.equal(filmFacts({ video: { ...v, shots: { asked: 2, applied: 2 } } }, CATALOG)!.at(-1), 'product shots · 2 of 2');
  assert.equal(filmFacts({ video: { ...v, shots: { asked: 1, applied: 0, why: 'not on the shelf: gone.png' } } }, CATALOG)!.at(-1), 'product shot · not applied · not on the shelf: gone.png');
  assert.deepEqual(filmFacts({ video: v }, CATALOG), ['NeuraMesh Video Starter', 'Seedance 2.0', '15 s', '363 credits']);
});
