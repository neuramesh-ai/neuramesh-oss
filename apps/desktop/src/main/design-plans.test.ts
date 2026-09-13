// renderer design/plans.ts (track A2). The block splitter is what the plan-review overlay
// anchors comments against — a mis-split silently re-anchors every comment after it — and it
// had no test at all while living inside App.tsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPlanBlocks, parsePlanAlert, pickPlans, pickShipPlans, pickDesigns, themedMockupDoc, designMockupLabel } from '../renderer/src/design/plans';

test('splitPlanBlocks splits on blank lines and keeps fenced code whole', () => {
  assert.deepEqual(splitPlanBlocks('# Title\n\nOne\n\nTwo'), ['# Title', 'One', 'Two']);
  const fenced = '## Step\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter';
  // the blank line INSIDE the fence must not split the code block — that is the load-bearing case
  assert.deepEqual(splitPlanBlocks(fenced), ['## Step', '```ts\nconst a = 1;\n\nconst b = 2;\n```', 'After']);
  assert.deepEqual(splitPlanBlocks('\n\n   \n'), [], 'whitespace-only input yields no blocks');
});

test('parsePlanAlert reads GitHub callouts and strips the quote markers', () => {
  const a = parsePlanAlert('> [!IMPORTANT]\n> assume the FSM is unchanged\n> and the trigger stays');
  assert.deepEqual(a, { type: 'IMPORTANT', body: 'assume the FSM is unchanged\nand the trigger stays' });
  assert.equal(parsePlanAlert('> just a quote'), null);
  assert.equal(parsePlanAlert('plain text'), null);
  assert.equal(parsePlanAlert('> [!note]\n> lowercase tag')?.type, 'NOTE', 'the tag is case-insensitive, the type is normalized');
});

test('pickPlans / pickShipPlans sort newest-first and ignore everything else', () => {
  const arts = [{ name: 'implementation-plan-v1.md' }, { name: 'implementation-plan-v3.md' },
                { name: 'implementation-plan-v2.md' }, { name: 'notes.md' }, { name: 'ship-plan-v2.md' }];
  const plans = pickPlans(arts);
  assert.deepEqual(plans.all.map((a) => a.name), ['implementation-plan-v3.md', 'implementation-plan-v2.md', 'implementation-plan-v1.md']);
  assert.equal(plans.latest?.name, 'implementation-plan-v3.md');
  assert.equal(pickShipPlans(arts).latest?.name, 'ship-plan-v2.md', 'ship plans are a separate series');
  assert.equal(pickPlans([{ name: 'readme.md' }]).latest, undefined);
});

test('pickDesigns takes kind OR the versioned name, and reports the latest round', () => {
  const arts = [{ name: 'design-mockup-v1-hero.html', kind: 'file' }, { name: 'design-mockup-v2-hero.html', kind: 'file' },
                { name: 'moodboard.png', kind: 'design' }, { name: 'plan.md', kind: 'file' }];
  const d = pickDesigns(arts);
  assert.equal(d.all.length, 3, 'a kind=design row counts even without the version prefix');
  assert.equal(d.latestRound, 2);
  assert.equal(pickDesigns([{ name: 'x.md', kind: 'file' }]).latestRound, 0);
});

test('themedMockupDoc forces data-theme, injecting the document when there is none', () => {
  // mode is passed explicitly — the no-arg branch reads document.documentElement (browser only)
  assert.match(themedMockupDoc('<html data-theme="dark"><body>x</body></html>', 'light'), /data-theme="light"/);
  assert.match(themedMockupDoc('<html><body>x</body></html>', 'dark'), /<html data-theme="dark"/);
  const bare = themedMockupDoc('<p>fragment</p>', 'light');
  assert.match(bare, /^<!doctype html><html data-theme="light">/);
  assert.match(bare, /<p>fragment<\/p>/);
});

test('designMockupLabel humanizes the file name', () => {
  assert.equal(designMockupLabel('design-mockup-v2-pricing-page.html'), 'Pricing Page');
  assert.equal(designMockupLabel('design-mockup-v1-.html'), 'Design direction', 'an empty label falls back');
});
