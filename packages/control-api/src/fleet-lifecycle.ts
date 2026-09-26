// the fleet's wake/idle-stop lifecycle + starter metering (docs/design/cloud-first-2026-08:
// wake = scale to 1, idle-stop = scale to 0). rows stay the only truth — this module only
// moves desired_replicas/last_wake_at; the nm-fleet operator reads the result through
// /internal/fleet-desired (fleet.ts) and does the touching. its own module, not fleet.ts,
// to respect the size ratchet: fleet.ts holds the operator's desired-state contract, this
// holds what changes it over time.
//
// three moves, all pure SQL over machines + machine_usage:
//   * bumpMachineWake — every delivered workspace message stamps last_wake_at on the
//     workspace's cloud machines and wakes stopped ones, unless the workspace is free and
//     at/over today's starter cap. fired-and-forgotten from the message path.
//   * machineSweep — the vercel cron's pass, meter → cap-stop → idle-stop in that order,
//     so the pass that detects an overrun is the pass that stops the machine.
//   * machineUsageToday — the UI meter's read behind GET /v1/machines/usage.

import { CLOUD_SEAT_MONTHLY_CREDITS, type Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { creditBalance, grantCredits, sqlOf, workspacesDueRefill } from './credits';
import { machineReach, mayUse, wakeMachine } from './member-machines';
import { routineWakeRoutes } from './routines-wake';
import type { Store } from './store';

/** minutes each sweep pass adds to every running workspace's meter. the vercel cron MUST run
 *  at this cadence (vercel.json schedule and this env agree, or the meter drifts). */
export function sweepIntervalMin(): number {
  const n = Number(process.env['NM_MACHINE_SWEEP_MIN'] ?? 5);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

/** the free plan's starter allowance: cloud-machine wake minutes per utc day. ONE meter for
 *  all key sources by design (v1) — BYOK/BYOS does not lift it. */
/** How long a machine may sit idle before the sweep stops it: 48 hours, EVERY plan.
 *
 *  This supersedes the two-day-old plan-derived window (30 min free / 12 h cloud — George,
 *  2026-08-31): under credits billing, standby is FREE and the credit balance is the real
 *  budget, so a short free window no longer protects anything. The 48 h stop exists only to
 *  bound OUR cost of an abandoned pod (≤ 48 h × ~$0.036/h ≈ $1.73 per idle episode).
 *
 *  "Idle" means no work AND no messages: the sweep reads greatest(last_wake_at,
 *  last_active_at), so an agent grinding silently defends its machine — the task_b4c522e3
 *  hole, closed here.
 *
 *  `idle_stop_min IS NULL` still means NEVER auto-stop, on any plan. That is the escape hatch
 *  a dedicated always-on machine will use, and it outranks this. */
export function idleStopMin(): number {
  const n = Number(process.env['NM_IDLE_STOP_MIN'] ?? 2880);
  return Number.isFinite(n) && n > 0 ? n : 2880;
}

// one statement, TARGETED (member-machines plan §4): the runner's idle clock resets and it wakes
// if stopped; so does the machine of the member who wrote the message — never every machine in
// the workspace, which with N members would be N pods per message on N subscriptions. The credit
// pool is the only gate. last_wake_at moves either way: a refused wake is still activity.
export async function bumpMachineWake(sql: postgres.Sql, workspaceId: string, originUserId: string | null = null): Promise<void> {
  await sql`
    update machines m
       set last_wake_at = now(),
           desired_replicas = case
             when m.desired_replicas = 0
              and greatest(coalesce(c.granted_micros, 0) - coalesce(c.spent_micros, 0), 0)
                + greatest(coalesce(c.purchased_micros, 0) - coalesce(c.purchased_spent_micros, 0), 0) > 0
             then 1
             else m.desired_replicas
           end,
           -- the START, stamped on the same transition and nowhere else. last_wake_at above
           -- moves on every message, so it can never answer "how long has this been up".
           started_at = case
             when m.desired_replicas = 0
              and greatest(coalesce(c.granted_micros, 0) - coalesce(c.spent_micros, 0), 0)
                + greatest(coalesce(c.purchased_micros, 0) - coalesce(c.purchased_spent_micros, 0), 0) > 0
             then now()
             else m.started_at
           end
      from workspaces w
      left join workspace_credits c on c.workspace_id = w.id
     where w.id = m.workspace_id
       and m.workspace_id = ${workspaceId}::uuid
       and m.kind <> 'local'
       and (m.lifecycle is null or m.lifecycle <> 'destroyed')
       and (m.kind = 'runner' or m.owner_user_id = ${originUserId}::uuid)`;
}

export interface MachineSweepResult {
  /** workspaces whose telemetry accrued this pass (they had a running cloud machine) */
  metered: number;
  /** machines parked because the workspace balance reached zero (runs drained first) */
  capStopped: string[];
  /** machines stopped after 48h with no work and no messages (NULL = never auto-stop) */
  idleStopped: string[];
}

export async function machineSweep(sql: postgres.Sql, intervalMin: number): Promise<MachineSweepResult> {
  const metered = await sql<{ workspace_id: string }[]>`
    insert into machine_usage (workspace_id, day, minutes)
    select distinct m.workspace_id, (now() at time zone 'utc')::date, ${intervalMin}::int
      from machines m
     where m.kind <> 'local' and m.desired_replicas = 1
       and (m.lifecycle is null or m.lifecycle <> 'destroyed')
    on conflict (workspace_id, day) do update set minutes = machine_usage.minutes + excluded.minutes
    returning workspace_id`;
  // PARK AT ZERO — the only stop a funded workspace never meets. The 10-minute recency guard
  // on last_active_at is the run-drain grace: work in flight finishes, nothing is killed. The
  // free daily minute cap this replaces is gone: minutes keep accruing above as telemetry, but
  // the credit balance is the budget now.
  const capStopped = await sql<{ id: string }[]>`
    update machines m
       set desired_replicas = 0, started_at = null
      from workspace_credits c
     where c.workspace_id = m.workspace_id
       and m.kind <> 'local' and m.desired_replicas = 1
       and greatest(c.granted_micros - c.spent_micros, 0)
         + greatest(c.purchased_micros - c.purchased_spent_micros, 0) <= 0
       and (m.last_active_at is null or m.last_active_at < now() - interval '10 minutes')
     returning m.id`;
  // ONE window, both plans; work OR messages defend the machine
  const idleMin = idleStopMin();
  const idleStopped = await sql<{ id: string }[]>`
    update machines m
       set desired_replicas = 0, started_at = null
     where m.kind <> 'local' and m.desired_replicas = 1
       and m.idle_stop_min is not null
       and greatest(coalesce(m.last_wake_at, to_timestamp(0)), coalesce(m.last_active_at, to_timestamp(0)))
             < now() - make_interval(mins => ${idleMin}::int)
     returning m.id`;
  return { metered: metered.length, capStopped: capStopped.map((r) => r.id), idleStopped: idleStopped.map((r) => r.id) };
}

export async function machineUsageToday(sql: postgres.Sql, workspaceId: string): Promise<{ day: string; minutes: number }> {
  const [row] = await sql<{ day: string; minutes: number }[]>`
    select to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD') as day,
           coalesce((select u.minutes from machine_usage u
              where u.workspace_id = ${workspaceId}::uuid and u.day = (now() at time zone 'utc')::date), 0) as minutes`;
  return { day: row!.day, minutes: Number(row!.minutes) };
}

/** the message path's wake, fire-and-forget: never awaited, never throws — a fleet hiccup
 *  must not slow or fail message delivery. no-op on stores that don't serve fleet. */
export function fireWakeBump(store: Store, workspaceId: string, originUserId: string | null = null): void {
  if (!store.bumpMachineWake) return;
  void store.bumpMachineWake(workspaceId, originUserId).catch((e) => console.error('machine wake bump failed:', e));
}

/** the fleet's INTENT for a workspace's cloud machines, which the replica does not carry:
 *  `desired_replicas` is fleet bookkeeping, not workspace data, so it is deliberately outside the
 *  sync publication. The UI needs it anyway — without it "offline" cannot be told apart from
 *  "asleep on purpose" — so it rides this read rather than a schema change and a re-snapshot. */
export async function machineIntent(sql: postgres.Sql, workspaceId: string): Promise<Array<{
  id: string; name: string; desiredReplicas: number; lastSeenAt: string | null;
  lastWakeAt: string | null; lifecycle: string | null; idleStopMin: number | null;
  /** which kind, and whose — a surface groups the runner apart from members' machines on these */
  kind: string; ownerUserId: string | null;
  /** when it started (null = stopped) and when it last did real work — both written by the
   *  fleet for a while, neither ever surfaced, so no screen could say how long it had been up */
  startedAt: string | null; lastActiveAt: string | null;
}>> {
  const rows = await sql<Array<Record<string, unknown>>>`
    select m.id, m.name, m.desired_replicas, m.last_seen_at, m.last_wake_at, m.lifecycle,
           m.started_at, m.last_active_at, m.kind, m.owner_user_id,
           -- the EFFECTIVE window — one number for every plan since credits (2026-08-31),
           -- so a surface never re-derives the rule. NULL still means never auto-stop.
           case when m.idle_stop_min is null then null
                else ${idleStopMin()}::int end as idle_stop_min
      from machines m
      join workspaces w on w.id = m.workspace_id
     where m.workspace_id = ${workspaceId}::uuid and m.kind <> 'local'
       and (m.lifecycle is null or m.lifecycle <> 'destroyed')
     -- the runner FIRST: every client shipped before member machines takes machines[0] as "the"
     -- machine, and member-… sorts before runner — so this order is a compatibility contract
     order by (m.kind = 'runner') desc, m.name`;
  return rows.map((r) => ({
    id: String(r['id']), name: String(r['name']),
    desiredReplicas: Number(r['desired_replicas'] ?? 0),
    lastSeenAt: r['last_seen_at'] ? new Date(r['last_seen_at'] as string).toISOString() : null,
    lastWakeAt: r['last_wake_at'] ? new Date(r['last_wake_at'] as string).toISOString() : null,
    lifecycle: (r['lifecycle'] as string | null) ?? null,
    idleStopMin: r['idle_stop_min'] === null || r['idle_stop_min'] === undefined ? null : Number(r['idle_stop_min']),
    startedAt: r['started_at'] ? new Date(r['started_at'] as string).toISOString() : null,
    lastActiveAt: r['last_active_at'] ? new Date(r['last_active_at'] as string).toISOString() : null,
    kind: String(r['kind'] ?? 'runner'), ownerUserId: (r['owner_user_id'] as string | null) ?? null,
  }));
}

/**
 * The MANUAL wake. `bumpMachineWake` fires from the message path and refuses silently when a free
 * workspace is over its day; this is the human saying "start it anyway", and it refuses OUT LOUD.
 *
 * It honours the same cap — a button that quietly ignored the limit would make the limit a lie —
 * and returns which happened, so the caller can send the person to the upgrade rather than leave a
 * dead button. Cloud plans are never capped, so for them this always wakes.
 */
export async function wakeMachines(sql: postgres.Sql, workspaceId: string): Promise<{ woken: number; capped: boolean }> {
  // the gate is the CREDIT BALANCE, not a daily minute count — `capped: true` now means "out
  // of credits" (the response shape is kept so every existing caller's refusal path holds).
  const bal = await creditBalance(sql, workspaceId);
  if (bal.remainingMicros <= 0) return { woken: 0, capped: true };
  const woken = await sql<{ id: string }[]>`
    update machines set desired_replicas = 1, last_wake_at = now(),
           -- only a machine that was STOPPED is starting; re-waking a running one must not
           -- reset its clock and make a healthy machine look freshly booted
           started_at = case when desired_replicas = 0 then now() else started_at end
     where workspace_id = ${workspaceId}::uuid and kind <> 'local'
       and (lifecycle is null or lifecycle <> 'destroyed')
     returning id`;
  return { woken: woken.length, capped: false };
}

/**
 * ADMIN: put today's meter back to zero, so a workspace that spent its free machine minutes can
 * work again before the UTC roll-over.
 *
 * `machine_usage` has one row per (workspace × UTC day), and every gate reads it: bumpMachineWake
 * refuses on it, the sweep cap-stops on it, and the client derives `capped` from it. So zeroing
 * the row is the whole reset; nothing else has to be told.
 *
 * It UPDATES rather than deletes, and returns which workspaces actually changed. A workspace with
 * no row for today has nothing to reset (the reads coalesce a missing row to 0), and saying "0
 * reset" is more useful to an operator than pretending something happened.
 */
export async function resetDailyUsage(sql: postgres.Sql, target: { workspace?: string; all?: boolean }): Promise<string[]> {
  const rows = target.all
    ? await sql<{ workspace_id: string }[]>`
        update machine_usage set minutes = 0
         where day = (now() at time zone 'utc')::date and minutes > 0
        returning workspace_id`
    : await sql<{ workspace_id: string }[]>`
        update machine_usage set minutes = 0
         where day = (now() at time zone 'utc')::date and minutes > 0
           and workspace_id = ${target.workspace!}::uuid
        returning workspace_id`;
  return rows.map((r) => r.workspace_id);
}

export function lifecycleRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  routineWakeRoutes(app, store, (sql, ws) => bumpMachineWake(sql, ws, null)); // a routine wakes its runner (routines-wake.ts)
  // the sweep pass: vercel cron GETs this with `authorization: Bearer $CRON_SECRET` every
  // NM_MACHINE_SWEEP_MIN minutes (cron-routes.ts idiom). meter, then enforce.
  app.get('/internal/machine-sweep', async (c) => {
    const secret = process.env['CRON_SECRET'];
    if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) return c.json({ error: 'forbidden' }, 403);
    if (!store.machineSweep) return c.json({ error: 'fleet not served by this store' }, 501);
    const out = await store.machineSweep(sweepIntervalMin());
    console.log(`machine-sweep: metered=${out.metered} capStopped=[${out.capStopped.join(',')}] idleStopped=[${out.idleStopped.join(',')}]`);
    return c.json(out);
  });

  // the UI meter (clerk lane): a workspace member reads today's wake minutes + the cap that
  // applies (null = uncapped, the cloud plan). registered AFTER the /v1 auth gate in app.ts.
  // the monthly refill: no rollover, so a refill RESETS the balance to the grant rather than
  // adding to it. idempotent by period_start — a cron that fires twice in a month is a no-op
  // the second time, which matters because vercel crons are at-least-once.
  app.get('/internal/credit-refill', async (c) => {
    const secret = process.env['CRON_SECRET'];
    if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'credits not served by this store' }, 501);
    const due = await workspacesDueRefill(sql);
    for (const ws of due) {
      // the worklist is Pro-only (workspacesDueRefill filters plan = 'cloud'), so the allocation
      // is 1,500 × seats. The 'monthly' grant kind resets only the grant pool — purchased
      // credits ride through untouched, which is the entire reason the pools split.
      const credits = CLOUD_SEAT_MONTHLY_CREDITS * ws.seats;
      await grantCredits(sql, ws.workspaceId, credits, 'monthly', `monthly refill (${ws.plan} × ${ws.seats} seats)`).catch((e: unknown) => {
        console.error(`credit_refill_failed workspace=${ws.workspaceId}: ${e instanceof Error ? e.message : e}`);
      });
    }
    console.log(`credit_refill refilled=${due.length}`);
    return c.json({ refilled: due.length });
  });

  /**
   * ADMIN RESET. Not a member route: this GRANTS COMPUTE, so a user must never be able to lift
   * their own cap, or the cap is decoration. It carries its own secret rather than borrowing
   * CRON_SECRET or FLEET_SECRET, because reusing either would hand every scheduled job and the
   * in-cluster operator the power to hand out free machine hours.
   *
   * FAIL CLOSED, and inert until deliberately switched on: with NM_ADMIN_SECRET unset the route
   * refuses everything, so shipping it does not open a door in a deployment that has not chosen
   * to have one.
   *
   * The scope must be SAID OUT LOUD: exactly one of `workspace` or `all: true`, never both and
   * never neither. An admin endpoint where a forgotten field silently means "everybody" is how a
   * one-workspace fix becomes a fleet-wide giveaway.
   */
  app.post('/internal/usage-reset', async (c) => {
    const secret = process.env['NM_ADMIN_SECRET'];
    if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) return c.json({ error: 'forbidden' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { workspace?: string; all?: boolean; wake?: boolean };
    const one = typeof body.workspace === 'string' && body.workspace.length > 0;
    if (one === (body.all === true)) {
      return c.json({ error: 'pass exactly one of `workspace` or `all: true`', code: 'INVALID_INPUT' }, 400);
    }
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store' }, 501);

    const reset = await resetDailyUsage(sql, one ? { workspace: body.workspace } : { all: true });
    // Waking is OPT-IN and never fleet-wide. Zeroing the meter lets the next message wake the
    // machine on its own; `wake: true` is for unblocking somebody whose message already went
    // unanswered, and starting every pod in the fleet from one curl is not a thing to make easy.
    let woken = 0;
    if (body.wake === true) {
      if (!one) return c.json({ error: '`wake` is per-workspace: it will not start the whole fleet', code: 'INVALID_INPUT' }, 400);
      woken = (await wakeMachines(sql, body.workspace!)).woken;
    }
    // an action that hands out compute leaves a trace, the way the sweep does
    console.log(`usage_reset scope=${one ? body.workspace : 'ALL'} reset=${reset.length} woken=${woken}`);
    return c.json({ ok: true, reset: reset.length, workspaces: reset, woken });
  });

  app.get('/v1/machines/usage', async (c) => {
    const workspace = c.req.query('workspace');
    if (!workspace) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'the usage meter is human-only', code: 'NOT_PERMITTED' }, 403);
    if (!(await store.humanMemberIds(workspace)).includes(actor.id)) {
      return c.json({ error: 'not a member of this workspace', code: 'NOT_PERMITTED' }, 403);
    }
    if (!store.machineUsageToday) return c.json({ error: 'fleet not served by this store' }, 501);
    const usage = await store.machineUsageToday(workspace);
    const plan = await store.workspacePlan(workspace);
    // ALWAYS NULL. The daily free-minute cap was retired by the credits round — nothing on the
    // server gates on minutes any more (bumpMachineWake reads the credit balance and nothing
    // else). This endpoint kept serving 60 to free plans, and that number was not decoration:
    // machineSweep still meters minutes, so after twelve passes capSpent() flipped machineState()
    // to 'capped', which REPLACES the chat composer (NewChatStage) and hides "Wake now" — a free
    // workspace locked out of its own product by a rule the server had already abandoned.
    // /v1/usage next door has returned null since the round; this is the endpoint every compute
    // surface actually reads (George, 2026-09-01).
    const capMinutes = null;
    // the machines ride along: one call gives a surface everything machineState() needs, so the
    // pill, the Compute row and the thread's gate card cannot disagree about the same machine.
    const sql = sqlOf(store);
    const machines = sql ? await machineIntent(sql, workspace) : [];
    // THE ONE THING THAT ACTUALLY STOPS A WAKE, said out loud. bumpMachineWake raises
    // desired_replicas only on a positive balance and reports nothing, so without this every
    // compute surface reads a zero-balance machine as an ordinary nap and tells the person a
    // message will wake it. It never will.
    const bal = sql ? await creditBalance(sql, workspace) : null;
    // the caller's OWN machine, named by the server: the browser's shell opens it rather than the
    // runner, so a member signs in where their logins belong (R4). machines[0] stays the runner
    // for every client that reads it as "the" machine.
    const yours = machines.find((m) => m.kind === 'member' && m.ownerUserId === actor.id)?.id ?? null;
    return c.json({ ...usage, capMinutes, plan, machines, yours, outOfCredits: bal ? bal.remainingMicros <= 0 : false });
  });

  /** "Wake now" — the human's override for when the automatic wake did not happen. Human-only and
   *  member-gated like the meter beside it; refuses out loud on a spent free day. */
  app.post('/v1/machines/wake', async (c) => {
    const { workspace, machineId } = (await c.req.json().catch(() => ({}))) as { workspace?: string; machineId?: string };
    if (!workspace) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'waking a machine is human-only', code: 'NOT_PERMITTED' }, 403);
    if (!(await store.humanMemberIds(workspace)).includes(actor.id)) {
      return c.json({ error: 'not a member of this workspace', code: 'NOT_PERMITTED' }, 403);
    }
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store' }, 501);
    if (machineId) {
      // ONE machine, by id (member-machines plan §4): yours, or one its owner lends you
      const reach = await machineReach(sql, machineId);
      if (!reach || reach.workspaceId !== workspace) return c.json({ error: 'no such machine here', code: 'NOT_FOUND' }, 404);
      if (!mayUse(reach, actor.id)) return c.json({ error: 'this machine is not lent to you', code: 'NOT_PERMITTED' }, 403);
      const one = await wakeMachine(sql, machineId);
      if (one.capped) return c.json({ ok: false, capped: true, error: 'this workspace is out of credits — top up to wake its machine', code: 'NO_CREDITS' }, 409);
      return c.json({ ok: true, woken: one.woken ? 1 : 0 });
    }
    const out = await wakeMachines(sql, workspace);
    if (out.capped) {
      // the refusal is the CREDIT balance, not a minutes cap — saying "free machine hours" sent
      // people looking for a clock that no longer exists instead of at their balance.
      return c.json({ ok: false, capped: true, error: 'this workspace is out of credits — top up to wake its machine', code: 'NO_CREDITS' }, 409);
    }
    return c.json({ ok: true, woken: out.woken });
  });
}
