-- PowerSync keys every replicated row by a single `id` column. Tables with
-- only a composite PK replicate with row_id='' and collapse to one visible
-- row (second agent registration silently hid the first). Rule, enforced by
-- the PG suite: every table in the powersync publication has an `id`.
alter table agent_channels add column id uuid not null default gen_random_uuid();
create unique index agent_channels_id on agent_channels (id);

alter table workspace_members add column id uuid not null default gen_random_uuid();
create unique index workspace_members_id on workspace_members (id);
