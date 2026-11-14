// account.delete takes the sign-in identity with it (clerk-delete.ts): with the Clerk user alive, the
// next sign-in made a fresh row with no proof flag and no credit marker.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clerkDeleteUser } from '../src/clerk-delete';
import { DomainError } from '../src/errors';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const answer = (status: number) => vi.fn(async () => new Response('{}', { status }));

describe('clerkDeleteUser', () => {
  it('deletes the Clerk user with the secret key, and a user that Clerk no longer has counts as deleted', async () => {
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_x');
    const fetchFn = answer(200);
    vi.stubGlobal('fetch', fetchFn);
    expect(await clerkDeleteUser('user_2abcDEF')).toBe('deleted');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe('https://api.clerk.com/v1/users/user_2abcDEF');
    expect(init.method).toBe('DELETE');
    expect(init.headers['Authorization']).toBe('Bearer sk_test_x');
    vi.stubGlobal('fetch', answer(404));
    expect(await clerkDeleteUser('user_2abcDEF')).toBe('deleted');
  });

  it('a failure throws, so the caller keeps the account row and a second try can finish', async () => {
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_x');
    vi.stubGlobal('fetch', answer(500));
    await expect(clerkDeleteUser('user_2abcDEF')).rejects.toMatchObject({ code: 'AUTH_DELETE_FAILED', status: 502 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
    await expect(clerkDeleteUser('user_2abcDEF')).rejects.toBeInstanceOf(DomainError);
  });

  it('makes no call with no Clerk on this deploy, or for an identity that is not a Clerk one', async () => {
    const fetchFn = answer(200);
    vi.stubGlobal('fetch', fetchFn);
    vi.stubEnv('CLERK_SECRET_KEY', '');
    expect(await clerkDeleteUser('user_2abcDEF')).toBe('skipped');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_x');
    for (const id of [null, undefined, '', 'e2e|someone@example.com', 'local-user', 'user_../../sessions']) expect(await clerkDeleteUser(id)).toBe('skipped');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
