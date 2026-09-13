// The hosted free notice (source release 2026-09, unit U1b): who gets the email, and the send.
// scripts/notify-hosted-free-owners.mjs drives this. Dry run lists. --send goes through the
// outbox (onauth.ts queueAndSend, mail.ts sendEmail): one row per OWNER, keyed by the effective
// date and the user id, so a second run, a redeploy mid-batch, or two hosts send nothing twice.
// The row is transactional: a notice about a change to a thing the person owns is not marketing.
import { APP_URL, renderHostedFreeNotice, type RenderedEmail } from '@neuramesh/shared';
import type postgres from 'postgres';
import { queueAndSend } from './onauth';
import type { Store } from './store';

/** the day the gate flips (D12). Part of the dedupe key, so a later notice is a new email. */
export const HOSTED_FREE_NOTICE_EFFECTIVE = '2026-09-29';
export const HOSTED_FREE_NOTICE_TEMPLATE = 'hosted_free_notice';

export interface FreeOwner {
  userId: string;
  email: string;
  workspaces: Array<{ id: string; name: string; slug: string }>;
}

/** Every hosted workspace on `free`, grouped by its owner. Owners without an address are skipped and counted. */
export async function hostedFreeOwners(sql: postgres.Sql): Promise<{ owners: FreeOwner[]; noAddress: number }> {
  const rows = await sql`select w.id, w.name, w.slug, u.id as user_id, u.email
    from workspaces w
    join workspace_members m on m.workspace_id = w.id and m.role = 'owner'
    join nm_users u on u.id = m.user_id
    where w.plan = 'free'
    order by u.email, w.created_at`;
  const byUser = new Map<string, FreeOwner>();
  let noAddress = 0;
  for (const r of rows) {
    const email = (r['email'] as string | null)?.trim();
    if (!email) { noAddress++; continue; }
    const userId = r['user_id'] as string;
    const owner = byUser.get(userId) ?? { userId, email, workspaces: [] };
    owner.workspaces.push({ id: r['id'] as string, name: r['name'] as string, slug: r['slug'] as string });
    byUser.set(userId, owner);
  }
  return { owners: [...byUser.values()], noAddress };
}

export function renderNoticeFor(owner: FreeOwner): RenderedEmail {
  return renderHostedFreeNotice({
    workspaces: owner.workspaces.map((w) => w.name),
    effectiveDate: HOSTED_FREE_NOTICE_EFFECTIVE,
    proUrl: `${APP_URL}/pro`,
    termsUrl: `${APP_URL}/terms`,
    exportPath: `GET /v1/workspaces/${owner.workspaces[0]?.id ?? '<workspace id>'}/export`,
  });
}

export const noticeDedupeKey = (userId: string): string => `${HOSTED_FREE_NOTICE_TEMPLATE}:${HOSTED_FREE_NOTICE_EFFECTIVE}:${userId}`;

export type NoticeOutcome = 'listed' | 'sent' | 'skipped' | 'failed' | 'duplicate';

/** List, or send once per owner. Never throws for one bad address: the outcome is per owner. */
export async function notifyHostedFreeOwners(
  store: Store, sql: postgres.Sql, opts: { send: boolean },
): Promise<{ owners: FreeOwner[]; noAddress: number; outcomes: Array<{ email: string; outcome: NoticeOutcome }> }> {
  const { owners, noAddress } = await hostedFreeOwners(sql);
  const outcomes: Array<{ email: string; outcome: NoticeOutcome }> = [];
  for (const owner of owners) {
    if (!opts.send) { outcomes.push({ email: owner.email, outcome: 'listed' }); continue; }
    try {
      const outcome = await queueAndSend(store, {
        userId: owner.userId, toEmail: owner.email, template: HOSTED_FREE_NOTICE_TEMPLATE, kind: 'transactional',
        dedupeKey: noticeDedupeKey(owner.userId), payload: { workspaces: owner.workspaces, effective: HOSTED_FREE_NOTICE_EFFECTIVE },
      }, renderNoticeFor(owner), null);
      outcomes.push({ email: owner.email, outcome });
    } catch (e) {
      console.error(`hosted_free_notice_failed user=${owner.userId}: ${e instanceof Error ? e.message : e}`);
      outcomes.push({ email: owner.email, outcome: 'failed' });
    }
  }
  return { owners, noAddress, outcomes };
}
