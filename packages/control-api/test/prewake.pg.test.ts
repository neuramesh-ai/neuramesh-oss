// THE SPECULATIVE WAKE against the REAL schema (0175, fleet-prewake.ts, fleet-wake-wait.ts):
//   · the route starts the runner and the caller's own member machine, never a teammate's, stamps the
//     start as speculative, and leaves last_wake_at alone
//   · a second call inside the window is rate-limited, and a call on an awake machine changes nothing
//   · a speculative start with no message and no work stops on the short timeout, on both sweeps
//   · a message or real work since the prewake ends the speculative state: the full window applies
//   · it never clears a crash-loop breaker, and a workspace with no credits does not wake
//   · the wait a person saw is classed cold or prewoken from the machine row
// Run by the pg lane (DATABASE_URL). Without it, the suite is skipped.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { grantCredits } from '../src/credits';
import { createCloudMachine } from '../src/fleet';
import { cloudRunSweep } from '../src/fleet-cloudrun-sweep';
import { bumpMachineWake, machineIntent, machineSweep } from '../src/fleet-lifecycle';
import { prewakeMachines } from '../src/fleet-prewake';
import { wakeWait } from '../src/fleet-wake-wait';
import { mintMachineToken } from '../src/machine-auth';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const ENV = { FLEET_CLOUDRUN: '1', NM_ALLOW_ACTOR_HEADER: '1', NM_PREWAKE_IDLE_MIN: '5' } as const;
const saved: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; if (DB) process.env[k] = v; }
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const asGeorge = { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) };
const tag = `prewake-${Date.now().toString(36)}`;

let WS = '';
let CHANNEL = '';
let RUNNER = '';
let MINE = '';
let THEIRS = '';
let AGENT = '';

type Row = { desired_replicas: number; started_at: Date | null; wake_speculative_at: Date | null; last_wake_at: Date | null; boot_loop_at: Date | null; boot_streak: number; drain_state: string | null };
const row = async (id: string): Promise<Row> => (await sql!<Row[]>`
  select desired_replicas, started_at, wake_speculative_at, last_wake_at, boot_loop_at, boot_streak, drain_state from machines where id = ${id}::uuid`)[0]!;
const prewakeRoute = async (): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await app!.request('/v1/machines/prewake', { method: 'POST', headers: asGeorge, body: JSON.stringify({ workspace: WS, surface: 'thread' }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
/** every machine of the test back to asleep, with no stamps and no drain */
const sleepAll = async (): Promise<void> => {
  await sql!`update machines set desired_replicas = 0, started_at = null, wake_speculative_at = null, last_wake_at = null,
      last_active_at = null, drain_state = null, drain_reason = null, drain_deadline = null, parked_at = null, boot_loop_at = null
    where id in (${RUNNER}::uuid, ${MINE}::uuid, ${THEIRS}::uuid)`;
};
/** move this run's start (and its speculative stamp) `min` minutes into the past */
const ageStart = async (ids: string[], min: number): Promise<void> => {
  await sql!`update machines set started_at = now() - make_interval(mins => ${min}::int),
      wake_speculative_at = case when wake_speculative_at is null then null else now() - make_interval(mins => ${min}::int) end
    where id = any(${ids}::uuid[])`;
};

beforeAll(async () => {
  if (!sql) return;
  const made = (await (await app!.request('/v1/commands', { method: 'POST', headers: asGeorge, body: JSON.stringify({ type: 'workspace.create', name: `Prewake ${tag}`, slug: tag }) })).json()) as { workspaceId: string; channelId: string };
  WS = made.workspaceId; CHANNEL = made.channelId;
  await grantCredits(sql, WS, 100, 'manual', 'prewake test');
  // a teammate: their member machine is theirs to wake, never george's typing
  const [mate] = await sql<{ id: string }[]>`insert into nm_users (clerk_user_id, email) values (${`clerk_${tag}`}, ${`${tag}@prewake.test`}) returning id`;
  const mk = (kind: 'runner' | 'member', owner: string, name: string) =>
    createCloudMachine(sql, { workspaceId: WS, kind, ownerUserId: owner, name, tokenHash: mintMachineToken().hash, substrate: 'cloudrun', replicas: 0 });
  RUNNER = (await mk('runner', george.id, `runner-${tag}`)).id;
  MINE = (await mk('member', george.id, `member-g-${tag}`)).id;
  THEIRS = (await mk('member', mate!.id, `member-t-${tag}`)).id;
  const [agent] = await sql<{ id: string }[]>`insert into agents (workspace_id, machine_id, name) values (${WS}::uuid, ${RUNNER}::uuid, ${`rex-${tag}`}) returning id`;
  AGENT = agent!.id;
});

afterAll(async () => {
  if (sql && RUNNER) {
    await sql`update machines set lifecycle = 'destroyed', desired_replicas = 0, name = name || '-gone'
      where id in (${RUNNER}::uuid, ${MINE}::uuid, ${THEIRS}::uuid)`.catch(() => {});
  }
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('the speculative wake on postgres (0175)', { timeout: 30_000 }, () => {
  it('starts the runner and my own machine, never a teammate\'s, and marks the start as speculative', async () => {
    const out = await prewakeRoute();
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, outcome: 'woken', speculativeMin: 5 });
    expect([...(out.body['woken'] as string[])].sort()).toEqual([RUNNER, MINE].sort());
    for (const id of [RUNNER, MINE]) {
      const r = await row(id);
      expect(r.desired_replicas).toBe(1);
      expect(r.started_at).not.toBeNull();
      expect(r.wake_speculative_at?.getTime()).toBe(r.started_at?.getTime());
      // a prewake is not a message: it must not defend the machine the way a message does
      expect(r.last_wake_at).toBeNull();
    }
    expect((await row(THEIRS)).desired_replicas).toBe(0);
  });

  it('a second call inside the window is rate-limited and reaches nothing', async () => {
    await sql!`update machines set desired_replicas = 0 where id = ${MINE}::uuid`;
    const out = await prewakeRoute();
    expect(out.body).toMatchObject({ ok: true, outcome: 'rate_limited', woken: [] });
    expect((await row(MINE)).desired_replicas).toBe(0);
    await sql!`update machines set desired_replicas = 1 where id = ${MINE}::uuid`;
  });

  it('a machine that is awake already is left alone: no new start, no new stamp', async () => {
    const before = await row(RUNNER);
    const out = await prewakeMachines(sql!, WS, george.id);
    expect(out).toMatchObject({ outcome: 'awake', woken: [] });
    const after = await row(RUNNER);
    expect(after.started_at?.getTime()).toBe(before.started_at?.getTime());
    expect(after.wake_speculative_at?.getTime()).toBe(before.wake_speculative_at?.getTime());
  });

  it('Cloud Run: no message and no work, it drains after the short timeout and not before', async () => {
    await ageStart([RUNNER, MINE], 4);
    const early = await cloudRunSweep(sql!, 2880);
    expect(early.idleDrains).not.toContain(RUNNER);
    await ageStart([RUNNER, MINE], 6);
    const pass = await cloudRunSweep(sql!, 2880);
    expect(pass.idleDrains).toEqual(expect.arrayContaining([RUNNER, MINE]));
    expect(pass.speculative).toEqual(expect.arrayContaining([RUNNER, MINE]));
    expect(await row(RUNNER)).toMatchObject({ drain_state: 'draining' });
  });

  it('a message since the prewake ends the speculative state: the full window applies', async () => {
    await sleepAll();
    expect((await prewakeMachines(sql!, WS, george.id)).outcome).toBe('woken');
    await ageStart([RUNNER, MINE], 6);
    await bumpMachineWake(sql!, WS, george.id);
    const pass = await cloudRunSweep(sql!, 2880);
    expect(pass.idleDrains).not.toContain(RUNNER);
    expect(pass.idleDrains).not.toContain(MINE);
  });

  it('real work since the prewake defends the machine too', async () => {
    await sleepAll();
    await prewakeMachines(sql!, WS, george.id);
    await ageStart([RUNNER, MINE], 6);
    await sql!`update machines set last_active_at = now() where id = ${RUNNER}::uuid`;
    const pass = await cloudRunSweep(sql!, 2880);
    expect(pass.idleDrains).not.toContain(RUNNER);
    expect(pass.idleDrains).toContain(MINE);
  });

  it('an old stamp on a machine a message started later never matches', async () => {
    await sleepAll();
    await prewakeMachines(sql!, WS, george.id);
    await ageStart([RUNNER], 30);
    // the machine stops, then a message starts it again: started_at moves past the old stamp
    await sql!`update machines set desired_replicas = 0, started_at = null where id = ${RUNNER}::uuid`;
    await bumpMachineWake(sql!, WS, george.id);
    await sql!`update machines set last_wake_at = now() - interval '6 minutes', started_at = now() - interval '6 minutes' where id = ${RUNNER}::uuid`;
    const pass = await cloudRunSweep(sql!, 2880);
    expect(pass.idleDrains).not.toContain(RUNNER);
  });

  it('the kube sweep uses the same rule when Cloud Run drains are off', async () => {
    await sleepAll();
    await prewakeMachines(sql!, WS, george.id);
    await ageStart([RUNNER, MINE], 6);
    process.env['FLEET_CLOUDRUN'] = '0';
    try {
      const out = await machineSweep(sql!, 5, null);
      expect(out.idleStopped).toEqual(expect.arrayContaining([RUNNER, MINE]));
    } finally {
      process.env['FLEET_CLOUDRUN'] = '1';
    }
    expect((await row(RUNNER)).desired_replicas).toBe(0);
  });

  it('never clears a crash-loop breaker: the tripped machine stays asleep and is reported held', async () => {
    await sleepAll();
    await sql!`update machines set boot_loop_at = now(), boot_streak = 3 where id = ${RUNNER}::uuid`;
    const out = await prewakeMachines(sql!, WS, george.id);
    expect(out).toMatchObject({ outcome: 'woken', woken: [MINE], held: [RUNNER] });
    const r = await row(RUNNER);
    expect(r.desired_replicas).toBe(0);
    expect(r.boot_loop_at).not.toBeNull();
    expect(r.boot_streak).toBe(3);
    // with only the tripped machine asleep, the outcome says held
    await sql!`update machines set desired_replicas = 0 where id = ${MINE}::uuid`;
    await sql!`update machines set boot_loop_at = now() where id = ${MINE}::uuid`;
    expect((await prewakeMachines(sql!, WS, george.id)).outcome).toBe('held');
  });

  it('a workspace with no credits does not wake', async () => {
    await sleepAll();
    await sql!`update workspace_credits set spent_micros = granted_micros, purchased_spent_micros = purchased_micros where workspace_id = ${WS}::uuid`;
    try {
      const out = await prewakeMachines(sql!, WS, george.id);
      expect(out).toMatchObject({ outcome: 'capped', woken: [] });
      expect((await row(RUNNER)).desired_replicas).toBe(0);
      expect((await row(MINE)).desired_replicas).toBe(0);
    } finally {
      await sql!`update workspace_credits set spent_micros = 0, purchased_spent_micros = 0 where workspace_id = ${WS}::uuid`;
    }
  });

  it('GET /v1/machines/usage carries the stop and the breaker, so a surface can say asleep, going to sleep or paused', async () => {
    await sleepAll();
    await sql!`update machines set parked_at = now() - interval '1 minute', last_seen_at = now() where id = ${RUNNER}::uuid`;
    await sql!`update machines set desired_replicas = 1, started_at = now(), drain_state = 'draining', drain_reason = 'idle', drain_deadline = now() + interval '3 minutes' where id = ${MINE}::uuid`;
    await sql!`update machines set boot_loop_at = now() where id = ${THEIRS}::uuid`;
    const rows = await machineIntent(sql!, WS);
    const of = (id: string) => rows.find((m) => m.id === id)!;
    expect(of(RUNNER)).toMatchObject({ desiredReplicas: 0, drainState: null, bootLoopAt: null });
    expect(of(RUNNER).parkedAt).not.toBeNull();
    expect(of(MINE)).toMatchObject({ desiredReplicas: 1, drainState: 'draining', drainReason: 'idle' });
    expect(of(THEIRS).bootLoopAt).not.toBeNull();
    const usage = await app!.request(`/v1/machines/usage?workspace=${WS}`, { headers: asGeorge });
    const body = (await usage.json()) as { machines: Array<Record<string, unknown>> };
    expect(body.machines.find((m) => m['id'] === MINE)).toMatchObject({ drainState: 'draining', drainReason: 'idle' });
    await sleepAll();
    await sql!`update machines set boot_loop_at = null, last_seen_at = null where id in (${RUNNER}::uuid, ${THEIRS}::uuid)`;
  });

  it('classes the wait a person saw: prewoken with its lead, or cold', async () => {
    await sleepAll();
    await sql!`update machines set desired_replicas = 1, started_at = now() - interval '3 seconds', wake_speculative_at = now() - interval '3 seconds' where id = ${RUNNER}::uuid`;
    const msg = async () => (await sql!<{ id: string }[]>`insert into messages (workspace_id, channel_id, author_kind, author_id, body)
      values (${WS}::uuid, ${CHANNEL}::uuid, 'human', ${george.id}::uuid, 'build it') returning id`)[0]!.id;
    const run = async (trigger: string) => (await sql!<{ id: string }[]>`insert into runs (workspace_id, channel_id, agent_id, kind, title, trigger_message_id, machine_id)
      values (${WS}::uuid, ${CHANNEL}::uuid, ${AGENT}::uuid, 'wake', 'reply', ${trigger}::uuid, ${RUNNER}::uuid) returning id`)[0]!.id;
    const first = await wakeWait(sql!, await run(await msg()));
    expect(first).toMatchObject({ start: 'prewoken', machineId: RUNNER, substrate: 'cloudrun' });
    expect(first!.leadMs).toBeGreaterThanOrEqual(2_900);
    expect(first!.waitMs).toBeGreaterThanOrEqual(0);
    // the second message after the same prewake found the machine up
    expect((await wakeWait(sql!, await run(await msg())))?.start).toBe('warm');
    // a message that started the machine itself
    const cold = await msg();
    await sql!`update machines set started_at = now(), wake_speculative_at = null where id = ${RUNNER}::uuid`;
    expect((await wakeWait(sql!, await run(cold)))?.start).toBe('cold');
  });
});
