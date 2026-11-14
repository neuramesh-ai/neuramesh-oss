// The end-to-end park witness (e2e-park.ts) against the in-memory park server: open on the first boot,
// not busy while open (so an idle drain still sleeps), resumed by a later epoch after the human answers.
// Run: pnpm exec tsx --test src/main/cloudrun/e2e-park.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runParkProbe, type ParkProbeRecord } from './e2e-park';
import { ParkRegistry } from './parks';
import { FakeServer } from './parks.fake';

const instant = async () => {};
const boot = (server: FakeServer, epoch: number) => {
  server.epoch = epoch;
  return new ParkRegistry({ api: server.apiFor(epoch), log: () => {}, hotWaitMs: 20, now: () => server.now });
};
const read = (workDir: string): ParkProbeRecord => JSON.parse(readFileSync(join(workDir, '.nm-e2e', 'park.json'), 'utf8')) as ParkProbeRecord;

test('the witness: opened on boot 1, asleep while open, resumed by a new epoch with the human\'s answer, exactly once', async () => {
  const server = new FakeServer();
  const workDir = mkdtempSync(join(tmpdir(), 'nm-e2e-park-'));
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);

  // boot 1: one park through the production gate, recorded, and the turn ends parked
  const first = boot(server, 1);
  const opened = await runParkProbe({ workDir, registry: first, epoch: 1, log, sleep: instant });
  assert.equal(opened.step, 'opened');
  const rec = read(workDir);
  assert.equal(rec.openedEpoch, 1);
  assert.ok(rec.key.startsWith('e2e:park-witness:'));
  const park = server.parks.get(rec.parkId)!;
  assert.equal(park.status, 'open');
  assert.equal(park.kind, 'approval');
  assert.deepEqual(park.request, { tool: 'e2e.probe', reason: 'end-to-end park witness' });
  assert.ok(lines.includes(`[machined] e2e park opened ${rec.parkId}`));
  // a 24 h park is not busy: the idle drain still puts the machine to sleep
  assert.equal(first.busySoon(), false);

  // boot 2 (woken for something else): still open, nothing resumed, nothing re-asked
  const second = boot(server, 2);
  await second.refreshOpen();
  assert.equal(second.busySoon(), false);
  assert.deepEqual(await runParkProbe({ workDir, registry: second, epoch: 2, log, sleep: instant }), { step: 'waiting', parkId: rec.parkId });
  assert.equal(server.parks.size, 1);

  // the human approves while it sleeps; boot 3 claims at boot and the probe resumes it
  server.answer(rec.parkId, 'Approve');
  const third = boot(server, 3);
  assert.equal(await third.resumeResolved(), 1);
  const resumed = await runParkProbe({ workDir, registry: third, epoch: 3, log, sleep: instant });
  assert.deepEqual(resumed, { step: 'resumed', parkId: rec.parkId, resolution: 'approve', claimedEpoch: 3 });
  assert.equal(server.parks.get(rec.parkId)!.status, 'done');
  assert.equal(readFileSync(join(workDir, '.nm-e2e', 'parks.log'), 'utf8'), `parkId=${rec.parkId} resolution=approve claimedEpoch=3 openedEpoch=1\n`);
  assert.ok(lines.includes(`[machined] e2e park resumed ${rec.parkId} approve`));
  assert.equal(read(workDir).resolution, 'approve');

  // boot 4: the witness is written once
  assert.deepEqual(await runParkProbe({ workDir, registry: boot(server, 4), epoch: 4, log, sleep: instant }), { step: 'done', parkId: rec.parkId });
  assert.equal(readFileSync(join(workDir, '.nm-e2e', 'parks.log'), 'utf8').trim().split('\n').length, 1);
});

test('the witness: a denial, and a resolution the boot claim missed, resume the same way', async () => {
  const server = new FakeServer();
  const workDir = mkdtempSync(join(tmpdir(), 'nm-e2e-park-'));
  await runParkProbe({ workDir, registry: boot(server, 1), epoch: 1, log: () => {}, sleep: instant });
  const { parkId } = read(workDir);
  server.answer(parkId, 'Deny');
  // no resumeResolved: the probe's own lookup claims it for this epoch
  const out = await runParkProbe({ workDir, registry: boot(server, 2), epoch: 2, log: () => {}, sleep: instant });
  assert.deepEqual(out, { step: 'resumed', parkId, resolution: 'deny', claimedEpoch: 2 });
  assert.match(readFileSync(join(workDir, '.nm-e2e', 'parks.log'), 'utf8'), new RegExp(`^parkId=${parkId} resolution=deny claimedEpoch=2 openedEpoch=1\\n$`));
});

test('the witness: the hot wait is honoured and ends at once on a drain; a broken API fails loudly without a park file', async () => {
  const server = new FakeServer();
  const workDir = mkdtempSync(join(tmpdir(), 'nm-e2e-park-'));
  const reg = boot(server, 1);
  reg.beginDrain();
  const slept: number[] = [];
  const out = await runParkProbe({ workDir, registry: reg, epoch: 1, log: () => {}, sleep: async (ms) => { slept.push(ms); } });
  assert.equal(out.step, 'opened');
  assert.deepEqual(slept, [], 'a draining machine parks without waiting');

  const down = mkdtempSync(join(tmpdir(), 'nm-e2e-park-'));
  const broken = new ParkRegistry({ api: { ...server.apiFor(1), create: async () => { throw new Error('HTTP 503'); } }, log: () => {}, hotWaitMs: 0, ttlMs: 60_000 });
  const failed = await runParkProbe({ workDir: down, registry: broken, epoch: 1, log: () => {}, sleep: instant });
  assert.equal(failed.step, 'failed');
  assert.equal(existsSync(join(down, '.nm-e2e', 'park.json')), false, 'the next boot tries again');
});
