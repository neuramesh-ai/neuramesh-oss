// Every walkthrough step must have an anchor that still exists in the renderer source.
//
// This exists because the failure mode is SILENT and has now happened twice. A tour step whose
// `[data-tour="…"]` selector matches nothing used to skip itself while still counting toward the
// total, so the first-run walkthrough opened on "2 / 3" and showed a single card:
//   · `sect-channels` died when the channel list became the projects tree (caught late, 2026-08),
//   · `project` is rendered ONLY in the top dock, so it was missing in the default side dock,
//   · `sect-agents` died outright when the rail's sections collapsed into one.
//
// A source-text check, not a DOM one: this suite runs under node with no renderer. It cannot
// prove an anchor is VISIBLE in a given dock — visibleSteps() handles that at runtime — but it
// does catch the thing that actually bit us, which is an anchor being deleted or renamed while
// the step list kept referring to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendererSource } from './srcscan';

// the whole renderer tree: the modularization split moves components (and their data-tour
// anchors, and TOUR_STEPS itself) out of App.tsx, and an anchor is legal wherever it lands
const src = rendererSource(import.meta.dirname);

/** the keys listed in TOUR_STEPS, read from the source so the test cannot drift from it */
function tourKeys(): string[] {
  const block = /const TOUR_STEPS[\s\S]*?\n\];/.exec(src);
  assert.ok(block, 'TOUR_STEPS is still declared somewhere in the renderer');
  return [...block[0].matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1]!);
}

/** every data-tour value the renderer can render, including the `sect-${key}` template form */
function anchors(): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/data-tour=\{?["'`]([^"'`{}]+)["'`]/g)) out.add(m[1]!);
  // `data-tour={key}` / `data-tour={`sect-${key}`}` — dynamic, resolved from their own lists
  for (const m of src.matchAll(/data-tour=\{`sect-\$\{key\}`\}/g)) void m;
  return out;
}

test('the tour still has steps', () => {
  assert.ok(tourKeys().length > 0, 'TOUR_STEPS must not be empty');
});

test('every tour step anchors to a data-tour that exists in the renderer', () => {
  const anchored = anchors();
  // `board` and the other destination keys are rendered via data-tour={key} from a list — assert
  // those keys appear in a destination array rather than as a literal attribute.
  const dynamic = new Set<string>();
  for (const m of src.matchAll(/\[\s*'([a-z]+)',\s*Icon[A-Za-z]+,/g)) dynamic.add(m[1]!);

  const missing = tourKeys().filter((k) => !anchored.has(k) && !dynamic.has(k));
  assert.deepEqual(missing, [], `tour steps with no anchor in the renderer: ${missing.join(', ')}`);
});

test('the checker can fail — a bogus key is reported missing', () => {
  // the positive control. Without it, a matcher that accidentally accepts everything would let
  // this whole file pass while proving nothing (the audit-that-cannot-fail trap).
  const anchored = anchors();
  assert.equal(anchored.has('definitely-not-a-real-anchor'), false);
});

test('no tour step anchors to something rendered only in one dock position', () => {
  // `project` lived inside `{navPos === 'top' && (…)}` — present in the source, absent in the
  // default side dock, so the source-existence check above would have passed it. Guard the
  // specific keys we know are dock-gated.
  const DOCK_GATED = ['project', 'threads', 'mission'];
  const used = tourKeys().filter((k) => DOCK_GATED.includes(k));
  assert.deepEqual(used, [], `tour steps anchored to dock-gated elements: ${used.join(', ')}`);
});
