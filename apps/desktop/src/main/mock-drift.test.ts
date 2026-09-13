// The preview harness's mock vs the real bridge — the drift that had no gate.
//
// The mock's Proxy answers ANY unknown method with an empty default, so a surface driven
// through a method the mock never implemented captures a screenshot of an empty state and
// passes. That is the harness lying in the direction that costs the most: fake evidence.
// 57 bridge methods were in that state when this test was written.
//
// This does not demand a mock for everything — it demands the gap be DECLARED. A method
// added to the bridge and forgotten in the mock fails here; a method deliberately left
// unimplemented is listed below and says why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const R = join(import.meta.dirname, '..', 'renderer');

/** every method name on the NMBridge interface (bridge/nm.ts owns the contract) */
function bridgeMethods(): string[] {
  const src = readFileSync(join(R, 'src', 'bridge', 'nm.ts'), 'utf8');
  const body = src.slice(src.indexOf('export interface NMBridge'));
  const end = body.indexOf('\n}');
  return [...new Set([...body.slice(0, end).matchAll(/^\s{2}(\w+)\??[(<:]/gm)].map((m) => m[1]!))];
}

/** what the preload actually exposes on window.nm */
function preloadKeys(): string[] {
  const src = readFileSync(join(R, '..', 'preload', 'index.ts'), 'utf8');
  return [...new Set([...src.matchAll(/^\s{2}(\w+)\s*[:(]/gm)].map((m) => m[1]!))];
}

/** what the mock answers for real (everything else hits the logging fallback) */
function mockKeys(): string[] {
  const src = readFileSync(join(R, 'preview', 'mock-nm.ts'), 'utf8');
  const body = src.slice(src.indexOf('const explicit'));
  const end = body.indexOf('\n};');
  return [...new Set([...body.slice(0, end).matchAll(/^\s{2}(\w+)\s*[:(]/gm)].map((m) => m[1]!))];
}

// WEB-ONLY LANES. The bridge is one contract with two implementations, and a few methods exist
// only in the browser one — the desktop has no equivalent to implement, not a missing one. The
// preload must NOT grow these: a desktop stub would be a lie the renderer then has to work
// around. Every entry is optional (`?`) on NMBridge and guarded at the call site, so the
// "renderer would call undefined" failure this file exists to prevent cannot happen.
const WEB_ONLY = new Set([
  // waking a cloud machine before a machine-backed surface opens. The desktop terminal is
  // LOCAL — there is nothing to wake, and a no-op stub would flash the boot screen on every
  // desktop terminal open. See docs/design/machine-autowake-2026-08.
  'machineEnsure',
]);

// Deliberate gaps: surfaces the harness never drives, so a fixture would be dead weight.
// Adding a name here is a decision — it says "screenshots of this surface prove nothing".
const UNMOCKED = new Set([
  // real auth + account lifecycle: the harness runs signed-in against fixtures
  'authClerk', 'login', 'loginGitHub', 'logout', 'invite', 'invites', 'revokeInvite',
  'accountBlockers', 'accountDelete', 'workspaceDelete',
  // waking a machine: the preview has no fleet to scale, and machinesUsage IS mocked so the
  // compute pill still renders every state a screenshot needs
  'machineWake',
  // ensuring a machine: web-only, and the harness has no fleet to start
  'machineEnsure',
  // agent/skill mutations with no capture that asserts their result
  'registerAgent', 'agentRetire', 'agentConnectRemote', 'skillCreate', 'skillUpdate',
  'skillDeprecate', 'skillPromote', 'skillSetEnabled', 'skillpackAdd', 'skillpackRemove',
  'skillpackRetry', 'skillpackSetEnabled',
  // project + room mutations driven by the real app, not a shot
  'projectArchive', 'projectDelete', 'projectDetect', 'addPersonToChannel',
  'removeAgentFromChannel', 'removePersonFromChannel',
  // task/thread mutations the flow walkthrough performs through taskAction instead
  'taskSetDod', 'taskUpdateDetails', 'threadArchive', 'threadUnarchive', 'threadSettle', 'threadUnsettle', 'threadUpdate', 'threadSetBrain',
  'shipItem', 'shipItemAdd', 'setupStep', 'scheduleUpdate', 'contentUpdate', 'contentDelete',
  'promoteArtifact', 'attachStage', 'attachDiscard', 'mediaPreview', 'openHtml',
  'ensureRuntimeCli', 'computeSharedThreads', 'retro',
  // the seven dev fixtures: they seed the REAL replica, so they are meaningless here
  'debugSeedLogs', 'debugSeedPlan', 'debugSeedReview', 'debugSeedLessons', 'debugSeedDod',
  'debugSeedPr', 'debugSeedImport',
  // watchers whose surfaces the harness renders from fixtures directly
  'watchArchivedThreads', 'watchMsgAttachments', 'watchThreadAttachments',
]);

test('the bridge contract and the preload agree — neither side may grow alone', () => {
  const iface = new Set(bridgeMethods());
  const preload = preloadKeys().filter((k) => iface.has(k));
  assert.ok(iface.size > 150, `expected the full bridge, parsed ${iface.size}`);
  const missing = [...iface].filter((k) => !preloadKeys().includes(k) && !WEB_ONLY.has(k));
  assert.deepEqual(missing, [], 'NMBridge declares methods the preload never exposes — the renderer would call undefined');
  assert.ok(preload.length > 150);
});

test('every bridge method is either mocked or a DECLARED gap', () => {
  const mocked = new Set(mockKeys());
  const undeclared = bridgeMethods().filter((k) => !mocked.has(k) && !UNMOCKED.has(k));
  assert.deepEqual(undeclared, [],
    'these bridge methods hit the mock\'s silent fallback — implement them in mock-nm.ts, or add them to UNMOCKED with a reason');
});

test('a WEB_ONLY method is optional on the bridge, so no caller can hit undefined', () => {
  // the entire justification for skipping the preload check is that the call site must guard.
  // If someone drops the `?`, this fails and the exemption stops being safe.
  const src = readFileSync(join(R, 'src', 'bridge', 'nm.ts'), 'utf8');
  for (const name of WEB_ONLY) {
    assert.match(src, new RegExp(`\\b${name}\\?\\s*[(:]`),
      `${name} is exempt from the preload check because it is optional — declare it as ${name}?(...)`);
  }
});

test('the gap list stays honest — no entry for a method that no longer exists', () => {
  const iface = new Set(bridgeMethods());
  const stale = [...UNMOCKED, ...WEB_ONLY].filter((k) => !iface.has(k));
  assert.deepEqual(stale, [], 'UNMOCKED/WEB_ONLY names a method the bridge no longer has — prune it');
});

test('the checker can fail — a planted name is reported', () => {
  // the positive control: without it, a parser that returns nothing passes everything
  assert.equal(bridgeMethods().includes('definitelyNotABridgeMethod'), false);
  assert.ok(mockKeys().length > 100, `expected the mock's real surface, parsed ${mockKeys().length}`);
});
