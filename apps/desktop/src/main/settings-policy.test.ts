// renderer settings/policy.ts + compute/prefs.ts (track A2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectorLabel, sameSelector, pathOfGlob, isProtectedPathRule, POLICY_GROUPS } from '../renderer/src/settings/policy';
import { parseComputePrefs } from '../renderer/src/compute/prefs';
import type { PolicyRule } from '@neuramesh/shared';

const rule = (over: Partial<PolicyRule> = {}): PolicyRule =>
  ({ capability: 'fs.read', verdict: 'deny', selector: { kind: 'path', glob: '**/.ssh/**' }, ...over }) as PolicyRule;

test('selectorLabel speaks each selector kind', () => {
  assert.equal(selectorLabel({ kind: 'path', glob: '**/.aws/**' } as PolicyRule['selector']), '**/.aws/**');
  assert.equal(selectorLabel({ kind: 'host', glob: '*.internal' } as PolicyRule['selector']), '*.internal');
  assert.equal(selectorLabel({ kind: 'tool', name: 'Bash' } as PolicyRule['selector']), 'Bash');
  assert.equal(selectorLabel({ kind: 'any' } as PolicyRule['selector']), 'any');
});

test('sameSelector matches on kind AND label — a path and a host that read alike are different rules', () => {
  const path = { kind: 'path', glob: 'x' } as PolicyRule['selector'];
  const host = { kind: 'host', glob: 'x' } as PolicyRule['selector'];
  assert.equal(sameSelector(path, { kind: 'path', glob: 'x' } as PolicyRule['selector']), true);
  assert.equal(sameSelector(path, host), false, 'same label, different kind — not the same rule');
});

test('pathOfGlob unwraps the **/…/** form the panel displays', () => {
  assert.equal(pathOfGlob('**/.ssh/**'), '.ssh');
  assert.equal(pathOfGlob('**/.netrc'), '.netrc', 'a file selector has no trailing /**');
  assert.equal(pathOfGlob('plain/path'), 'plain/path');
});

test('isProtectedPathRule is exactly fs.read + deny + a path selector', () => {
  assert.equal(isProtectedPathRule(rule()), true);
  assert.equal(isProtectedPathRule(rule({ verdict: 'ask' })), false);
  assert.equal(isProtectedPathRule(rule({ capability: 'fs.write' })), false);
  assert.equal(isProtectedPathRule(rule({ selector: { kind: 'host', glob: 'x' } as PolicyRule['selector'] })), false);
});

test('every policy group names real capabilities, and none is listed twice', () => {
  const caps = POLICY_GROUPS.flatMap((g) => g.caps);
  assert.equal(new Set(caps).size, caps.length, 'a capability in two groups would render twice');
  for (const c of caps) assert.match(c, /^[a-z]+\.[a-z]+$/);
});

test('parseComputePrefs: bad or absent jsonb degrades to unset, never throws', () => {
  assert.deepEqual(parseComputePrefs('{"machine":"m1"}'), { machine: 'm1' });
  assert.deepEqual(parseComputePrefs(null), {});
  assert.deepEqual(parseComputePrefs(undefined), {});
  assert.deepEqual(parseComputePrefs('not json'), {}, 'a corrupt row must not take the settings panel down');
});
