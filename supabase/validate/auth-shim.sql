-- Local-validation shim only: emulates the pieces of Supabase's auth schema
-- the migration references. Never apply to a real Supabase project.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
