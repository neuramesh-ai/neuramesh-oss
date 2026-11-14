// A held boot (cloudrun/boot.ts): nm-api's 409 PARKED (a ghost instance of a parked machine) and 409
// BOOT_LOOP (the crash-loop breaker is open) start nothing and never exit, because Cloud Run restarts
// an exited PID 1 at once. The boot waits for SIGTERM and asks again, so a wake that lands meanwhile
// still gets this instance. machined's main awaits this boot before it starts anything (machined.ts):
// a boot that has not resolved means no agent host, no box and no relay edge.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { bootCloudRunMachine, bootHoldPollMs, bootMachine, BOOT_HOLD_POLL_MS, holdUntilSigterm, parseBootGrant, type BootHold } from './boot';
import { e2eBootThrowOn } from '../machined-e2e';

const GRANT = { epoch: 8, token: 'nmm_epoch8', expiresAt: '2026-10-30T12:15:00.000Z' };
const CRED = `nmb_${'cd34'.repeat(16)}`;
const refusal = (code: string) => new Response(JSON.stringify({ error: 'held', code }), { status: 409, headers: { 'content-type': 'application/json' } });

function scripted(answers: Array<Response | Error>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test('409 PARKED holds: nothing resolves, it asks again at the hold cadence, and a wake that lands lets it boot', async () => {
  const { calls, fetchImpl } = scripted([refusal('PARKED'), refusal('PARKED'), refusal('PARKED'), new Response(JSON.stringify(GRANT), { status: 200 })]);
  const sleeps: number[] = [];
  const holds: Array<BootHold | null> = [];
  const lines: string[] = [];
  const g = await bootMachine('https://api.test', CRED, {
    fetch: fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, log: (l) => lines.push(l), holdPollMs: 20_000, onHold: (h) => holds.push(h),
  });
  assert.equal(g.epoch, 8);
  assert.equal(calls.length, 4);
  assert.deepEqual(sleeps, [20_000, 20_000, 20_000], 'a held boot polls at its own cadence, not the outage backoff');
  assert.deepEqual(holds, ['PARKED', null], 'SIGTERM is armed once while held and dropped when the grant comes');
  assert.equal(lines.filter((l) => l.includes('held (409 PARKED)')).length, 1, 'the hold is said once, not at every poll');
  assert.ok(lines.some((l) => l.includes('no longer held (PARKED); epoch 8')));
});

test('409 BOOT_LOOP holds and never exits on its own: the boot stays unresolved through every poll', async () => {
  const { calls, fetchImpl } = scripted(Array.from({ length: 5 }, () => refusal('BOOT_LOOP')));
  const holds: Array<BootHold | null> = [];
  const lines: string[] = [];
  await assert.rejects(
    bootMachine('https://api.test', CRED, { fetch: fetchImpl, sleep: async () => {}, log: (l) => lines.push(l), maxAttempts: 5, onHold: (h) => holds.push(h) }),
    /still held \(BOOT_LOOP\) after 5 attempts/,
  );
  assert.equal(calls.length, 5);
  assert.deepEqual(holds, ['BOOT_LOOP']);
  assert.ok(lines[0]!.includes('held (409 BOOT_LOOP)'));
});

test('a held boot does not hand the env a grant: bootCloudRunMachine stays pending, so machined starts nothing', async () => {
  const env: Record<string, string | undefined> = { NM_BOOT_CREDENTIAL: CRED, NM_API_URL: 'https://api.test' };
  let polls = 0;
  let release: () => void = () => {};
  const parked = new Promise<void>((r) => { release = r; });
  const fetchImpl = (async () => { polls += 1; if (polls === 3) release(); return refusal('PARKED'); }) as typeof fetch;
  let resolved = false;
  const boot = bootCloudRunMachine(env, { fetch: fetchImpl, sleep: async () => { await new Promise((r) => setImmediate(r)); }, log: () => {}, maxAttempts: 6 })
    .then(() => { resolved = true; }, () => {});
  await parked;
  assert.equal(resolved, false, 'still held after three polls');
  assert.equal(env['NM_MACHINE_TOKEN'], undefined, 'no token: no /v1 caller, no agent host, no relay edge can start');
  assert.equal(env['NM_BOOT_CREDENTIAL'], undefined, 'the credential already left the env');
  await boot;
});

test('a 409 that is not a hold (an old nm-api, a race) is an outage: the backoff retries it', async () => {
  const { calls, fetchImpl } = scripted([new Response('{"code":"CONFLICT"}', { status: 409 }), new Response('not json', { status: 409 }), new Response(JSON.stringify(GRANT), { status: 200 })]);
  const holds: Array<BootHold | null> = [];
  const sleeps: number[] = [];
  const g = await bootMachine('https://api.test', CRED, { fetch: fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, log: () => {}, onHold: (h) => holds.push(h) });
  assert.equal(g.epoch, 8);
  assert.equal(calls.length, 3);
  assert.deepEqual(holds, []);
  assert.deepEqual(sleeps, [1_000, 2_000]);
});

test('holdUntilSigterm: PID 1 has no default SIGTERM, so a held boot exits 0 on it, and the handler leaves once booted', () => {
  const proc = new EventEmitter() as EventEmitter & { exit: (code?: number) => never };
  const exits: number[] = [];
  proc.exit = ((code?: number) => { exits.push(code ?? 0); }) as (code?: number) => never;
  const lines: string[] = [];
  const onHold = holdUntilSigterm(proc as unknown as Pick<NodeJS.Process, 'on' | 'off' | 'exit'>, (l) => lines.push(l));
  onHold('PARKED');
  onHold('BOOT_LOOP');
  assert.equal(proc.listenerCount('SIGTERM'), 1, 'armed once');
  proc.emit('SIGTERM');
  assert.deepEqual(exits, [0]);
  assert.ok(lines[0]!.includes('SIGTERM while held'));
  onHold(null);
  assert.equal(proc.listenerCount('SIGTERM'), 0, 'machined installs its own drain-aware handler after the grant');
});

test('the hold cadence knob: NM_BOOT_HOLD_POLL_MS, 30 s by default, bounded', () => {
  assert.equal(bootHoldPollMs({}), BOOT_HOLD_POLL_MS);
  assert.equal(bootHoldPollMs({ NM_BOOT_HOLD_POLL_MS: '5000' }), 5_000);
  assert.equal(bootHoldPollMs({ NM_BOOT_HOLD_POLL_MS: '10' }), BOOT_HOLD_POLL_MS);
  assert.equal(bootHoldPollMs({ NM_BOOT_HOLD_POLL_MS: 'soon' }), BOOT_HOLD_POLL_MS);
});

test('the e2e boot throw: a grant flag counts only on a sandbox machine (NM_E2E_MARKER=1); the env knob always', () => {
  const flagged = parseBootGrant({ ...GRANT, e2e: { bootThrow: true } });
  assert.equal(flagged.e2eBootThrow, true);
  assert.equal(parseBootGrant(GRANT).e2eBootThrow, undefined);
  assert.equal(e2eBootThrowOn({}, flagged), false, 'a real machine ignores a flag it was sent');
  assert.equal(e2eBootThrowOn({ NM_E2E_MARKER: '1' }, flagged), true);
  assert.equal(e2eBootThrowOn({ NM_E2E_MARKER: '1' }, parseBootGrant(GRANT)), false);
  assert.equal(e2eBootThrowOn({ NM_E2E_BOOT_THROW: '1' }, parseBootGrant(GRANT)), true);
});

test('an incompatible snapshot reader holds without getting a token or starting the machine', async () => {
 const {fetchImpl}=scripted([refusal('SNAPSHOT_READER_REQUIRED'),new Response(JSON.stringify(GRANT),{status:200})]);
 const holds:Array<BootHold|null>=[];
 const grant=await bootMachine('https://api.test',CRED,{fetch:fetchImpl,sleep:async()=>{},log:()=>{},onHold:h=>holds.push(h)});
 assert.equal(grant.epoch,GRANT.epoch);assert.deepEqual(holds,['SNAPSHOT_READER_REQUIRED',null]);
});
