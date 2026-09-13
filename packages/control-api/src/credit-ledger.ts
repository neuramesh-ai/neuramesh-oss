// The credit LEDGER — the pure data layer under credits.ts's routes (extracted 2026-08-31 when
// the two-pool round pushed the file past its size cap). Balance, grant, spend, the
// never-refusing activity charge, today's usage, and the refill worklist. No Hono, no routes —
// just the SQL that moves µUSD, so the money math is testable and readable on its own.
import type postgres from 'postgres';
import {
  RATE_VERSION,
  creditsToMicros,
} from '@neuramesh/shared';

export interface CreditBalance {
  grantedMicros: number;
  spentMicros: number;
  /** purchases never expire and are spent AFTER the grant pool (grants reset monthly, so the
   *  expiring pool burns first — buying early must never waste a credit) */
  purchasedMicros: number;
  purchasedSpentMicros: number;
  remainingMicros: number;
  /** the grant pool alone — what the monthly reset will take back */
  grantRemainingMicros: number;
  /** the purchased pool alone — what survives the reset */
  purchasedRemainingMicros: number;
  periodStart: string;
}

export interface UsageToday {
  day: string;
  minutes: number;
  activeSeconds: number;
  modelCalls: number;
  modelMicros: number;
  machineMicros: number;
}

/** the balance, created on first read — a workspace that has never been granted reads zero
 *  rather than throwing, so every caller can treat "no row" and "no credits" alike. */
export async function creditBalance(sql: postgres.Sql, workspaceId: string): Promise<CreditBalance> {
  const [row] = await sql<{ granted_micros: string; spent_micros: string; purchased_micros: string; purchased_spent_micros: string; period_start: string }[]>`
    select granted_micros, spent_micros, purchased_micros, purchased_spent_micros,
           to_char(period_start, 'YYYY-MM-DD') as period_start
      from workspace_credits where workspace_id = ${workspaceId}::uuid`;
  const granted = Number(row?.granted_micros ?? 0);
  const spent = Number(row?.spent_micros ?? 0);
  const purchased = Number(row?.purchased_micros ?? 0);
  const purchasedSpent = Number(row?.purchased_spent_micros ?? 0);
  const grantRemaining = Math.max(0, granted - spent);
  const purchasedRemaining = Math.max(0, purchased - purchasedSpent);
  return {
    grantedMicros: granted,
    spentMicros: spent,
    purchasedMicros: purchased,
    purchasedSpentMicros: purchasedSpent,
    remainingMicros: grantRemaining + purchasedRemaining,
    grantRemainingMicros: grantRemaining,
    purchasedRemainingMicros: purchasedRemaining,
    periodStart: row?.period_start ?? '',
  };
}

/** record a grant and raise the balance. the ledger row is the audit trail; the balance row is
 *  what the guard reads — both in one transaction so they can never disagree. */
export async function grantCredits(
  sql: postgres.Sql,
  workspaceId: string,
  credits: number,
  kind: 'signup' | 'monthly' | 'promo' | 'manual' | 'purchase',
  note?: string,
): Promise<{ grantedMicros: number }> {
  const micros = creditsToMicros(credits);
  return sql.begin(async (tx) => {
    // purchases and promos are IDEMPOTENT BY NOTE (the Stripe session id, the subscription id
    // of a plan flip): webhooks redeliver, and a replayed event must not double-grant. Other
    // kinds keep their at-most-once delivery.
    if ((kind === 'purchase' || kind === 'promo') && note) {
      const [dupe] = await tx<{ id: string }[]>`
        select id from credit_grants
         where workspace_id = ${workspaceId}::uuid and kind = ${kind} and note = ${note} limit 1`;
      if (dupe) {
        const [cur] = await tx<{ granted_micros: string; purchased_micros: string }[]>`
          select granted_micros, purchased_micros from workspace_credits where workspace_id = ${workspaceId}::uuid`;
        return { grantedMicros: Number((kind === 'purchase' ? cur?.purchased_micros : cur?.granted_micros) ?? 0) };
      }
    }
    await tx`insert into credit_grants (workspace_id, micros, kind, rate_version, note)
             values (${workspaceId}::uuid, ${micros}, ${kind}, ${RATE_VERSION}, ${note ?? null})`;
    // a PURCHASE fills the pool that never expires — the monthly reset below must not touch it
    if (kind === 'purchase') {
      const [row] = await tx<{ purchased_micros: string }[]>`
        insert into workspace_credits (workspace_id, purchased_micros)
        values (${workspaceId}::uuid, ${micros})
        on conflict (workspace_id) do update
          set purchased_micros = workspace_credits.purchased_micros + ${micros}, updated_at = now()
        returning purchased_micros`;
      return { grantedMicros: Number(row!.purchased_micros) };
    }
    // a monthly refill RESETS rather than accumulates (no rollover): granted becomes spent
    // plus this period's grant, so the remaining balance is exactly the grant again.
    const [row] = kind === 'monthly'
      ? await tx<{ granted_micros: string }[]>`
          insert into workspace_credits (workspace_id, granted_micros, spent_micros, period_start)
          values (${workspaceId}::uuid, ${micros}, 0, (now() at time zone 'utc')::date)
          on conflict (workspace_id) do update
            set granted_micros = workspace_credits.spent_micros + ${micros},
                period_start = (now() at time zone 'utc')::date,
                updated_at = now()
          returning granted_micros`
      : await tx<{ granted_micros: string }[]>`
          insert into workspace_credits (workspace_id, granted_micros)
          values (${workspaceId}::uuid, ${micros})
          on conflict (workspace_id) do update
            set granted_micros = workspace_credits.granted_micros + ${micros}, updated_at = now()
          returning granted_micros`;
    return { grantedMicros: Number(row!.granted_micros) };
  });
}

/** spend, guarded. returns null when the balance cannot cover the call — the caller turns that
 *  into a 402 and the model is never invoked, which is the whole point of charging AFTER the
 *  call but checking BEFORE it. */
export async function spendCredits(
  sql: postgres.Sql,
  workspaceId: string,
  micros: number,
  usage: { inTokens: number; outTokens: number },
): Promise<{ remainingMicros: number } | null> {
  return sql.begin(async (tx) => {
    // lock the balance row for the duration: two concurrent replies must not both read the
    // same remaining balance and both decide they fit.
    const [bal] = await tx<{ granted_micros: string; spent_micros: string; purchased_micros: string; purchased_spent_micros: string }[]>`
      select granted_micros, spent_micros, purchased_micros, purchased_spent_micros
        from workspace_credits
       where workspace_id = ${workspaceId}::uuid for update`;
    const grantLeft = Math.max(0, Number(bal?.granted_micros ?? 0) - Number(bal?.spent_micros ?? 0));
    const purchasedLeft = Math.max(0, Number(bal?.purchased_micros ?? 0) - Number(bal?.purchased_spent_micros ?? 0));
    if (grantLeft + purchasedLeft < micros) return null;

    // the GRANT pool drains first: it expires at the monthly reset, purchases never do, so
    // spending in this order is what makes "buying early never wastes a credit" true.
    const fromGrant = Math.min(micros, grantLeft);
    const fromPurchased = micros - fromGrant;
    await tx`update workspace_credits
                set spent_micros = spent_micros + ${fromGrant},
                    purchased_spent_micros = purchased_spent_micros + ${fromPurchased},
                    updated_at = now()
              where workspace_id = ${workspaceId}::uuid`;
    await tx`insert into machine_usage (workspace_id, day, minutes, model_calls, model_in_tokens, model_out_tokens, model_micros)
             values (${workspaceId}::uuid, (now() at time zone 'utc')::date, 0, 1, ${usage.inTokens}, ${usage.outTokens}, ${micros})
             on conflict (workspace_id, day) do update
               set model_calls = machine_usage.model_calls + 1,
                   model_in_tokens = machine_usage.model_in_tokens + ${usage.inTokens},
                   model_out_tokens = machine_usage.model_out_tokens + ${usage.outTokens},
                   model_micros = machine_usage.model_micros + ${micros}`;
    return { remainingMicros: grantLeft + purchasedLeft - micros };
  });
}

/** charge machine activity. UNLIKE spendCredits this never refuses: the work already
 *  happened (the daemon is reporting the past 30 seconds), so refusing the debit would not
 *  un-run it — it would only make the ledger lie. The pools clamp at zero; a workspace that
 *  worked past its balance simply reads 0 and the sweep parks the machine on its next pass.
 *  The telemetry row records the true seconds and the µUSD actually collected. */
export async function chargeMachineActivity(
  sql: postgres.Sql,
  workspaceId: string,
  micros: number,
  activeSeconds: number,
): Promise<void> {
  await sql.begin(async (tx) => {
    const [bal] = await tx<{ granted_micros: string; spent_micros: string; purchased_micros: string; purchased_spent_micros: string }[]>`
      select granted_micros, spent_micros, purchased_micros, purchased_spent_micros
        from workspace_credits where workspace_id = ${workspaceId}::uuid for update`;
    const grantLeft = Math.max(0, Number(bal?.granted_micros ?? 0) - Number(bal?.spent_micros ?? 0));
    const purchasedLeft = Math.max(0, Number(bal?.purchased_micros ?? 0) - Number(bal?.purchased_spent_micros ?? 0));
    const fromGrant = Math.min(micros, grantLeft);
    const fromPurchased = Math.min(micros - fromGrant, purchasedLeft);
    if (bal && (fromGrant > 0 || fromPurchased > 0)) {
      await tx`update workspace_credits
                  set spent_micros = spent_micros + ${fromGrant},
                      purchased_spent_micros = purchased_spent_micros + ${fromPurchased},
                      updated_at = now()
                where workspace_id = ${workspaceId}::uuid`;
    }
    await tx`insert into machine_usage (workspace_id, day, minutes, active_seconds, machine_micros)
             values (${workspaceId}::uuid, (now() at time zone 'utc')::date, 0, ${activeSeconds}, ${fromGrant + fromPurchased})
             on conflict (workspace_id, day) do update
               set active_seconds = machine_usage.active_seconds + ${activeSeconds},
                   machine_micros = machine_usage.machine_micros + ${fromGrant + fromPurchased}`;
  });
}

export async function usageToday(sql: postgres.Sql, workspaceId: string): Promise<UsageToday> {
  const [row] = await sql<{ minutes: number; active_seconds: number; model_calls: number; model_micros: string; machine_micros: string }[]>`
    select minutes, active_seconds, model_calls, model_micros, machine_micros from machine_usage
     where workspace_id = ${workspaceId}::uuid and day = (now() at time zone 'utc')::date`;
  return {
    day: new Date().toISOString().slice(0, 10),
    minutes: Number(row?.minutes ?? 0),
    activeSeconds: Number(row?.active_seconds ?? 0),
    modelCalls: Number(row?.model_calls ?? 0),
    modelMicros: Number(row?.model_micros ?? 0),
    machineMicros: Number(row?.machine_micros ?? 0),
  };
}

/** Pro workspaces whose period has rolled over — the monthly refill's worklist. Free rows
 *  are filtered out here, not skipped by the caller: nothing refills on Free since the source
 *  release, and a row that never reaches the loop can never be granted by mistake. */
export async function workspacesDueRefill(sql: postgres.Sql): Promise<Array<{ workspaceId: string; plan: string; seats: number }>> {
  // seats ride along so the refill grants CLOUD_SEAT_MONTHLY_CREDITS × seats without a second
  // read per workspace; plan stays in the row shape so the caller's log can name it.
  const rows = await sql<{ workspace_id: string; plan: string; seats: number }[]>`
    select c.workspace_id, w.plan, w.seats from workspace_credits c
      join workspaces w on w.id = c.workspace_id
     where w.plan = 'cloud'
       and c.period_start < date_trunc('month', (now() at time zone 'utc')::date)`;
  return rows.map((r) => ({ workspaceId: r.workspace_id, plan: r.plan, seats: Math.max(1, Number(r.seats ?? 1)) }));
}


/** the postgres pool, when the store has one. the credit ledger owns its own SQL — it is a
 *  transactional concern with its own semantics, not five more delegates on a store already at
 *  its size cap — and stores without a pool (memory) simply serve 501, exactly as the fleet's
 *  optional methods do. */
