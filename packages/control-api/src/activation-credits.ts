import { CLOUD_SEAT_MONTHLY_CREDITS, RATE_VERSION, SIGNUP_GRANT_CREDITS, creditsToMicros } from '@neuramesh/shared';
import type postgres from 'postgres';

/** Serialize the credit grant across webhook delivery and the browser's confirmation read. */
export async function grantActivationCredits(sql: postgres.Sql, workspace: string, subscription: string, trial: boolean, seats: number): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`activation:${workspace}`}, 0))`;
    const note = trial ? 'trial-activation' : `paid-activation:${subscription}`;
    const [existing] = await tx`select id from credit_grants where workspace_id = ${workspace}::uuid
      and (note = ${note} or (${trial} and kind = 'signup')
        or (not ${trial} and kind = 'promo' and note = ${subscription})) limit 1`;
    // Existing free balances stay intact. They do not receive the signup allowance twice.
    if (existing) return;
    const micros = creditsToMicros(trial ? SIGNUP_GRANT_CREDITS : CLOUD_SEAT_MONTHLY_CREDITS * seats);
    await tx`insert into credit_grants (workspace_id, micros, kind, rate_version, note)
      values (${workspace}::uuid, ${micros}, 'promo', ${RATE_VERSION}, ${note})`;
    await tx`insert into workspace_credits (workspace_id, granted_micros) values (${workspace}::uuid, ${micros})
      on conflict (workspace_id) do update set granted_micros = workspace_credits.granted_micros + ${micros}, updated_at = now()`;
  });
}
