// A DELETED ACCOUNT TAKES ITS SIGN-IN IDENTITY WITH IT (the security lane's review, 2026-11-13, and
// NM-116 of the fork). account.delete removed only the nm_users row, so the Clerk user and its sessions
// lived on, and the next sign-in made a fresh row: no proof flag for a self-asserted address (NM-010)
// and no credit marker (NM-024). delete the workspace, delete the account, sign in again, repeat.
import { CLERK_UA } from './clerk';
import { DomainError } from './errors';

/** 'skipped' when this deploy runs no Clerk, or the identity is not a Clerk one (a local or a test
 *  identity). A user that Clerk no longer has (404) counts as deleted. A failure THROWS, so the caller
 *  keeps the row and a second try can finish. */
export async function clerkDeleteUser(clerkUserId: string | null | undefined): Promise<'deleted' | 'skipped'> {
  const key = process.env['CLERK_SECRET_KEY'];
  if (!key || !clerkUserId || !/^user_[A-Za-z0-9]+$/.test(clerkUserId)) return 'skipped';
  let res: Response;
  try {
    res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}`, 'user-agent': CLERK_UA },
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    throw new DomainError('AUTH_DELETE_FAILED', `the sign-in account could not be deleted: ${e instanceof Error ? e.message : 'fetch failed'}`);
  }
  if (res.ok || res.status === 404) return 'deleted';
  throw new DomainError('AUTH_DELETE_FAILED', `the sign-in account could not be deleted (${res.status})`);
}
