import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from './machined-config';

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
