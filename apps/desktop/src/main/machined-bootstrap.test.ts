import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootstrapIdentity, BootstrapRefused } from './machined-bootstrap';
import { adoptIdentity, bootstrapEnvOf, configFromBootstrap } from './machined-config';

const spare = { NM_POOL_TOKEN: 'pool', NM_POD_NAME: 'nm-machine-abc', NM_POD_UID: 'uid-1', NM_API_URL: 'http://api.test', NM_POWERSYNC_URL: 'https://ps.example' };
const identity = { machineId: 'm1', workspaceId: 'ws1', kind: 'runner', ownerUserId: 'u1', token: 'nmm_fresh' };
const noSleep = async () => {};
const quiet = () => {};
const respond = (status: number, body?: unknown): Response => ({ status, json: async () => body } as unknown as Response);

test('bootstrapEnvOf: a spare is the pool token + pod name + uid with NO machine token; anything else is not', () => {
  assert.deepEqual(bootstrapEnvOf(spare), { apiUrl: 'http://api.test', poolToken: 'pool', pod: 'nm-machine-abc', uid: 'uid-1' });
  assert.equal(bootstrapEnvOf({ ...spare, NM_MACHINE_TOKEN: 'nmm_x' }), null); // a stamped machine boots as itself
  assert.equal(bootstrapEnvOf({ ...spare, NM_POD_UID: undefined }), null);
});

test('bootstrapIdentity: waits through 404s (unbound), then takes the identity', async () => {
  const answers = [respond(404, { code: 'UNBOUND' }), respond(404, { code: 'UNBOUND' }), respond(200, identity)];
  const bodies: string[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => { bodies.push(String(init?.body)); return answers.shift()!; }) as unknown as typeof fetch;
  const got = await bootstrapIdentity(bootstrapEnvOf(spare)!, { fetch: fetchImpl, sleep: noSleep, log: quiet });
  assert.deepEqual(got, identity);
  assert.equal(bodies.length, 3);
  assert.deepEqual(JSON.parse(bodies[0]!), { poolToken: 'pool', pod: 'nm-machine-abc', uid: 'uid-1' });
});

test('bootstrapIdentity: a refusal (wrong pool token) is fatal, never retried', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return respond(401, { code: 'POOL_TOKEN' }); }) as unknown as typeof fetch;
  await assert.rejects(bootstrapIdentity(bootstrapEnvOf(spare)!, { fetch: fetchImpl, sleep: noSleep, log: quiet }), BootstrapRefused);
  assert.equal(calls, 1);
});

test('bootstrapIdentity: an unreachable api and a 5xx are retried; maxPolls bounds it', async () => {
  const answers: (() => Response)[] = [() => { throw new Error('ECONNREFUSED'); }, () => respond(503), () => respond(200, identity)];
  const fetchImpl = (async () => answers.shift()!()) as unknown as typeof fetch;
  const got = await bootstrapIdentity(bootstrapEnvOf(spare)!, { fetch: fetchImpl, sleep: noSleep, log: quiet });
  assert.equal(got.token, 'nmm_fresh');
  const forever = (async () => respond(404)) as unknown as typeof fetch;
  await assert.rejects(bootstrapIdentity(bootstrapEnvOf(spare)!, { fetch: forever, sleep: noSleep, log: quiet, maxPolls: 3 }), /not bound after 3 polls/);
});

test('bootstrapIdentity: a 200 without a full identity is refused loudly', async () => {
  const fetchImpl = (async () => respond(200, { machineId: 'm1' })) as unknown as typeof fetch;
  await assert.rejects(bootstrapIdentity(bootstrapEnvOf(spare)!, { fetch: fetchImpl, sleep: noSleep, log: quiet }), /without a full identity/);
});

test('configFromBootstrap: the identity fills the env a StatefulSet would have stamped, and readConfig still checks it', () => {
  const cfg = configFromBootstrap(spare, identity);
  assert.equal(cfg.machineToken, 'nmm_fresh');
  assert.equal(cfg.machineId, 'm1');
  assert.equal(cfg.workspaceId, 'ws1');
  assert.equal(cfg.ownerUserId, 'u1');
  assert.equal(cfg.kind, 'runner');
  assert.equal(cfg.apiUrl, 'http://api.test');
  assert.throws(() => configFromBootstrap(spare, { ...identity, token: 'sk-nope' }), /not a machine token/);
});

test('adoptIdentity: a bound spare becomes a stamped machine, environment included, so its agent host sends the machine bearer', () => {
  const env: Record<string, string | undefined> = { ...spare };
  const cfg = adoptIdentity(env, identity);
  assert.equal(cfg.machineToken, 'nmm_fresh');
  // the environment is where apiauth looks at call time: before this, only the config held it
  assert.equal(env['NM_MACHINE_TOKEN'], 'nmm_fresh');
  assert.equal(env['NM_MACHINE_ID'], 'm1');
  assert.equal(env['NM_WORKSPACE_ID'], 'ws1');
  assert.equal(env['NM_OWNER_USER_ID'], 'u1');
  assert.equal(bootstrapEnvOf(env), null); // it now reads as a stamped machine
  // a bad identity never lands in the environment
  const clean: Record<string, string | undefined> = { ...spare };
  assert.throws(() => adoptIdentity(clean, { ...identity, token: 'sk-nope' }), /not a machine token/);
  assert.equal(clean['NM_MACHINE_TOKEN'], undefined);
});
