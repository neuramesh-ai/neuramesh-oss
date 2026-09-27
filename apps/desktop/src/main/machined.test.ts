import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heartbeatBody, imageShaOf, readConfig } from './machined-config';

const full = {
  NM_MACHINE_TOKEN: 'nmm_abc',
  NM_MACHINE_ID: 'm1',
  NM_WORKSPACE_ID: 'ws1',
  NM_OWNER_USER_ID: 'u1',
  NM_POWERSYNC_URL: 'https://ps.example',
};

test('readConfig fills defaults and passes through identity', () => {
  const cfg = readConfig(full);
  assert.equal(cfg.kind, 'runner');
  assert.equal(cfg.apiUrl, 'https://api.neuramesh.app');
  assert.equal(cfg.stateDir, '/nm/state');
  assert.equal(cfg.machineId, 'm1');
});

test('readConfig refuses a half-identity, loudly', () => {
  assert.throws(() => readConfig({ ...full, NM_MACHINE_TOKEN: undefined }), /NM_MACHINE_TOKEN/);
  assert.throws(() => readConfig({ ...full, NM_POWERSYNC_URL: undefined }), /NM_POWERSYNC_URL/);
});

test('readConfig refuses the unprovisioned placeholder and non-machine tokens', () => {
  assert.throws(() => readConfig({ ...full, NM_MACHINE_TOKEN: 'unprovisioned' }), /unprovisioned/);
  assert.throws(() => readConfig({ ...full, NM_MACHINE_TOKEN: 'sk-something' }), /not a machine token/);
});

const SHA = '1f455e231a192aa542dc402a031e6f6fd2830778';

test('imageShaOf: the image names its commit, and only a full commit sha counts', () => {
  assert.equal(imageShaOf({ NM_IMAGE_SHA: SHA }), SHA);
  assert.equal(imageShaOf({ NM_IMAGE_SHA: ` ${SHA}\n` }), SHA);
  // a local build bakes an empty value, and an older image has no variable at all
  assert.equal(imageShaOf({ NM_IMAGE_SHA: '' }), null);
  assert.equal(imageShaOf({}), null);
  // a short sha, a tag or a digest is not what the pin holds, so the machine does not claim it
  assert.equal(imageShaOf({ NM_IMAGE_SHA: SHA.slice(0, 12) }), null);
  assert.equal(imageShaOf({ NM_IMAGE_SHA: 'latest' }), null);
});

test('heartbeatBody: the beat carries the image sha as daemonVersion, and a beat with none keeps its old shape', () => {
  assert.deepEqual(heartbeatBody('m1', { activeSeconds: 5, busy: true, runtimes: ['claude-code'], imageSha: SHA }), {
    type: 'machine.heartbeat', machineId: 'm1', activeSeconds: 5, busy: true, runtimes: ['claude-code'], daemonVersion: SHA,
  });
  // an unnamed build sends exactly what every machine sent before, so the API sees no new field
  assert.deepEqual(heartbeatBody('m1', { activeSeconds: 0, busy: false, imageSha: null }), {
    type: 'machine.heartbeat', machineId: 'm1', activeSeconds: 0, busy: false,
  });
});
