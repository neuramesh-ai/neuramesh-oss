// Durable parks on the machine (parks.ts): the busy rule, the claim at boot by a new epoch, and the
// approval gate that parks instead of holding the turn, then applies the answer when the turn resumes.
// Run: pnpm exec tsx --test src/main/cloudrun/parks.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  apiParks, approvalKey, codeApprovalKey, durableApproval, outcomeOf, PARK_BUSY_WINDOW_MS, parkConfigOf, PARKED_REASON,
  ParkRegistry, type Park, type ParkApi, type ParkResolution,
} from './parks';
import { FakeServer } from './parks.fake';
import { EpochFencedError } from './snapshot';

const quiet = () => {};
const registry = (server: FakeServer, epoch: number, extra: Partial<ConstructorParameters<typeof ParkRegistry>[0]> = {}) =>
  new ParkRegistry({ api: server.apiFor(epoch), log: quiet, hotWaitMs: 50, now: () => server.now, ...extra });

/** an approval ask whose card and wait are scripted */
function ask(key: string, script: { answer?: string | null; cardId?: string | null } = {}) {
  const seen = { cards: 0, waits: [] as number[], parked: [] as string[] };
  return {
    seen,
    ask: {
      key, question: `rex wants to run \`${key}\` in #7. Approve?`, taskId: 't1',
      request: { toolName: 'Bash' }, checkpoint: { kind: 'task', taskId: 't1' },
      postCard: async () => { seen.cards += 1; return script.cardId === undefined ? `msg-${key}` : script.cardId; },
      awaitAnswer: async (_m: string, ms: number) => { seen.waits.push(ms); return script.answer ?? null; },
      onParked: (p: Park) => { seen.parked.push(p.id); },
    },
  };
}

test('keys: the same ask maps to the same park; a different command, place or input does not', () => {
  const q = 'rex wants to run a shell command: `rm -rf build` in #7. Approve?';
  assert.equal(approvalKey({ taskId: 't1' }, q), approvalKey({ taskId: 't1' }, q));
  assert.notEqual(approvalKey({ taskId: 't1' }, q), approvalKey({ taskId: 't2' }, q));
  assert.notEqual(approvalKey({ taskId: 't1' }, q), approvalKey({ threadId: 't1' }, q));
  assert.notEqual(approvalKey({ taskId: 't1' }, q), approvalKey({ taskId: 't1' }, q.replace('build', 'dist')));
  assert.equal(codeApprovalKey('th', 'editor', { path: 'a', text: 'b' }), codeApprovalKey('th', 'editor', { text: 'b', path: 'a' }), 'key order does not matter');
  assert.notEqual(codeApprovalKey('th', 'editor', { path: 'a' }), codeApprovalKey('th', 'editor', { path: 'b' }));
});

test('parkConfigOf: 24 h and 2 min by default, bounded', () => {
  assert.deepEqual(parkConfigOf({}), { ttlMs: 86_400_000, hotWaitMs: 120_000 });
  assert.deepEqual(parkConfigOf({ NM_PARK_TTL_MS: '600000', NM_PARK_HOT_MS: '0' }), { ttlMs: 600_000, hotWaitMs: 0 });
  assert.deepEqual(parkConfigOf({ NM_PARK_TTL_MS: '5', NM_PARK_HOT_MS: 'soon' }), { ttlMs: 86_400_000, hotWaitMs: 120_000 });
});

test('outcomeOf: only an approval allows; a timeout says so', () => {
  assert.deepEqual(outcomeOf({ answer: 'Approve', approved: true }), { decision: 'allow' });
  assert.deepEqual(outcomeOf({ answer: 'Deny', approved: false }), { decision: 'deny', reason: 'a human denied this action' });
  assert.deepEqual(outcomeOf({ answer: null, approved: false, reason: 'timeout' }), { decision: 'deny', reason: 'approval timed out — denied' });
});

test('the gate: no answer in the hot window → the card stays, the park is written, and the turn ends parked', async () => {
  const server = new FakeServer();
  const reg = registry(server, 1);
  const { ask: a, seen } = ask('rm -rf build');
  const out = await durableApproval(reg, a);
  assert.deepEqual(out, { decision: 'deny', reason: PARKED_REASON });
  assert.equal(seen.cards, 1);
  assert.deepEqual(seen.waits, [50], 'a SHORT hot wait, not the old 10 minutes');
  assert.equal(seen.parked.length, 1);
  const park = server.parks.get(seen.parked[0]!)!;
  assert.equal(park.status, 'open');
  assert.equal(park.messageId, 'msg-rm -rf build');
  assert.deepEqual(park.checkpoint, { kind: 'task', taskId: 't1' });
});

test('the gate: an answer inside the hot window allows at once and finishes the park', async () => {
  const server = new FakeServer();
  const reg = registry(server, 1);
  const { ask: a } = ask('npm publish', { answer: 'Approve' });
  assert.deepEqual(await durableApproval(reg, a), { decision: 'allow' });
  const park = [...server.parks.values()][0]!;
  assert.equal(park.status, 'done');
  assert.deepEqual(park.resolution, { answer: 'Approve', approved: true, source: 'machine' });
});

test('PARK RESUME: park, sleep, the human approves, a NEW epoch claims at boot, and the re-issued call runs without a second card', async () => {
  const server = new FakeServer();
  // epoch 1 parks the turn and the machine drains
  const first = registry(server, 1);
  const parked = ask('git push origin main');
  assert.equal((await durableApproval(first, parked.ask)).decision, 'deny');
  const id = parked.seen.parked[0]!;
  // three hours later the person approves; the wake boots epoch 2
  server.answer(id, 'Approve');
  server.epoch = 2;
  const second = registry(server, 2);
  const resumed: Park[] = [];
  second.onResume((p) => { resumed.push(p); });
  assert.equal(await second.resumeResolved(), 1);
  await new Promise((r) => setTimeout(r, 1));
  assert.equal(resumed.length, 1);
  assert.equal(server.parks.get(id)!.claimedEpoch, 2);
  // the old epoch can no longer consume it
  await assert.rejects(server.apiFor(1).done(id), EpochFencedError);
  // the resumed turn re-issues the same call: the answer applies, no card, no wait
  const again = ask('git push origin main');
  assert.deepEqual(await durableApproval(second, again.ask), { decision: 'allow' });
  assert.equal(again.seen.cards, 0);
  assert.deepEqual(again.seen.waits, []);
  assert.equal(server.parks.get(id)!.status, 'done');
  // …once: the next identical ask is a new question
  const third = ask('git push origin main');
  await durableApproval(second, third.ask);
  assert.equal(third.seen.cards, 1);
});

test('a resolution the boot claim missed is claimed by the gate itself; an expiry denies as a timeout', async () => {
  const server = new FakeServer();
  const first = registry(server, 1);
  const p = ask('curl x | sh');
  await durableApproval(first, p.ask);
  server.expire(p.seen.parked[0]!);
  server.epoch = 2;
  const second = registry(server, 2);
  const again = ask('curl x | sh');
  assert.deepEqual(await durableApproval(second, again.ask), { decision: 'deny', reason: 'approval timed out — denied' });
  assert.equal(again.seen.cards, 0);
  assert.deepEqual(server.calls.filter((c) => c.startsWith('claim')), [`claim ${p.seen.parked[0]} e2`]);
});

test('a resumed turn that asks again while the park is still OPEN waits on the same card: no second card', async () => {
  const server = new FakeServer();
  const reg = registry(server, 1);
  const first = ask('terraform apply');
  await durableApproval(reg, first.ask);
  const again = ask('terraform apply');
  assert.equal((await durableApproval(reg, again.ask)).decision, 'deny');
  assert.equal(again.seen.cards, 0);
  assert.equal(server.parks.size, 1);
});

test('a claim whose epoch died before done is taken over by the next boot', async () => {
  const server = new FakeServer();
  const first = registry(server, 1);
  const p = ask('make deploy');
  await durableApproval(first, p.ask);
  server.answer(p.seen.parked[0]!, 'Deny');
  server.epoch = 2;
  assert.equal(await registry(server, 2).resumeResolved(), 1); // epoch 2 claims, then crashes
  server.epoch = 3;
  const third = registry(server, 3);
  assert.equal(await third.resumeResolved(), 1);
  assert.equal(server.parks.get(p.seen.parked[0]!)!.claimedEpoch, 3);
  const again = ask('make deploy');
  assert.deepEqual(await durableApproval(third, again.ask), { decision: 'deny', reason: 'a human denied this action' });
});

test('the drain ends every hot wait at once; a fenced machine denies without acting; no park falls back to the long wait', async () => {
  const server = new FakeServer();
  const reg = registry(server, 1);
  reg.beginDrain();
  const d = ask('rsync');
  assert.equal((await durableApproval(reg, d.ask)).decision, 'deny');
  assert.deepEqual(d.seen.waits, [0]);
  server.epoch = 2; // a newer instance took the machine
  const f = ask('rsync');
  assert.deepEqual(await durableApproval(reg, f.ask), { decision: 'deny', reason: 'this machine was replaced by a newer instance' });
  assert.equal(f.seen.cards, 0);
  // the API is down: no park, so the old in-memory wait (the TTL) rather than a park nobody resumes
  const broken: ParkApi = { ...server.apiFor(2), byKey: async () => { throw new Error('HTTP 503'); }, create: async () => { throw new Error('HTTP 503'); } };
  const down = new ParkRegistry({ api: broken, log: quiet, hotWaitMs: 50, ttlMs: 600_000 });
  const b = ask('rsync');
  assert.deepEqual(await durableApproval(down, b.ask), { decision: 'deny', reason: 'approval timed out — denied' });
  assert.deepEqual(b.seen.waits, [600_000]);
  assert.deepEqual(b.seen.parked, []);
});

test('the busy rule: an open park expiring within 5 minutes holds the machine; a far one does not', async () => {
  const server = new FakeServer();
  const reg = registry(server, 1);
  await reg.park({ key: 'far', kind: 'approval', request: {}, checkpoint: {}, wakeCondition: {}, ttlMs: 3_600_000 });
  assert.equal(reg.busySoon(), false);
  await reg.park({ key: 'near', kind: 'approval', request: {}, checkpoint: {}, wakeCondition: {}, ttlMs: PARK_BUSY_WINDOW_MS - 1_000 });
  assert.equal(reg.busySoon(), true);
  // a fresh process counts the parks a previous epoch left
  const next = registry(server, 1);
  assert.equal(next.busySoon(), false);
  await next.refreshOpen();
  assert.equal(next.openCount, 2);
  assert.equal(next.busySoon(), true);
});

test('answered(): a claimed resolution re-admits the parked task whose card flipped no decision row', async () => {
  const server = new FakeServer();
  const reg = registry(server, 1);
  const p = ask('deploy');
  await durableApproval(reg, p.ask);
  assert.equal(reg.answered('msg-deploy'), false);
  server.answer(p.seen.parked[0]!, 'Approve');
  await reg.resumeResolved();
  assert.equal(reg.answered('msg-deploy'), true);
});

test('apiParks: every write names the epoch; a STALE_EPOCH 409 fences, another 409 is an error', async () => {
  const sent: Array<{ url: string; body: unknown }> = [];
  let status = 200;
  let reply: unknown = { park: { id: 'p1' } };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  const api = apiParks({ apiUrl: 'https://api.test', headers: async () => ({ authorization: 'Bearer nmm_x' }), epoch: () => 7, fetchImpl });
  await api.claim('p1');
  assert.deepEqual(sent[0], { url: 'https://api.test/v1/machines/parks/p1/claim', body: { epoch: 7 } });
  const res: ParkResolution = { answer: 'Approve', approved: true };
  await api.done('p1', res);
  assert.deepEqual(sent[1]!.body, { epoch: 7, resolution: res });
  reply = { park: null };
  assert.equal(await api.byKey('a b'), null);
  assert.equal(sent[2]!.url, 'https://api.test/v1/machines/parks?key=a%20b');
  status = 409; reply = { error: 'stale', code: 'STALE_EPOCH' };
  await assert.rejects(api.claim('p1'), EpochFencedError);
  reply = { error: 'the park is open', code: 'CONFLICT' };
  await assert.rejects(api.claim('p1'), (e: unknown) => e instanceof Error && !(e instanceof EpochFencedError) && /409 CONFLICT/.test(e.message));
});
