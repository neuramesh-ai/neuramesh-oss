import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapBoardsRole } from '../scripts/db-runtime.mjs';

const DB = process.env['DATABASE_URL'];
if (DB && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(DB).hostname)) throw new Error('Boards role tests require an isolated loopback database');
// every name is of this run: a call with the default names would change a real nm_boards_api on a shared server
const suffix = `${process.pid}_${Date.now().toString(36)}`;
const role = `nm_boards_${suffix}`, user = `nm_boards_api_${suffix}`, wrong = `nm_boards_login_${suffix}`, database = `nm_boards_empty_${suffix}`;
const outsider = `nm_boards_outsider_${suffix}`, second = `nm_boards_second_${suffix}`;
const admin = DB ? postgres(DB, { max: 1, onnotice: () => {} }) : null;
let empty: postgres.Sql | undefined;

const attributes = async (name: string) =>
  admin!`select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_roles where rolname = ${name}`;

describe.skipIf(!DB)('Message boards group role', () => {
  beforeAll(async () => {
    await admin!.unsafe(`create database "${database}"`);
    empty = postgres(DB!, { database, max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    await empty?.end({ timeout: 2 });
    if (admin) {
      await admin.unsafe(`drop database if exists "${database}" with (force)`);
      for (const name of [user, wrong, role, second, outsider]) await admin.unsafe(`drop role if exists "${name}"`);
      await admin.end({ timeout: 2 });
    }
  });

  // production: the bootstrap job connects to a database that does not hold schema boards
  it('makes a role with no login from a database that has no schema boards, and a second call changes nothing', async () => {
    expect(await bootstrapBoardsRole(empty!, role, user)).toEqual({ role, user, granted: false, login: 'absent' });
    const first = await attributes(role);
    expect(first).toHaveLength(1);
    expect(Object.values(first[0]!)).toEqual([false, false, false, false, false, false]);
    expect(await bootstrapBoardsRole(empty!, role, user)).toEqual({ role, user, granted: false, login: 'absent' });
    expect(await attributes(role)).toEqual(first);
  });

  it('takes the right to make a database or a role from the login, and keeps its membership', async () => {
    await bootstrapBoardsRole(empty!, role, user);
    await admin!.unsafe(`create role "${user}" login createdb createrole in role "${role}"`);
    expect(await bootstrapBoardsRole(empty!, role, user)).toMatchObject({ login: 'narrowed' });
    expect(Object.values((await attributes(user))[0]!)).toEqual([true, false, false, false, false, false]);
    expect(await bootstrapBoardsRole(empty!, role, user)).toMatchObject({ login: 'ready' });
    const [member] = await admin!`select pg_has_role(${user}, ${role}, 'member') as yes`;
    expect(member!['yes']).toBe(true);
  });

  it('gives the rights of the migration, and no more, where schema boards exists', async () => {
    const rollback = new Error('rollback');
    try {
      await admin!.begin(async tx => {
        const [migration] = await tx`select to_regprocedure('boards.grant_service_role(text)') is not null as present`;
        expect(migration!['present'], 'this suite needs the full schema: migration 0187 must be applied').toBe(true);
        expect(await bootstrapBoardsRole(tx, role, user)).toMatchObject({ role, granted: true });
        expect(await bootstrapBoardsRole(tx, role, user)).toMatchObject({ role, granted: true });
        const [rights] = await tx`select
          has_schema_privilege(${role}, 'boards', 'USAGE') as boards_use,
          has_schema_privilege(${role}, 'boards', 'CREATE') as boards_create,
          has_table_privilege(${role}, 'boards.access_log', 'INSERT') as log_insert,
          has_table_privilege(${role}, 'boards.access_log', 'DELETE') as log_delete,
          has_table_privilege(${role}, 'public.agents', 'SELECT') as core_read`;
        expect(rights).toMatchObject({ boards_use: true, boards_create: false, log_insert: true, log_delete: false, core_read: false });
        expect(Object.values((await tx`select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = ${role}`)[0]!)).toEqual([false, false, false, false]);
        throw rollback;
      });
    } catch (e) { if (e !== rollback) throw e; }
    // the shared test database keeps no right of this run
    const after = await admin!`select has_schema_privilege(r.oid, 'boards', 'USAGE') as boards_use from pg_roles r where r.rolname = ${role}`;
    expect(after.every(row => row['boards_use'] === false)).toBe(true);
  });

  // cloud sql: the bootstrap login can make a role, and it has no right on a schema that nm_migrate owns
  it('asks for no grant when the caller cannot use schema boards', async () => {
    await admin!.unsafe(`create role "${outsider}" login createrole password '${suffix}'`);
    const url = new URL(DB!);
    url.username = outsider; url.password = suffix;
    const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      await expect(sql`select to_regprocedure('boards.grant_service_role(text)') is not null as present`).rejects.toThrow('permission denied for schema boards');
      expect(await bootstrapBoardsRole(sql, second, user)).toMatchObject({ role: second, granted: false });
      expect(Object.values((await attributes(second))[0]!)).toEqual([false, false, false, false, false, false]);
    } finally { await sql.end({ timeout: 2 }); }
  });

  it('refuses a group role that can sign in, and a name that is not a plain identifier', async () => {
    await admin!.unsafe(`create role "${wrong}" login`);
    await expect(bootstrapBoardsRole(admin!, wrong, user)).rejects.toThrow('no login');
    expect(Object.values((await attributes(wrong))[0]!)[0]).toBe(true);
    await expect(bootstrapBoardsRole(admin!, 'nm_boards"; drop role x', user)).rejects.toThrow('Invalid database role identifier');
    await expect(bootstrapBoardsRole(admin!, role, 'nm_boards_api; drop role x')).rejects.toThrow('Invalid database role identifier');
  });
});
