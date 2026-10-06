// The GitHub owner proof's rows on postgres (0149): a new proof replaces the person's rows, the read
// counts a row for 24 hours and only while its person is a member, ids past 2^31 survive the round
// trip, and the row belongs to the membership (a non-member cannot hold one, and leaving deletes it).
// Also the installation record that a connect with the proof on writes (`keepWorkspace`).
// Runs only against a real database (scripts/test-pg.sh); rls.pg.test.ts covers the table's RLS.
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const sql = DB ? postgres(DB) : null;
const WS = 'a0000000-0000-0000-0000-00000000000a';
const GEORGE = '00000000-0000-0000-0000-000000000001';
// this suite makes its OWN member, so a sibling file's rows are never a fixture
const PAT = 'b7000000-0000-4000-8000-0000000000a1';
const OTHER = 'b7000000-0000-4000-8000-0000000000b1';   // a second workspace, for a record that names another one
const BIG = 3_000_000_123;   // past 2^31: an int4 array would refuse it

beforeAll(async () => {
  if (!sql) return;
  await sql`insert into nm_users (id, clerk_user_id, email) values (${PAT}::uuid, ${PAT}, 'pat@proof.test') on conflict (id) do nothing`;
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${WS}::uuid, ${PAT}::uuid, 'member') on conflict do nothing`;
  await sql`insert into workspaces (id, name, slug, created_by) values (${OTHER}::uuid, 'Proof other', 'proof-other-b1', ${GEORGE}::uuid) on conflict (id) do nothing`;
});

afterAll(async () => {
  if (sql) {
    await sql`delete from github_repo_proofs where workspace_id = ${WS}::uuid and actor_id in (${GEORGE}::uuid, ${PAT}::uuid)`;
    await sql`delete from workspace_members where workspace_id = ${WS}::uuid and user_id = ${PAT}::uuid`;
    await sql`delete from nm_users where id = ${PAT}::uuid`;
    await sql`delete from github_installations where installation_id = 990201`;
    await sql`delete from workspaces where id = ${OTHER}::uuid`;
    await sql.end();
  }
  await store?.close();
});

describe.skipIf(!DB)('github_repo_proofs on postgres (0149)', () => {
  it('a new proof replaces the person\'s rows, one row per installation, and big ids come back whole', async () => {
    const proofs = store!.githubProofs;
    await proofs.replace(WS, GEORGE, [
      { installationId: 990101, githubUserId: 11, githubLogin: 'george-gh', repoIds: [1001, BIG], repos: ['Acme/Site', 'acme/docs'] },
      { installationId: BIG, githubUserId: 11, githubLogin: 'george-gh', repoIds: [77], repos: ['other/x'] },
    ]);
    expect(await proofs.fresh(WS, GEORGE)).toEqual([
      { installationId: 990101, githubUserId: 11, githubLogin: 'george-gh', repoIds: [1001, BIG], repos: ['acme/site', 'acme/docs'], provenAt: expect.any(String) },
      { installationId: BIG, githubUserId: 11, githubLogin: 'george-gh', repoIds: [77], repos: ['other/x'], provenAt: expect.any(String) },
    ]);
    // the next proof is the whole truth: the installation it does not list is gone
    await proofs.replace(WS, GEORGE, [{ installationId: 990101, githubUserId: 11, githubLogin: 'george-gh', repoIds: [1001], repos: ['acme/site'] }]);
    expect((await proofs.fresh(WS, GEORGE)).map((p) => [p.installationId, p.repos])).toEqual([[990101, ['acme/site']]]);
    // another person's rows are their own
    expect(await proofs.fresh(WS, PAT)).toEqual([]);
  });

  it('a row counts for 24 hours, and forget deletes the person\'s rows', async () => {
    const proofs = store!.githubProofs;
    await proofs.replace(WS, GEORGE, [{ installationId: 990102, githubUserId: 11, githubLogin: 'george-gh', repoIds: [1], repos: ['acme/a'] }]);
    await sql!`update github_repo_proofs set proven_at = now() - interval '25 hours' where workspace_id = ${WS}::uuid and actor_id = ${GEORGE}::uuid`;
    expect(await proofs.fresh(WS, GEORGE)).toEqual([]);
    await sql!`update github_repo_proofs set proven_at = now() - interval '23 hours' where workspace_id = ${WS}::uuid and actor_id = ${GEORGE}::uuid`;
    expect(await proofs.fresh(WS, GEORGE)).toHaveLength(1);
    await proofs.forget(WS, GEORGE);
    const [n] = await sql!`select count(*)::int as n from github_repo_proofs where workspace_id = ${WS}::uuid and actor_id = ${GEORGE}::uuid`;
    expect(n!['n']).toBe(0);
  });

  it('the row belongs to the membership: a non-member cannot hold one, and leaving deletes it', async () => {
    const proofs = store!.githubProofs;
    await expect(proofs.replace(WS, 'b7000000-0000-4000-8000-0000000000ff', [{ installationId: 1, githubUserId: 1, githubLogin: 'x', repoIds: [1], repos: ['a/b'] }])).rejects.toThrow(/foreign key/);
    await proofs.replace(WS, PAT, [{ installationId: 990103, githubUserId: 22, githubLogin: 'pat-gh', repoIds: [5], repos: ['acme/pat'] }]);
    expect(await proofs.fresh(WS, PAT)).toHaveLength(1);
    await sql!`delete from workspace_members where workspace_id = ${WS}::uuid and user_id = ${PAT}::uuid`;
    const [n] = await sql!`select count(*)::int as n from github_repo_proofs where actor_id = ${PAT}::uuid`;
    expect(n!['n']).toBe(0);
    expect(await proofs.fresh(WS, PAT)).toEqual([]);
  });

  it('a connect with the proof on: a record that names no workspace takes the room\'s, and a workspace it names stays', async () => {
    const ann = store!.announcements;
    const named = async (): Promise<unknown> => (await sql!`select workspace_id from github_installations where installation_id = 990201`)[0]!['workspace_id'];
    await ann.upsertInstallation({ installationId: 990201, account: 'acme', repos: ['acme/a'], workspaceId: null });   // the public door's
    await ann.upsertInstallation({ installationId: 990201, account: 'acme', repos: ['acme/a', 'acme/b'], workspaceId: WS, keepWorkspace: true });
    expect(await named()).toBe(WS);
    await ann.upsertInstallation({ installationId: 990201, account: 'acme', repos: ['acme/a'], workspaceId: OTHER, keepWorkspace: true });
    expect(await named()).toBe(WS);
    // the old doors name no keepWorkspace, and the workspace they name still wins
    await ann.upsertInstallation({ installationId: 990201, account: 'acme', repos: ['acme/a'], workspaceId: OTHER });
    expect(await named()).toBe(OTHER);
  });
});
