// the url→workspace contract. the resolution is pure, so it gets real cases rather than a
// click-through: the interesting ones are all about a path that does NOT match a membership.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveWorkspace, slugFromPath } from './slugroute';

const acme = { id: 'w-acme', slug: 'acme' };
const nimbus = { id: 'w-nimbus', slug: 'nimbus-foundry' };
const mine = [acme, nimbus];

test('the first path segment is the slug; the root has none', () => {
  assert.equal(slugFromPath('/'), null);
  assert.equal(slugFromPath(''), null);
  assert.equal(slugFromPath('/acme'), 'acme');
  assert.equal(slugFromPath('/acme/board/1046'), 'acme'); // deeper routes still name the workspace
  assert.equal(slugFromPath('/nimbus%20foundry'), 'nimbus foundry'); // decoded, so odd slugs match
});

test('a slug the member belongs to wins over what they were last in', () => {
  assert.deepEqual(resolveWorkspace('/nimbus-foundry', mine, 'w-acme'), nimbus);
});

test('the root falls back to the stored workspace, then to the first membership', () => {
  assert.deepEqual(resolveWorkspace('/', mine, 'w-nimbus'), nimbus);
  assert.deepEqual(resolveWorkspace('/', mine, null), acme);
  assert.deepEqual(resolveWorkspace('/', mine, 'w-gone'), acme); // stale stored id
});

test("a slug the member cannot open lands them somewhere real, not in an error", () => {
  // someone else's workspace, or one they left: the url is a convenience, never an
  // authorization — resolution can only ever choose from what the server already served.
  assert.deepEqual(resolveWorkspace('/someone-elses', mine, 'w-nimbus'), nimbus);
  assert.deepEqual(resolveWorkspace('/someone-elses', mine, null), acme);
});

test('a member of nothing resolves to nothing (onboarding, not a crash)', () => {
  assert.equal(resolveWorkspace('/acme', [], null), null);
  assert.equal(resolveWorkspace('/', [], 'w-acme'), null);
});
