import test from 'node:test';
import assert from 'node:assert/strict';
import { machineSyncCredentials } from './machined-credentials';
import type { MachinedConfig } from './machined-config';

const cfg: MachinedConfig = {
  machineToken: 'nmm_test', machineId: 'm1', workspaceId: 'w1', kind: 'runner', ownerUserId: 'u1',
  apiUrl: 'https://api.example.test', powersyncUrl: 'http://127.0.0.1:58081', stateDir: '/tmp/nm-test',
};

test('local machined sync signs the dev token without calling the cloud exchange', async () => {
  const out = await machineSyncCredentials(cfg, { NM_MACHINED_DEV_SYNC: '1' }, async () => {
    throw new Error('must not fetch');
  });
  assert.equal(out.endpoint, cfg.powersyncUrl);
  assert.match(out.token, /^eyJ/);
  assert.equal(out.expiresAt, undefined);
});

test('local machined sync refuses a non-loopback PowerSync endpoint', async () => {
  await assert.rejects(
    machineSyncCredentials({ ...cfg, powersyncUrl: 'https://sync.example.test' }, { NM_MACHINED_DEV_SYNC: '1' }),
    /only supports a loopback/,
  );
});

test('cloud machined sync exchanges the machine bearer', async () => {
  let authorization = '';
  const out = await machineSyncCredentials(cfg, {}, async (_url, init) => {
    authorization = new Headers(init?.headers).get('authorization') ?? '';
    return new Response(JSON.stringify({ token: 'rs-token', expiresInSeconds: 600 }), { status: 200 });
  });
  assert.equal(authorization, 'Bearer nmm_test');
  assert.equal(out.token, 'rs-token');
  assert.ok(out.expiresAt instanceof Date);
});
