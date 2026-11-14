import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertRuntimeRole, bootstrapRuntimeRole, grantRuntimeData } from '../scripts/db-runtime.mjs';

const DB = process.env['DATABASE_URL'];
if (DB && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(DB).hostname)) throw new Error('Runtime role tests require an isolated loopback database');
const suffix = `${process.pid}_${Date.now().toString(36)}`;
const database = `nm_acl_${suffix}`, user = `nm_api_${suffix}`, role = `nm_data_${suffix}`;
const password = randomBytes(24).toString('hex');
const admin = DB ? postgres(DB, { max: 1, onnotice: () => {} }) : null;
let owner: postgres.Sql | undefined;
let api: postgres.Sql | undefined;

describe.skipIf(!DB)('production API database privileges', () => {
  beforeAll(async () => {
    await admin!.unsafe(`create database "${database}"`);
    await admin!.unsafe(`create role "${user}" login createdb createrole password '${password}'`);
    owner = postgres(DB!, { database, max: 1, onnotice: () => {} });
    await owner.unsafe('create table runtime_probe(id text primary key, value text); alter table runtime_probe enable row level security; create table schema_migrations(name text primary key)');
    // Match the historical invoker-rights helper used by replica reads. Exercise it directly
    // below: a permissive policy can let the optimizer skip it in a simple CRUD probe.
    await owner.unsafe(`create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      revoke all on function auth.uid() from public;
      create table runtime_members(workspace_id uuid,user_id uuid);
      create function runtime_is_member(ws uuid) returns boolean language sql stable as $$
        select exists(select 1 from runtime_members m where m.workspace_id=ws and m.user_id=auth.uid())
      $$;
      create policy legacy_read on runtime_probe for select
        using(runtime_is_member('00000000-0000-0000-0000-000000000001'::uuid));`);
    await owner`insert into runtime_probe values ('fixture','private app data')`;
    await owner`insert into schema_migrations values ('0177_thread_intake.sql')`;
    api = postgres(DB!, { database, username: user, password, max: 1, prepare: false, onnotice: () => {} });
  });
  afterAll(async () => {
    await api?.end({ timeout: 2 }); await owner?.end({ timeout: 2 });
    if (admin) {
      await admin.unsafe(`drop database if exists "${database}" with (force)`);
      await admin.unsafe(`drop role if exists "${user}"`);
      await admin.unsafe(`drop role if exists "${role}"`);
      await admin.end({ timeout: 2 });
    }
  });
  it('serves real app data under RLS while refusing schema, role and migration-ledger writes', async () => {
    await expect(assertRuntimeRole(api!)).rejects.toThrow('administrative');
    await bootstrapRuntimeRole(owner!, user, role);
    // Cloud SQL User.databaseRoles assigns this membership in production through Pulumi.
    await owner!.unsafe(`grant "${role}" to "${user}"`);
    await grantRuntimeData(owner!, role);
    await expect(assertRuntimeRole(api!)).resolves.toBeUndefined();
    const [flags] = await api!`select rolbypassrls from pg_roles where rolname=current_user`;
    expect(flags!['rolbypassrls']).toBe(false);
    expect((await api!`select value from runtime_probe`)[0]!['value']).toBe('private app data');
    expect((await api!`select runtime_is_member('00000000-0000-0000-0000-000000000001'::uuid) as member`)[0]!['member']).toBe(false);
    await api!`insert into runtime_probe values ('new','created')`;
    await api!`update runtime_probe set value='updated' where id='new'`;
    await api!`delete from runtime_probe where id='new'`;
    expect((await api!`select name from schema_migrations`)[0]!['name']).toBe('0177_thread_intake.sql');
    await expect(api!.unsafe('create table public.disallowed(id int)')).rejects.toThrow();
    await expect(api!.unsafe('create table auth.disallowed(id int)')).rejects.toThrow();
    await expect(api!`select * from auth.users`).rejects.toThrow();
    await expect(api!.unsafe('alter table runtime_probe disable row level security')).rejects.toThrow();
    await expect(api!.unsafe('truncate runtime_probe')).rejects.toThrow();
    await expect(api!`insert into schema_migrations values ('forged')`).rejects.toThrow();
    await expect(api!.unsafe(`create role "nm_denied_${suffix}"`)).rejects.toThrow();
  });

  // production, 2026-11-14: the refresh dropped and made the policy of every table in one transaction.
  // it met live readers, lost a deadlock (40P01) after the job applied 0186, and the job ended red.
  it('refreshes the grants while a reader holds a table, and leaves a correct policy alone', async () => {
    const policy = async (table: string) => (await owner!`select p.oid::int as oid, pg_get_expr(p.polqual, p.polrelid) as qual,
      (select array_agg(r.rolname::text) from pg_roles r where r.oid = any(p.polroles)) as roles
      from pg_policy p where p.polname = 'nm_control_api' and p.polrelid = ${table}::regclass`)[0];
    const first = await policy('runtime_probe');
    expect(first).toMatchObject({ qual: 'true', roles: [role] });
    const reader = postgres(DB!, { database, max: 1, onnotice: () => {} });
    let release = (): void => {};
    const held = new Promise<void>(done => { release = done; });
    let reading = (): void => {};
    const began = new Promise<void>(done => { reading = done; });
    // an open transaction that read the table: a policy change on that table waits for its end
    const open = reader.begin(async tx => { await tx`select 1 from runtime_probe`; reading(); await held; });
    try {
      await began;
      const outcome = await Promise.race([
        grantRuntimeData(owner!, role).then(() => 'done'),
        new Promise<string>(done => setTimeout(() => done('blocked'), 4000)),
      ]);
      expect(outcome).toBe('done');
      expect((await policy('runtime_probe'))!['oid']).toBe(first!['oid']);
    } finally {
      release();
      await open;
      await reader.end({ timeout: 2 });
    }
    // a table that a migration just made gets the policy, and a policy with a different rule is replaced
    await owner!.unsafe(`create table runtime_new(id text primary key); alter table runtime_new enable row level security;
      create table runtime_stale(id text primary key); alter table runtime_stale enable row level security;
      create policy nm_control_api on runtime_stale using (false)`);
    await grantRuntimeData(owner!, role);
    expect(await policy('runtime_new')).toMatchObject({ qual: 'true', roles: [role] });
    expect(await policy('runtime_stale')).toMatchObject({ qual: 'true', roles: [role] });
    await api!`insert into runtime_new values ('row')`;
    expect((await api!`select id from runtime_new`)[0]!['id']).toBe('row');
  });
});
