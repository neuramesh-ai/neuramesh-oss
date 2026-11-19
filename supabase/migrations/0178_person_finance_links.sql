-- Person-owned credentials: never part of the workspace changefeed or PowerSync publication.
create table person_finance_links (
  user_id uuid primary key references nm_users(id) on delete cascade,
  session uuid not null,
  sealed_secret text not null,
  origin text not null,
  intent text not null check (intent in ('create','connect')),
  updated_at timestamptz not null default now()
);
alter table person_finance_links enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on person_finance_links from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on person_finance_links from authenticated;
  end if;
end $$;
