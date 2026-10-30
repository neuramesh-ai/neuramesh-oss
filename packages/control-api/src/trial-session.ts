import type postgres from 'postgres';
import { createTrialSession, readTrialSession } from './billing';

/** A reload or a second tab resumes the same Stripe checkout. Only an expired session is replaced.
 * The Stripe key also covers a successful request followed by a lost database connection. */
export async function workspaceTrialSession(sql: postgres.Sql, input: Parameters<typeof createTrialSession>[0]) {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ trial_checkout_session_id: string | null }[]>`
      select trial_checkout_session_id from workspaces where id = ${input.workspace}::uuid for update`;
    if (!row) throw new Error('Workspace not found');
    const previous = row.trial_checkout_session_id;
    if (previous) {
      const session = await readTrialSession(previous);
      if (session.status !== 'expired') return session;
    }
    const session = await createTrialSession(input, `trial:${input.workspace}:${previous ?? 'first'}`);
    await tx`update workspaces set trial_checkout_session_id = ${session.id} where id = ${input.workspace}::uuid`;
    return { ...session, status: 'open', subscription: null };
  });
}
