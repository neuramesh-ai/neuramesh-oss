import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloudRunConfigOf, heartbeatBody, imageShaOf, readConfig, substrateOf } from './machined-config';

const full = {
  NM_MACHINE_TOKEN: 'nmm_abc',
  NM_MACHINE_ID: 'm1',
  NM_WORKSPACE_ID: 'ws1',
  NM_OWNER_USER_ID: 'u1',
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
  assert.throws(() => readConfig({ ...full, NM_WORKSPACE_ID: undefined }), /NM_WORKSPACE_ID/);
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

test('heartbeatBody: the beat carries the image sha as daemonVersion, and always declares its permission support', () => {
  assert.deepEqual(heartbeatBody('m1', { activeSeconds: 5, busy: true, runtimes: ['claude-code'], imageSha: SHA }), {
    type: 'machine.heartbeat', permissionVersion: 1, machineId: 'm1', activeSeconds: 5, busy: true, runtimes: ['claude-code'], daemonVersion: SHA,
  });
  // An unnamed build can still enforce permissions.
  assert.deepEqual(heartbeatBody('m1', { activeSeconds: 0, busy: false, imageSha: null }), {
    type: 'machine.heartbeat', permissionVersion: 1, machineId: 'm1', activeSeconds: 0, busy: false,
  });
});

test('substrateOf: unset is the default machine, cloudrun is opt-in, anything else stops the boot', () => {
  assert.equal(substrateOf({}), 'default');
  assert.equal(substrateOf({ NM_SUBSTRATE: '' }), 'default');
  assert.equal(substrateOf({ NM_SUBSTRATE: 'cloudrun' }), 'cloudrun');
  assert.throws(() => substrateOf({ NM_SUBSTRATE: 'lambda' }), /not a substrate/);
});

test('cloudRunConfigOf: the brain lives in the work dir, the secrets outside it', () => {
  const cr = cloudRunConfigOf({});
  assert.equal(cr.root, '/nm');
  assert.equal(cr.workDir, '/nm/work');
  assert.equal(cr.brainDir, '/nm/work/brain');
  assert.equal(cr.secretsDir, '/nm/secrets');
  assert.equal(cr.guardPct, 90);
  assert.equal(cr.graceMs, 60_000);
  assert.equal(cr.zstdLevel, 3);
  assert.equal(cloudRunConfigOf({ NM_BRAIN: '/nm/work/b' }).brainDir, '/nm/work/b');
  assert.throws(() => cloudRunConfigOf({ NM_BRAIN: '/nm/state/brain' }), /outside \/nm\/work/);
  assert.throws(() => cloudRunConfigOf({ NM_BRAIN: '/nm/workshop' }), /outside/);
  assert.throws(() => cloudRunConfigOf({ NM_CLOUDRUN_SECRETS: '/nm/work/secrets' }), /inside/);
  assert.throws(() => cloudRunConfigOf({ NM_CLOUDRUN_WORK: 'a/b' }), /one directory/);
  assert.throws(() => cloudRunConfigOf({ NM_OOM_GUARD_PCT: '120' }), /NM_OOM_GUARD_PCT/);
  // grace plus snapshot must stay under the 180 s stop drain
  assert.equal(cloudRunConfigOf({ NM_DRAIN_GRACE_MS: '120000' }).graceMs, 120_000);
  assert.throws(() => cloudRunConfigOf({ NM_DRAIN_GRACE_MS: '120001' }), /NM_DRAIN_GRACE_MS/);
});
