// The local stack's human, on postgres (0138; local-auth.ts is the caller). Extracted from
// pgstore.ts the way relay/lifecycle delegates were: the pgstore ratchet cap leaves no room.
import type postgres from 'postgres';

export interface LocalUserSeed {
  clerkUserId: string;
  email: string;
  tokenHash: string;
}

/** upsert the one local user and stamp its bearer hash — idempotent, and a re-seed ROTATES the hash */
export async function seedLocalUserSql(sql: postgres.Sql, input: LocalUserSeed): Promise<{ id: string }> {
  // onboarding_at is set on insert only, exactly as resolveClerkUser does at first sign-in
  const [row] = await sql`insert into nm_users (clerk_user_id, email, onboarding_at, local_token_hash)
    values (${input.clerkUserId}, ${input.email}, now(), ${input.tokenHash})
    on conflict (clerk_user_id) do update
      set local_token_hash = excluded.local_token_hash, email = coalesce(nm_users.email, excluded.email)
    returning id`;
  return { id: row!['id'] as string };
}

export async function userIdForLocalTokenHashSql(sql: postgres.Sql, hash: string): Promise<string | null> {
  const [row] = await sql`select id from nm_users where local_token_hash = ${hash}`;
  return (row?.['id'] as string | undefined) ?? null;
}

/** the last applied migration's name, or null on a database the runner never tracked (the test lane) */
export async function schemaVersionSql(sql: postgres.Sql): Promise<string | null> {
  const [t] = await sql`select to_regclass('public.schema_migrations') as t`;
  if (!t?.['t']) return null;
  const [row] = await sql`select name from schema_migrations order by name desc limit 1`;
  return (row?.['name'] as string | undefined) ?? null;
}
