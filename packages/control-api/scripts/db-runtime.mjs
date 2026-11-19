const identifier = value => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid database role identifier');
  return `"${value}"`;
};
const quote = value => `"${String(value).replaceAll('"', '""')}"`;

/** Run only in the separately identified bootstrap Job, before assigning the custom role with Pulumi. */
export async function bootstrapRuntimeRole(sql, user = 'nm_api', role = 'nm_runtime') {
  const u = identifier(user), r = identifier(role);
  await sql.begin(async tx => {
    await tx.unsafe(`do $$ begin create role ${r} nologin; exception when duplicate_object then null; end $$;`);
    await tx.unsafe(`alter role ${u} nocreatedb nocreaterole`);
    await tx.unsafe('revoke create on schema public from public');
  });
}

// the group role of the message boards service and the login that joins it. a role belongs to the whole
// instance, so the bootstrap job makes it from a database that can have no schema boards. pulumi makes the
// login only after the role exists: a built-in login with no role assigned joins cloudsqlsuperuser.
// boards.grant_service_role() runs with the rights of its caller: only the owner of schema boards can give
// the rights, and the migration does that when the role exists. so the role must exist before the migration.
export async function bootstrapBoardsRole(sql, role = 'nm_boards', user = 'nm_boards_api') {
  const r = identifier(role), u = identifier(user);
  await sql.unsafe(`do $$ begin create role ${r} nologin; exception when duplicate_object then null; end $$;`);
  const [group] = await sql`select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    from pg_roles where rolname = ${role}`;
  if (!group || Object.values(group).some(value => value === true)) throw new Error('The Message boards group role must have no login and no administrative attribute');
  // the service refuses a login that can make a database or a role, and cloud sql can give both to a new login
  const [login] = await sql`select rolcreatedb or rolcreaterole as wide from pg_roles where rolname = ${user}`;
  if (login?.wide) await sql.unsafe(`alter role ${u} nocreatedb nocreaterole`);
  // only a caller that can use schema boards and run the function asks for the grants. to_regprocedure
  // raises "permission denied for schema" for a caller with no right there, and the migration gives the
  // rights itself when the role exists. the case keeps the order: no schema, no privilege question.
  const [scope] = await sql`select case when to_regnamespace('boards') is null then false
    else has_schema_privilege(current_user, to_regnamespace('boards')::oid, 'USAGE') end as usable`;
  const [grants] = scope.usable
    ? await sql`select case when to_regprocedure('boards.grant_service_role(text)') is null then false
        else has_function_privilege(current_user, to_regprocedure('boards.grant_service_role(text)')::oid, 'EXECUTE') end as present`
    : [{ present: false }];
  const granted = grants.present ? (await sql`select boards.grant_service_role(${role}) as granted`)[0].granted === true : false;
  return { role, user, granted, login: !login ? 'absent' : login.wide ? 'narrowed' : 'ready' };
}

/** The API enforces tenant access; its private backend role needs app data, but no schema or role administration. */
export async function grantRuntimeData(sql, role = 'nm_runtime') {
  const r = identifier(role);
  // a deadlock or a lock that does not come in time ends this transaction with nothing changed, so a
  // second try is safe. the migrations are committed before this call.
  for (let attempt = 1; ; attempt++) {
    try {
      await refreshRuntimeGrants(sql, role, r);
      return;
    } catch (error) {
      if (attempt >= 3 || !['40P01', '55P03'].includes(error?.code)) throw error;
      await new Promise(done => setTimeout(done, 500 * attempt));
    }
  }
}

async function refreshRuntimeGrants(sql, role, r) {
  await sql.begin(async tx => {
    // a policy change takes an exclusive lock on its table. a wait for that lock also stops each new
    // reader of the table, so the wait has a short limit.
    await tx.unsafe(`set local lock_timeout = '5s'`);
    await tx.unsafe(`grant usage on schema public to ${r}`);
    // Historical invoker-rights membership helpers call auth.uid(). Namespace usage and
    // this function are required even though the API authorizes tenancy itself. Keep auth
    // tables and schema creation private.
    const [auth] = await tx`select to_regprocedure('auth.uid()') is not null as available`;
    if (auth.available) {
      await tx.unsafe(`grant usage on schema auth to ${r}`);
      await tx.unsafe(`grant execute on function auth.uid() to ${r}`);
    }
    await tx.unsafe(`grant select, insert, update, delete on all tables in schema public to ${r}`);
    await tx.unsafe(`grant usage, select on all sequences in schema public to ${r}`);
    await tx.unsafe(`alter default privileges in schema public grant select, insert, update, delete on tables to ${r}`);
    await tx.unsafe(`alter default privileges in schema public grant usage, select on sequences to ${r}`);
    // only a table with no correct policy gets one. this function used to drop and create the policy
    // of EVERY table in one transaction. that takes an exclusive lock on each table in turn, and it
    // deadlocks with live readers: on 2026-11-14 the production job applied 0186 and then failed here
    // (40P01), and the same deadlock can end a live API transaction. a table that the migration just
    // made has no reader yet, so its lock comes at once.
    const tables = await tx`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p')
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'nm_control_api'
          and p.polcmd = '*' and p.polpermissive
          and p.polroles = array[(select oid from pg_roles where rolname = ${role})]::oid[]
          and pg_get_expr(p.polqual, p.polrelid) = 'true' and pg_get_expr(p.polwithcheck, p.polrelid) = 'true')
      order by c.relname`;
    // Supabase's historical authenticated-user policies stay intact. This service role is reachable
    // only from the API's authenticated private SQL connection, and has an explicit backend policy.
    for (const { relname } of tables) {
      await tx.unsafe(`drop policy if exists nm_control_api on public.${quote(relname)}`);
      await tx.unsafe(`create policy nm_control_api on public.${quote(relname)} to ${r} using (true) with check (true)`);
    }
    await tx.unsafe(`revoke all on table public.schema_migrations from ${r}`);
    await tx.unsafe(`grant select on table public.schema_migrations to ${r}`);
  });
}

export async function assertRuntimeRole(sql) {
  const [role] = await sql`select r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
    has_schema_privilege(current_user,'public','CREATE') as schema_create,
    coalesce((select pg_has_role(current_user, c.oid, 'member') from pg_roles c where c.rolname='cloudsqlsuperuser'),false) as cloud_admin
    from pg_roles r where r.rolname=current_user`;
  if (!role || Object.values(role).some(value => value === true)) throw new Error('Production API database role must have no administrative or schema-creation privileges');
}
