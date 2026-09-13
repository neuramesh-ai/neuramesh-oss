// Boot workspace identity: a cloud-mode boot must never act as the dev seed, and
// the replica may only be wiped on an AUTHORITATIVE identity change. Run from
// apps/desktop:  pnpm exec tsx --test src/main/wsident.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkspaceIdent, pickBootWorkspace, shouldWipeReplica, membershipChanged } from './wsident';

const DEV = { ws: 'a0000000-0000-0000-0000-00000000000a', info: { name: 'Acme Robotics', slug: 'acme' } };
const REAL = { id: 'b1111111-2222-3333-4444-555555555555', name: 'Alonge Dev', slug: 'alonge' };

test('parseWorkspaceIdent reads the full identity shape', () => {
  assert.deepEqual(parseWorkspaceIdent(JSON.stringify({ workspaceId: REAL.id, name: REAL.name, slug: REAL.slug })), {
    workspaceId: REAL.id,
    name: REAL.name,
    slug: REAL.slug,
  });
});

test('parseWorkspaceIdent tolerates the pre-identity marker shape', () => {
  assert.deepEqual(parseWorkspaceIdent(JSON.stringify({ workspaceId: REAL.id })), { workspaceId: REAL.id, name: undefined, slug: undefined });
});

test('parseWorkspaceIdent rejects garbage, empty and missing input', () => {
  assert.equal(parseWorkspaceIdent('not json'), null);
  assert.equal(parseWorkspaceIdent(JSON.stringify({ name: 'no id' })), null);
  assert.equal(parseWorkspaceIdent(JSON.stringify({ workspaceId: '' })), null);
  assert.equal(parseWorkspaceIdent(null), null);
  assert.equal(parseWorkspaceIdent(undefined), null);
});

test('resolution success picks the first workspace, authoritatively', () => {
  const pick = pickBootWorkspace({ resolved: [REAL], marker: null, current: DEV });
  assert.deepEqual(pick, { ws: REAL.id, info: { name: REAL.name, slug: REAL.slug }, authoritative: true, needsOnboarding: false });
});

test('resolution success with zero workspaces routes to onboarding', () => {
  const pick = pickBootWorkspace({ resolved: [], marker: { workspaceId: REAL.id }, current: DEV });
  assert.equal(pick.needsOnboarding, true);
  assert.equal(pick.authoritative, true);
});

test('resolution FAILURE falls back to the marker identity — never the dev seed (the 2026-07-10 phantom "Acme Robotics")', () => {
  const pick = pickBootWorkspace({
    resolved: null,
    marker: { workspaceId: REAL.id, name: REAL.name, slug: REAL.slug },
    current: DEV,
  });
  assert.equal(pick.ws, REAL.id);
  assert.deepEqual(pick.info, { name: REAL.name, slug: REAL.slug });
  assert.equal(pick.authoritative, false);
  assert.equal(pick.needsOnboarding, false);
});

test('resolution failure with an old-shape marker still keeps the id (blank display identity)', () => {
  const pick = pickBootWorkspace({ resolved: null, marker: { workspaceId: REAL.id }, current: DEV });
  assert.equal(pick.ws, REAL.id);
  assert.deepEqual(pick.info, { name: '', slug: '' });
  assert.equal(pick.authoritative, false);
});

test('resolution failure with no marker shows a neutral identity, not the dev seed name', () => {
  const pick = pickBootWorkspace({ resolved: null, marker: null, current: DEV });
  assert.equal(pick.ws, DEV.ws); // nothing better to bind to yet
  assert.deepEqual(pick.info, { name: '', slug: '' });
  assert.equal(pick.authoritative, false);
});

test('replica wipe requires an authoritative mismatch', () => {
  // the incident: unresolved boot (WS fell back to the dev id) + a real marker — must NOT wipe
  assert.equal(shouldWipeReplica(REAL.id, DEV.ws, false), false);
  // resolved and genuinely different (workspace deleted/recreated, other account) — wipe
  assert.equal(shouldWipeReplica(REAL.id, DEV.ws, true), true);
  // same workspace, resolved or not — never wipe
  assert.equal(shouldWipeReplica(REAL.id, REAL.id, true), false);
  assert.equal(shouldWipeReplica(REAL.id, REAL.id, false), false);
  // fresh replica (no marker) — nothing to wipe
  assert.equal(shouldWipeReplica(null, REAL.id, true), false);
});

// ── multi-workspace membership (0113) ────────────────────────────────────────
// The bug these lock down: /v1/workspaces orders by created_at, the pick was a flat
// `resolved[0]`, and the wipe rule only compared ids. So accepting an invitation to a
// workspace OLDER than your own silently moved you into it on the next boot AND wiped
// your local replica on the way.

const OTHER = { id: 'c9999999-8888-7777-6666-555555555555', name: 'Northwind', slug: 'northwind' };

test('a workspace you were INVITED to never displaces the one you were standing in', () => {
  // the invited workspace is FIRST in the list (it is older — created_at ordering)
  const pick = pickBootWorkspace({
    resolved: [OTHER, REAL],
    marker: { workspaceId: REAL.id, name: REAL.name, slug: REAL.slug },
    current: DEV,
  });
  assert.equal(pick.ws, REAL.id, 'must honour the marker, not the oldest workspace');
  assert.deepEqual(pick.info, { name: REAL.name, slug: REAL.slug });
  assert.equal(pick.authoritative, true);
});

test('switching between workspaces you belong to never wipes the replica', () => {
  // both stream into the one replica (the sync rules are plural), so this is a SCOPE change
  assert.equal(shouldWipeReplica(REAL.id, OTHER.id, true, [REAL.id, OTHER.id]), false);
  assert.equal(shouldWipeReplica(OTHER.id, REAL.id, true, [REAL.id, OTHER.id]), false);
});

test('a workspace you are no longer in DOES wipe — that is a real generation change', () => {
  // signed into a different account, or the workspace was deleted and recreated
  assert.equal(shouldWipeReplica(REAL.id, OTHER.id, true, [OTHER.id]), true);
  // and an unresolved boot still never wipes, membership set or not
  assert.equal(shouldWipeReplica(REAL.id, OTHER.id, false, [OTHER.id]), false);
});

test('no membership set (legacy caller) falls back to the old id comparison', () => {
  assert.equal(shouldWipeReplica(REAL.id, OTHER.id, true, undefined), true);
});

test('the marker is honoured only while it is still yours — otherwise [0]', () => {
  // left (or was removed from) the marker's workspace: fall back rather than binding to a
  // workspace the server says is not ours
  const pick = pickBootWorkspace({
    resolved: [OTHER],
    marker: { workspaceId: REAL.id, name: REAL.name, slug: REAL.slug },
    current: DEV,
  });
  assert.equal(pick.ws, OTHER.id);
  assert.equal(pick.needsOnboarding, false);
});

test('first ever boot (no marker) still takes the first workspace', () => {
  const pick = pickBootWorkspace({ resolved: [OTHER, REAL], marker: null, current: DEV });
  assert.equal(pick.ws, OTHER.id);
});

test('membershipChanged: only a real set difference counts', () => {
  // the bug it exists for: a workspace ARRIVES while the app is running
  assert.equal(membershipChanged(['a'], ['a', 'b']), true);
  assert.equal(membershipChanged(['a', 'b'], ['a']), true, 'removal must reconnect too — the buckets shrink');
  // …and the false positive that would reconnect the stream on every poll
  assert.equal(membershipChanged(['a', 'b'], ['b', 'a']), false, 'order is not a change');
  assert.equal(membershipChanged([], []), false);
  assert.equal(membershipChanged(['a'], ['a']), false);
  // a swap of equal size is still a change
  assert.equal(membershipChanged(['a'], ['b']), true);
});

// HAVING a workspace is not FINISHING one (2026-08-28). The browser mints its workspace at the
// wizard's FIRST step so the cloud machine can be provisioned against its id — which opened a
// window the old rule could not see: refresh at the brain step and you had a real, empty
// workspace, so "the list is non-empty, therefore you are done" dropped you into an app with no
// crew and no rooms. Reported from live use.
test('an unfinished workspace resumes onboarding instead of opening an empty app', () => {
  const half = { id: 'ws-half', name: 'Vertex Union', slug: 'vertex-union', onboarded: false };
  const pick = pickBootWorkspace({ resolved: [half], marker: null, current: { ws: 'ws-half', info: { name: '', slug: '' } } });
  assert.equal(pick.needsOnboarding, true);
  // and it carries the id, so the wizard continues that workspace rather than minting a second
  assert.equal(pick.resumeWorkspaceId, 'ws-half');
});

test('a finished workspace opens the app, and offers nothing to resume', () => {
  const done = { id: 'ws-done', name: 'Acme', slug: 'acme', onboarded: true };
  const pick = pickBootWorkspace({ resolved: [done], marker: null, current: { ws: 'ws-done', info: { name: '', slug: '' } } });
  assert.equal(pick.needsOnboarding, false);
  assert.equal(pick.resumeWorkspaceId, undefined);
});

test('a server that does not answer the question is read as FINISHED', () => {
  // `undefined` is an older control-api, not an unfinished workspace. guessing "unfinished" here
  // would eject every working user the moment they hit a stale deployment — the failure mode is
  // strictly worse than the bug this fixes.
  const quiet = { id: 'ws-old', name: 'Acme', slug: 'acme' };
  const pick = pickBootWorkspace({ resolved: [quiet], marker: null, current: { ws: 'ws-old', info: { name: '', slug: '' } } });
  assert.equal(pick.needsOnboarding, false);
  assert.equal(pick.resumeWorkspaceId, undefined);
});

test('a FIRST-EVER run resumes nothing — there is no workspace to carry on with', () => {
  // the trap this guards: the resolver still returns a `ws` here (the local id), and handing that
  // to the wizard as a resume id would make it skip the step that CREATES the workspace.
  const pick = pickBootWorkspace({ resolved: [], marker: null, current: { ws: 'ws-local-default', info: { name: '', slug: '' } } });
  assert.equal(pick.needsOnboarding, true);
  assert.equal(pick.resumeWorkspaceId, undefined);
});

test('an unfinished workspace the marker names is still the one resumed', () => {
  const other = { id: 'ws-other', name: 'Other', slug: 'other', onboarded: true };
  const half = { id: 'ws-half', name: 'Half', slug: 'half', onboarded: false };
  const pick = pickBootWorkspace({
    resolved: [other, half],
    marker: { workspaceId: 'ws-half', name: 'Half', slug: 'half' },
    current: { ws: 'ws-half', info: { name: '', slug: '' } },
  });
  assert.equal(pick.ws, 'ws-half');
  assert.equal(pick.needsOnboarding, true);
  assert.equal(pick.resumeWorkspaceId, 'ws-half');
});
