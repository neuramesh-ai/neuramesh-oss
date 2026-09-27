// The surface classifier (scripts/impact.mjs): which clients a change reaches, so the right
// end-to-end check runs before it ships. Run: node --test scripts/impact.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, hqOnly, SURFACES } from './impact.mjs';

const on = (r) => SURFACES.filter((s) => r.surfaces[s]);

test('hq is the browser, the desktop renderer is the desktop, and the daemon is the desktop AND every cloud machine', () => {
  assert.deepEqual(on(classify(['apps/hq/web/webnm-local.ts'])), ['web']);
  assert.deepEqual(on(classify(['apps/desktop/src/renderer/src/App.tsx'])), ['desktop']);
  assert.deepEqual(on(classify(['apps/desktop/src/main/host/brandnote.ts'])), ['desktop', 'cloud']);
  assert.deepEqual(on(classify(['apps/desktop/src/preload/index.ts'])), ['desktop']);
});

test('a shared package reaches every surface; client-core every client; the lockfile everything', () => {
  assert.deepEqual(on(classify(['packages/shared/src/compute.ts'])), SURFACES);
  assert.deepEqual(on(classify(['packages/client-core/src/schema.ts'])), ['web', 'desktop', 'mobile', 'cloud']);
  assert.deepEqual(on(classify(['pnpm-lock.yaml'])), SURFACES);
});

test('the server, the phone, the machine image and the fleet each name their own surface', () => {
  assert.deepEqual(on(classify(['packages/control-api/src/app.ts', 'supabase/migrations/0141_x.sql'])), ['api']);
  assert.deepEqual(on(classify(['apps/mobile/src/App.tsx'])), ['mobile']);
  assert.deepEqual(on(classify(['infra/images/machine/Dockerfile'])), ['cloud']);
  assert.deepEqual(on(classify(['packages/fleet/src/reconcile.ts'])), ['cloud']);
});

test('docs, evidence, tests and the memory never implicate a surface, and an empty diff touches none', () => {
  const r = classify(['docs/10-model-packs.md', 'CLAUDE.md', 'docs/design/x/evidence/shot.png', 'apps/desktop/src/main/host/brandnote.test.ts', '.claude/launch.json']);
  assert.deepEqual(on(r), []);
  assert.deepEqual(on(classify([])), []);
});

test('the answer says which path implicated each surface, first match kept', () => {
  const r = classify(['docs/x.md', 'apps/web/src/copy.ts', 'apps/desktop/src/renderer/src/App.tsx']);
  assert.equal(r.why.web, 'apps/web/src/copy.ts');
  assert.equal(r.why.desktop, 'apps/desktop/src/renderer/src/App.tsx');
  assert.equal(r.why.mobile, null);
});

test('a change to the checks themselves re-runs everything', () => {
  assert.deepEqual(on(classify(['.github/workflows/surface-e2e.yml'])), SURFACES);
  assert.deepEqual(on(classify(['scripts/web-boot-e2e.mjs'])), ['web']);
});

test('a hq-only change is apps/hq/ plus evidence, and anything else keeps the whole run (ci.yml scope)', () => {
  assert.equal(hqOnly(['apps/hq/src/App.tsx', 'apps/hq/web/webnm.test.ts']), true);
  assert.equal(hqOnly(['apps/hq/src/App.tsx', 'docs/design/desktop-decoupling-2026-09/evidence/phase3/after/home-dark.png']), true);
  // a doc, a root file or another package can feed a desktop suite
  assert.equal(hqOnly(['apps/hq/src/App.tsx', 'docs/45-feature-placement.md']), false);
  assert.equal(hqOnly(['apps/hq/src/App.tsx', 'lint-ratchet.json']), false);
  assert.equal(hqOnly(['apps/hq/src/App.tsx', 'packages/shared/src/compute.ts']), false);
  assert.equal(hqOnly(['apps/hq/src/App.tsx', 'apps/desktop/src/renderer/src/App.tsx']), false);
  // evidence alone, or nothing, is not a hq change
  assert.equal(hqOnly(['docs/design/x/evidence/shot.png']), false);
  assert.equal(hqOnly([]), false);
  // a sibling folder whose name starts the same is not hq
  assert.equal(hqOnly(['apps/hqx/a.ts']), false);
});
