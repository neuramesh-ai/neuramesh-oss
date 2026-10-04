// the Pro trial's birth rides workspace.create (workspace-birth.ts), against the REAL schema. a
// person's first workspace gets 500 credits and the cloud machine, whatever door made it, also
// with an invitation waiting (the phone's "Set up my own workspace"). a second workspace, or one
// made by a member of another workspace, gets neither. before, only the first sign-in granted.
// run via scripts/test-pg.sh, skipped without DATABASE_URL.
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/handler';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const sql = DB ? postgres(DB) : null;

afterAll(async () => { await sql?.end(); await store?.close(); });

async function person(tag: string): Promise<string> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${`clerk_birth_${tag}`}, ${`birth-${tag}@sign.test`}) returning id`;
  return row!['id'] as string;
}

async function create(userId: string, slug: string): Promise<string> {
  const made = (await executeCommand(store!, { kind: 'human', id: userId }, { type: 'workspace.create', name: slug, slug })) as unknown as { workspaceId: string };
  return made.workspaceId;
}

async function trialOf(workspaceId: string): Promise<{ grants: number; micros: number; runners: Array<Record<string, unknown>> }> {
  const [g] = await sql!`select count(*)::int as c, coalesce(sum(micros), 0)::bigint as micros from credit_grants where workspace_id = ${workspaceId}::uuid and kind = 'signup'`;
  const runners = await sql!`select kind, owner_user_id, desired_replicas from machines where workspace_id = ${workspaceId}::uuid and kind = 'runner'`;
  return { grants: Number(g!['c']), micros: Number(g!['micros']), runners: [...runners] };
}

describe.skipIf(!DB)('workspace.create gives the first owned workspace its trial (postgres)', () => {
  // the pg lane runs with FLEET_AUTOPROVISION=off, so each test turns the fleet on for itself
  const withFleet = async (fn: () => Promise<void>): Promise<void> => {
    const prev = process.env['FLEET_AUTOPROVISION'];
    process.env['FLEET_AUTOPROVISION'] = 'on';
    try { await fn(); } finally {
      if (prev === undefined) delete process.env['FLEET_AUTOPROVISION']; else process.env['FLEET_AUTOPROVISION'] = prev;
    }
  };

  it('the wizard’s own workspace gets 500 credits and a runner, a second one gets neither', () => withFleet(async () => {
    const tag = Date.now().toString(36);
    const userId = await person(tag);
    const first = await create(userId, `birth-${tag}`);
    const second = await create(userId, `birth-two-${tag}`);

    const one = await trialOf(first);
    expect(one.grants).toBe(1);
    expect(one.micros).toBe(500 * 10_000);
    expect(one.runners).toHaveLength(1);
    expect(one.runners[0]).toMatchObject({ kind: 'runner', owner_user_id: userId, desired_replicas: 1 });

    const two = await trialOf(second);
    expect(two.grants).toBe(0);
    expect(two.runners).toHaveLength(0);
  }));

  it('an invitation waiting does not stop it: "Set up my own workspace" gets the trial', () => withFleet(async () => {
    const tag = `${Date.now().toString(36)}i`;
    const host = await person(`${tag}host`);
    const guest = await person(`${tag}guest`);
    const hosted = await create(host, `birth-host-${tag}`);
    await sql!`update workspaces set plan = 'cloud' where id = ${hosted}::uuid`; // only Pro invites
    await executeCommand(store!, { kind: 'human', id: host }, { type: 'workspace.invite', workspace: hosted, email: `birth-${tag}guest@sign.test`, memberRole: 'member' });

    const own = await create(guest, `birth-guest-${tag}`);
    const t = await trialOf(own);
    expect(t.grants).toBe(1);
    expect(t.runners).toHaveLength(1);
    expect(t.runners[0]).toMatchObject({ owner_user_id: guest });
  }));

  it('a member of another workspace gets no second trial on a workspace they make', () => withFleet(async () => {
    const tag = `${Date.now().toString(36)}m`;
    const host = await person(`${tag}host`);
    const member = await person(`${tag}member`);
    const hosted = await create(host, `birth-team-${tag}`);
    await sql!`insert into workspace_members (workspace_id, user_id, role) values (${hosted}::uuid, ${member}::uuid, 'member')`;

    const theirs = await create(member, `birth-member-${tag}`);
    const t = await trialOf(theirs);
    expect(t.grants).toBe(0);
    expect(t.runners).toHaveLength(0);
  }));
});
