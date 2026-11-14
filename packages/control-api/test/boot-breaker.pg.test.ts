// THE BOOT GUARDS against the REAL schema (0158, fleet-cloudrun-breaker.ts, fleet-cloudrun-retention.ts):
//   · the crash-loop breaker: N boots with no `running` report, then 409 BOOT_LOOP, desired 0, the stamp,
//     and ONE notice as the machine's agent, the reply to the person's unanswered message
//   · only a PERSON's wake clears it, for exactly one more boot; an agent's message, a routine and the
//     sweep's re-wake leave it asleep
//   · a `running` report ends the streak
//   · the ghost boot: a parked machine (desired 0) gets 409 PARKED and no epoch
//   · snapshot retention with a fake GCS: the newest 3 epochs and the pointed-to key stay, the rest go
// Run via the pg lane (DATABASE_URL); skipped without it.
import type { Actor } from '@neuramesh/shared';
import { isSessionRunNotice } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { grantCredits } from '../src/credits';
import { createCloudMachine } from '../src/fleet';
import { cloudRunSweep } from '../src/fleet-cloudrun-sweep';
import { snapshotRetentionPass, type RetentionConfig } from '../src/fleet-cloudrun-retention';
import { bumpMachineWake } from '../src/fleet-lifecycle';
import type { SnapshotStorage } from '../src/gcs-sign';
import { mintMachineToken } from '../src/machine-auth';
import { snapshotPrefix } from '../src/machine-snapshots';
import { wakeMachine } from '../src/member-machines';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;

const ENV = { FLEET_SECRET: 'test-fleet-secret', FLEET_CLOUDRUN: '1', NM_ALLOW_ACTOR_HEADER: '1', NM_BOOT_LOOP_MAX: '3', NM_BOOT_LOOP_WINDOW_MIN: '30' } as const;
const saved: Record<string, string | undefined> = {};
const fleet = { authorization: 'Bearer test-fleet-secret', 'content-type': 'application/json' };
const asGeorge = { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) };
const tag = `breaker-${Date.now().toString(36)}`;

let WS = '';
let CHANNEL = '';
let MACHINE = '';
let AGENT = '';
let CREDENTIAL = '';
let ASKED = '';

const boot = (credential = CREDENTIAL) => app!.request('/v1/machines/boot', { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: '{}' });
const bootCode = async (): Promise<{ status: number; code: string | null; epoch: number | null; token: string | null }> => {
  const res = await boot();
  const body = (await res.json()) as { code?: string; epoch?: number; token?: string };
  return { status: res.status, code: body.code ?? null, epoch: body.epoch ?? null, token: body.token ?? null };
};
const row = async () => (await sql!`select epoch::int as epoch, desired_replicas, boot_streak, boot_streak_since, boot_loop_at, parked_at from machines where id = ${MACHINE}::uuid`)[0]!;
const notices = async () => sql!<{ id: string; body: string; reply_to: string | null; author_id: string; author_kind: string }[]>`
  select id, body, reply_to, author_id, author_kind from messages where workspace_id = ${WS}::uuid and author_kind = 'agent' order by created_at`;

beforeAll(async () => {
  if (!sql) return;
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  const made = (await (await app!.request('/v1/commands', { method: 'POST', headers: asGeorge, body: JSON.stringify({ type: 'workspace.create', name: `Breaker ${tag}`, slug: tag }) })).json()) as { workspaceId: string; channelId: string };
  WS = made.workspaceId; CHANNEL = made.channelId;
  await grantCredits(sql, WS, 100, 'manual', 'breaker test');
  MACHINE = (await createCloudMachine(sql, { workspaceId: WS, kind: 'runner', ownerUserId: george.id, name: `runner-${tag}`, tokenHash: mintMachineToken().hash, substrate: 'cloudrun' })).id;
  const [agent] = await sql<{ id: string }[]>`insert into agents (workspace_id, machine_id, name) values (${WS}::uuid, ${MACHINE}::uuid, ${`rex-${tag}`}) returning id`;
  AGENT = agent!.id;
  await sql`insert into agent_channels (agent_id, channel_id) values (${AGENT}::uuid, ${CHANNEL}::uuid)`;
  // the person's message the loop was waking for: written straight to the table, so no wake bump races the test
  const [asked] = await sql<{ id: string }[]>`insert into messages (workspace_id, channel_id, author_kind, author_id, body)
    values (${WS}::uuid, ${CHANNEL}::uuid, 'human', ${george.id}::uuid, 'are you there?') returning id`;
  ASKED = asked!.id;
  CREDENTIAL = ((await (await app!.request(`/internal/machines/${MACHINE}/boot-credential`, { method: 'POST', headers: fleet })).json()) as { credential: string }).credential;
});

afterAll(async () => {
  if (sql && MACHINE) await sql`update machines set lifecycle = 'destroyed', name = name || '-gone' where id = ${MACHINE}::uuid`.catch(() => {});
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('the crash-loop breaker and the parked boot on postgres (0158)', { timeout: 30_000 }, () => {
  it('N boots with no running report pass; the next is 409 BOOT_LOOP, parks the machine and stamps it, no epoch', async () => {
    for (let i = 1; i <= 3; i++) {
      const b = await bootCode();
      expect(b).toMatchObject({ status: 200, epoch: i });
      expect((await row())['boot_streak']).toBe(i);
    }
    const tripped = await bootCode();
    expect(tripped).toMatchObject({ status: 409, code: 'BOOT_LOOP', epoch: null });
    const r = await row();
    expect(r).toMatchObject({ epoch: 3, desired_replicas: 0, boot_streak: 3 });
    expect(r['boot_loop_at']).not.toBeNull();
    expect(r['parked_at']).not.toBeNull();
  });

  it('posts ONE notice: the agent this machine hosts answers the person\'s unanswered message, as a compute notice', async () => {
    const said = await notices();
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ reply_to: ASKED, author_id: AGENT, author_kind: 'agent' });
    expect(isSessionRunNotice(said[0]!.body)).toBe(true);
    expect(said[0]!.body).toContain('3 times');
    // a later refused boot says nothing more and moves nothing
    expect(await bootCode()).toMatchObject({ status: 409, code: 'BOOT_LOOP' });
    expect(await notices()).toHaveLength(1);
    expect((await row())['epoch']).toBe(3);
  });

  it('a wake nobody asked for leaves it asleep: an agent\'s message, the sweep\'s re-wake, an agent\'s machine.wake', async () => {
    await bumpMachineWake(sql!, WS, null);
    expect(await row()).toMatchObject({ desired_replicas: 0 });
    expect((await row())['boot_loop_at']).not.toBeNull();
    // a message after the park would make the sweep wake it again: not with the stamp
    await sql!`update machines set last_wake_at = now() + interval '1 second' where id = ${MACHINE}::uuid`;
    expect((await cloudRunSweep(sql!, 30)).rewoken).not.toContain(MACHINE);
    expect(await wakeMachine(sql!, MACHINE, { human: false })).toMatchObject({ woken: false });
    expect((await row())['desired_replicas']).toBe(0);
  });

  it('a person\'s message clears the stamp for exactly ONE more boot, then it trips again', async () => {
    await bumpMachineWake(sql!, WS, george.id);
    const r = await row();
    expect(r).toMatchObject({ desired_replicas: 1, boot_streak: 2, boot_loop_at: null });
    expect(await bootCode()).toMatchObject({ status: 200, epoch: 4 });
    expect(await bootCode()).toMatchObject({ status: 409, code: 'BOOT_LOOP' });
    expect(await row()).toMatchObject({ epoch: 4, desired_replicas: 0 });
    expect(await notices()).toHaveLength(2);
  });

  it('a running report ends the streak: after a person\'s wake, a booted machine that runs counts from zero', async () => {
    expect(await wakeMachine(sql!, MACHINE, { human: true })).toMatchObject({ woken: true });
    const b = await bootCode();
    expect(b).toMatchObject({ status: 200, epoch: 5 });
    const res = await app!.request('/v1/machines/status', { method: 'POST', headers: { authorization: `Bearer ${b.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ state: 'running', epoch: 5, memPct: 10 }) });
    expect(res.status).toBe(200);
    expect(await row()).toMatchObject({ boot_streak: 0, boot_streak_since: null, boot_loop_at: null });
    // a restart after that is boot 1 of a new streak
    expect(await bootCode()).toMatchObject({ status: 200, epoch: 6 });
    expect((await row())['boot_streak']).toBe(1);
  });

  it('the ghost boot: a parked machine (desired 0, no stamp) gets 409 PARKED, no epoch, no streak; a wake lets it boot', async () => {
    await sql!`update machines set desired_replicas = 0, started_at = null, parked_at = now() where id = ${MACHINE}::uuid`;
    const before = await row();
    expect(await bootCode()).toMatchObject({ status: 409, code: 'PARKED', epoch: null });
    expect(await row()).toMatchObject({ epoch: before['epoch'], boot_streak: before['boot_streak'], desired_replicas: 0, boot_loop_at: null });
    await bumpMachineWake(sql!, WS, null); // a routine's wake: no stamp, so it wakes
    expect((await row())['desired_replicas']).toBe(1);
    expect(await bootCode()).toMatchObject({ status: 200, epoch: Number(before['epoch']) + 1 });
  });
});

describe.skipIf(!DB)('snapshot retention on postgres with a fake GCS (0158)', { timeout: 30_000 }, () => {
  const cfg: RetentionConfig = { keep: 3, machines: 20, maxDeletes: 200, minAgeMs: 60 * 60_000, budgetMs: 20_000 };
  const old = new Date(Date.now() - 3 * 3600_000).toISOString();

  function fakeGcs(names: string[], fresh: string[] = []) {
    const objects = new Map(names.map((n) => [n, fresh.includes(n) ? new Date().toISOString() : old]));
    const removed: string[] = [];
    const storage: SnapshotStorage = {
      bucket: 'nm-snapshots-test',
      signer: { email: async () => 'nm-api@test.iam.gserviceaccount.com', signBlob: async () => Buffer.alloc(32, 7) },
      stat: async (o) => (objects.has(o) ? { size: 100 } : null),
      list: async (prefix) => [...objects.entries()].filter(([n]) => n.startsWith(prefix)).map(([name, updated]) => ({ name, size: 100, updated })),
      remove: async (o) => { removed.push(o); return objects.delete(o); },
    };
    return { storage, removed, objects };
  }

  it('keeps the newest 3 epochs of work and of box and the pointed-to keys; the others go; then it leaves the machine alone', async () => {
    const base = snapshotPrefix(WS, MACHINE);
    const key = (k: string) => `${base}${k}.tar.zst`;
    // the restore point is epoch 2 (a drain at 7 that never reported, for example): it stays however old
    await sql!`update machines set snapshot_work = 'work-e2', snapshot_box = 'box-e2', snapshot_gc_work = null, snapshot_gc_at = null where id = ${MACHINE}::uuid`;
    const names = [1, 2, 3, 4, 5, 6, 7].flatMap((e) => [key(`work-e${e}`), key(`box-e${e}`)]).concat([key('replica'), `${base}notes.txt`]);
    const gcs = fakeGcs(names, [key('work-e4')]);
    const out = await snapshotRetentionPass(sql!, gcs.storage, cfg);
    expect(out?.errors).toEqual([]);
    expect(gcs.removed.sort()).toEqual([key('box-e1'), key('box-e3'), key('box-e4'), key('work-e1'), key('work-e3')].sort());
    // kept: the newest 3 (5, 6, 7), the pointed-to 2, work-e4 (written in the last hour), and what is not ours
    for (const k of ['work-e7', 'work-e6', 'work-e5', 'work-e4', 'work-e2', 'box-e7', 'box-e6', 'box-e5', 'box-e2', 'replica']) expect(gcs.objects.has(key(k))).toBe(true);
    expect(gcs.objects.has(`${base}notes.txt`)).toBe(true);
    const [m] = await sql!`select snapshot_gc_work, snapshot_gc_at from machines where id = ${MACHINE}::uuid`;
    expect(m).toMatchObject({ snapshot_gc_work: 'work-e2' });
    // the restore point has not moved: the next pass does not list this machine again
    const again = fakeGcs([...gcs.objects.keys()]);
    await snapshotRetentionPass(sql!, again.storage, cfg);
    expect(again.removed).toEqual([]);
  });

  it('bounded: a pass stops at its delete budget, and the machine is visited again', async () => {
    const base = snapshotPrefix(WS, MACHINE);
    const key = (k: string) => `${base}${k}.tar.zst`;
    await sql!`update machines set snapshot_work = 'work-e20', snapshot_box = null, snapshot_gc_work = null where id = ${MACHINE}::uuid`;
    const gcs = fakeGcs(Array.from({ length: 20 }, (_, i) => key(`work-e${i + 1}`)));
    const first = await snapshotRetentionPass(sql!, gcs.storage, { ...cfg, maxDeletes: 5 });
    expect(first).toMatchObject({ deleted: 5, truncated: true });
    expect((await sql!`select snapshot_gc_work from machines where id = ${MACHINE}::uuid`)[0]!['snapshot_gc_work']).toBeNull();
    await snapshotRetentionPass(sql!, gcs.storage, cfg);
    expect([...gcs.objects.keys()].sort()).toEqual([key('work-e18'), key('work-e19'), key('work-e20')].sort());
  });
});
