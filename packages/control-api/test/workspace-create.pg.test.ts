// What a new workspace's OWNER is called, against the real schema.
//
// The creator's display name is read from `nm_users`, which is where an identity's address lives
// in the Clerk world. It used to read `auth.users` (Supabase), which holds no row for a Clerk
// identity, so the fallback won every time and every new workspace's owner was named the literal
// word "owner". Nothing failed: the greeting simply said "Good afternoon, owner" on every client
// (found while reviewing the phone's copy, 2026-09-05).
//
// The workspaces stay behind on purpose: `events` is append-only (a trigger refuses the delete
// that a workspace cascade would perform), so every pg test leaves its rows in the dev database.
//
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresStore } from '../src/pgstore';
import { createEvent, formatAddress } from '@neuramesh/shared';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const sql = DB ? postgres(DB) : null;

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

const event = (slug: string) => createEvent({
  type: 'workspace.created',
  source: formatAddress({ kind: 'human', id: 'test' }),
  target: formatAddress({ kind: 'resource', type: 'workspace', id: slug }),
  workspace: '00000000-0000-0000-0000-000000000000',
  payload: { slug },
});

describe.skipIf(!DB)('workspace.create names its owner', () => {
  it('takes the display name from the creator’s address, not the word "owner"', async () => {
    const [user] = await sql!`insert into nm_users (clerk_user_id, email) values ('clerk_wsname', 'dana@vertex.dev')
      on conflict (clerk_user_id) do update set email = excluded.email returning id`;
    const owner = user!['id'] as string;
    const slug = `vertex-${Date.now().toString(36)}`;
    const { workspaceId } = await store!.createWorkspace({ name: 'Vertex Systems', slug, createdBy: owner }, event(slug));

    const [member] = await sql!`select role, display_name from workspace_members
      where workspace_id = ${workspaceId}::uuid and user_id = ${owner}::uuid`;
    expect(member!['role']).toBe('owner');
    expect(member!['display_name']).toBe('dana');

  });

  it('falls back to "owner" when the identity has no address on file', async () => {
    const [user] = await sql!`insert into nm_users (clerk_user_id, email) values ('clerk_wsnoaddr', null)
      on conflict (clerk_user_id) do update set email = null returning id`;
    const owner = user!['id'] as string;
    const slug = `nameless-${Date.now().toString(36)}`;
    const { workspaceId } = await store!.createWorkspace({ name: 'Nameless', slug, createdBy: owner }, event(slug));

    const [member] = await sql!`select display_name from workspace_members
      where workspace_id = ${workspaceId}::uuid and user_id = ${owner}::uuid`;
    expect(member!['display_name']).toBe('owner');

  });
});
