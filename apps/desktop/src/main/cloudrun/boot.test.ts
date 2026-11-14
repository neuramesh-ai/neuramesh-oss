import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootCloudRunMachine, bootMachine, BootRefused, grantEnv, parseBootGrant, renewDelayMs, TokenRenewal } from './boot';

const GRANT = { epoch: 7, token: 'nmm_epoch7', expiresAt: '2026-10-23T12:15:00.000Z', snapshot: { work: 'work-e6', box: 'box-e6' }, sizeClass: 'M', guardPct: 85 };
const quiet = { sleep: async () => {}, log: () => {} };
const CRED = `nmb_${'ab12'.repeat(16)}`;

test('parseBootGrant: epoch, epoch-bound machine token, snapshot keys, size and guard', () => {
  const g = parseBootGrant({ ...GRANT, machineId: 'm1' });
  assert.equal(g.epoch, 7);
  assert.equal(g.token, 'nmm_epoch7');
  assert.equal(g.expiresAt?.toISOString(), GRANT.expiresAt);
  assert.deepEqual(g.snapshot, { work: 'work-e6', box: 'box-e6' });
  assert.equal(g.sizeClass, 'M');
  assert.equal(parseBootGrant({ epoch: 1, token: 'nmm_x', sizeClass: 'small' }).sizeClass, null, 'only S, M, L and XL are sizes');
  assert.equal(g.guardPct, 85);
  assert.deepEqual(g.identity, { machineId: 'm1' });
  assert.equal(parseBootGrant({ epoch: 1, token: 'nmm_x' }).snapshot, null, 'a first boot has nothing to restore');
  assert.equal(parseBootGrant({ epoch: 1, token: 'nmm_x', guardPct: 140 }).guardPct, null);
});

test('parseBootGrant: no epoch or no machine token stops the boot', () => {
  assert.throws(() => parseBootGrant({ token: 'nmm_x' }), /epoch/);
  assert.throws(() => parseBootGrant({ epoch: 0, token: 'nmm_x' }), /epoch/);
  assert.throws(() => parseBootGrant({ epoch: 2, token: 'sk-x' }), /machine token/);
});

test('bootMachine: the credential goes to /v1/machines/boot only, and outages are retried', async () => {
  const calls: Array<{ url: string; auth: string | undefined }> = [];
  const answers: Array<Response | Error> = [new Error('ECONNREFUSED'), new Response('', { status: 503 }), new Response(JSON.stringify(GRANT), { status: 200 })];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: (init?.headers as Record<string, string>)['authorization'] });
    const next = answers.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  const g = await bootMachine('https://api.test', CRED, { fetch: fetchImpl, ...quiet });
  assert.equal(g.epoch, 7);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.url === 'https://api.test/v1/machines/boot' && c.auth === `Bearer ${CRED}`));
});

test('bootMachine: a refused credential is fatal, never retried', async () => {
  let n = 0;
  const fetchImpl = (async () => { n++; return new Response('', { status: 401 }); }) as typeof fetch;
  await assert.rejects(bootMachine('https://api.test', 'nmb_bad', { fetch: fetchImpl, ...quiet }), BootRefused);
  assert.equal(n, 1);
});

test('bootCloudRunMachine: the credential leaves the env and the grant fills it', async () => {
  const env: Record<string, string | undefined> = { NM_BOOT_CREDENTIAL: CRED, NM_API_URL: 'https://api.test', NM_MACHINE_ID: 'm1' };
  const fetchImpl = (async () => new Response(JSON.stringify(GRANT), { status: 200 })) as typeof fetch;
  const g = await bootCloudRunMachine(env, { fetch: fetchImpl, ...quiet });
  assert.equal(g.epoch, 7);
  assert.equal(env['NM_BOOT_CREDENTIAL'], undefined);
  assert.equal(env['NM_MACHINE_TOKEN'], 'nmm_epoch7');
  assert.equal(env['NM_MACHINE_ID'], 'm1');
  await assert.rejects(bootCloudRunMachine({}, { fetch: fetchImpl, ...quiet }), /NM_BOOT_CREDENTIAL is required/);
  const bad: Record<string, string | undefined> = { NM_BOOT_CREDENTIAL: 'nmb_short' };
  await assert.rejects(bootCloudRunMachine(bad, { fetch: (async () => { throw new Error('no call expected'); }) as typeof fetch, ...quiet }), /nmb_ and 64 hex/);
  assert.equal(bad['NM_BOOT_CREDENTIAL'], undefined, 'even a malformed credential leaves the env');
});

test('grantEnv: only the fields the grant carries', () => {
  assert.deepEqual(grantEnv(parseBootGrant({ epoch: 1, token: 'nmm_a', workspaceId: 'ws', kind: 'member' })), { NM_MACHINE_TOKEN: 'nmm_a', NM_WORKSPACE_ID: 'ws', NM_MACHINE_KIND: 'member' });
});

test('renewDelayMs: half the remaining life, at least 30 s', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  assert.equal(renewDelayMs(new Date(now + 15 * 60_000), now), 7.5 * 60_000);
  assert.equal(renewDelayMs(new Date(now + 10_000), now), 30_000);
  assert.equal(renewDelayMs(null, now), 10 * 60_000);
});

test('TokenRenewal: renews with the current token and epoch; a 409 fences', async () => {
  let token = 'nmm_epoch7';
  // nm-api extends the same token; a different one would be applied the same way
  const fenced: string[] = [];
  const seen: Array<{ url: string; auth: string | undefined; body: unknown }> = [];
  const answers = [new Response(JSON.stringify({ token: 'nmm_epoch7', expiresAt: '2026-10-23T12:30:00.000Z' }), { status: 200 }), new Response('', { status: 409 })];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), auth: (init?.headers as Record<string, string>)['authorization'], body: JSON.parse(String(init?.body)) });
    return answers.shift()!;
  }) as typeof fetch;
  const r = new TokenRenewal({ apiUrl: 'https://api.test', epoch: () => 7, token: () => token, expiresAt: null, apply: (t) => { token = t; }, onFenced: (why) => fenced.push(why), onRejected: () => assert.fail('no 401 here'), fetch: fetchImpl, log: () => {} });
  assert.equal(await r.renew(), true);
  assert.equal(token, 'nmm_epoch7');
  assert.deepEqual(seen[0], { url: 'https://api.test/v1/machines/token', auth: 'Bearer nmm_epoch7', body: { epoch: 7 } });
  assert.equal(await r.renew(), false);
  assert.equal(seen[1]!.auth, 'Bearer nmm_epoch7');
  assert.equal(fenced.length, 1);
  r.stop();
});

test('TokenRenewal: a 401 stops renewal and hands the verdict to the caller, never a 15 s retry loop', async () => {
  const rejected: string[] = [];
  let calls = 0;
  const fetchImpl = (async () => { calls++; return new Response('', { status: 401 }); }) as typeof fetch;
  const r = new TokenRenewal({ apiUrl: 'https://api.test', epoch: () => 7, token: () => 'nmm_epoch7', expiresAt: null, apply: () => assert.fail('nothing to apply'), onFenced: () => assert.fail('a 401 is not a 409'), onRejected: (why) => rejected.push(why), fetch: fetchImpl, log: () => {} });
  assert.equal(await r.renew(), false);
  assert.equal(rejected.length, 1);
  r.start();
  await new Promise((res) => setImmediate(res));
  assert.equal(calls, 1, 'a stopped renewal schedules nothing');
  r.stop();
});
