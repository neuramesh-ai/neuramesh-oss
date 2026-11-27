// The first run's company answers against the real schema (docs/design/onboarding-2026-11 O2, O7):
// a new workspace is born with no marketing setup task, the boot backfill plants one only in a
// workspace that has agents and no profile, and only an owner or an admin answers card 1.
//
// The workspaces stay behind on purpose: `events` is append-only, so every pg test leaves rows.
// Run via scripts/test-pg.sh. Skipped without DATABASE_URL.
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createEvent, formatAddress } from '@neuramesh/shared';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const sql = DB ? postgres(DB) : null;

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

const event = (type: string, workspace = '00000000-0000-0000-0000-000000000000') => createEvent({
  type: type as never,
  source: formatAddress({ kind: 'human', id: 'test' }),
  target: formatAddress({ kind: 'resource', type: 'workspace', id: 'w' }),
  workspace,
  payload: {},
});

async function freshWorkspace(tag: string): Promise<{ workspaceId: string; owner: string }> {
  const [user] = await sql!`insert into nm_users (clerk_user_id, email) values (${`clerk_profile_${tag}`}, ${`${tag}@fieldnote.app`})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  const owner = user!['id'] as string;
  const slug = `profile-${tag}-${Date.now().toString(36)}`;
  const { workspaceId } = await store!.createWorkspace({ name: 'Fieldnote', slug, createdBy: owner }, event('workspace.created'));
  return { workspaceId, owner };
}

const setupTasks = async (workspaceId: string) =>
  Number((await sql!`select count(*) as n from tasks where workspace_id = ${workspaceId}::uuid and kind = 'setup'`)[0]!['n']);

async function staff(workspaceId: string, owner: string): Promise<void> {
  const [m] = await sql!`insert into machines (workspace_id, owner_user_id, name, platform, daemon_version, last_seen_at, runtimes)
    values (${workspaceId}::uuid, ${owner}::uuid, 'profile-host', 'linux', '1', now(), '[]'::jsonb) returning id`;
  await sql!`insert into agents (workspace_id, machine_id, name, role, model)
    values (${workspaceId}::uuid, ${m!['id'] as string}::uuid, 'rex', 'orchestrator', 'gemini-3.5-flash-lite')`;
}

describe.skipIf(!DB)('the company profile and the marketing setup task', () => {
  it('a new workspace is born with no setup task, and the backfill waits for its agents', async () => {
    const { workspaceId } = await freshWorkspace('birth');
    expect(await setupTasks(workspaceId)).toBe(0);
    expect(await store!.backfillSetupTasks(workspaceId)).toBe(0);
  });

  it('the backfill plants the task in a staffed workspace with no profile, as the old wizard left them', async () => {
    const { workspaceId, owner } = await freshWorkspace('old');
    await staff(workspaceId, owner);
    expect(await store!.backfillSetupTasks(workspaceId)).toBe(1);
    expect(await setupTasks(workspaceId)).toBe(1);
  });

  it('the backfill plants nothing once card 1 is answered', async () => {
    const { workspaceId, owner } = await freshWorkspace('new');
    await store!.setWorkspaceProfile(workspaceId, { name: 'Fieldnote app', profile: { sells: 'software', help: ['customers'] }, by: owner }, (w) => event('workspace.profile_set', w));
    await staff(workspaceId, owner);
    expect(await store!.backfillSetupTasks(workspaceId)).toBe(0);
    const [w] = await sql!`select name, profile from workspaces where id = ${workspaceId}::uuid`;
    expect(w!['name']).toBe('Fieldnote app');
    expect(w!['profile']).toMatchObject({ sells: 'software', help: ['customers'] });
    const [listed] = (await store!.listWorkspaces(owner)).filter((x) => x.id === workspaceId);
    expect(listed!.profile).toMatchObject({ sells: 'software' });
  });

  it('refuses a member who is not an owner or an admin', async () => {
    const { workspaceId } = await freshWorkspace('member');
    const [u] = await sql!`insert into nm_users (clerk_user_id, email) values ('clerk_profile_plain', 'plain@fieldnote.app')
      on conflict (clerk_user_id) do update set email = excluded.email returning id`;
    const member = u!['id'] as string;
    await sql!`insert into workspace_members (workspace_id, user_id, role, display_name) values (${workspaceId}::uuid, ${member}::uuid, 'member', 'plain')`;
    await expect(store!.setWorkspaceProfile(workspaceId, { profile: { help: [] }, by: member }, (w) => event('workspace.profile_set', w)))
      .rejects.toMatchObject({ code: 'NOT_PERMITTED' });
  });
});
