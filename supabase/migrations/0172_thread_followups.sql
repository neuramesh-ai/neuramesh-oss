-- The inbox owns the user's prompt until either a normal message or a runtime acknowledgement
-- takes its place. An authenticated machine cannot change the author or body during delivery.
create table thread_followups (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  thread_id uuid not null references threads(id) on delete cascade,
  author_id uuid not null,
  after_message_id uuid references messages(id) on delete set null,
  machine_id uuid references machines(id) on delete set null,
  attachments jsonb not null default '[]',
  body text not null check (length(body) between 1 and 64000),
  state text not null default 'queued' check (state in ('queued','steer','applying','delivered','cancelled','failed')),
  requested_steer boolean not null default false,
  handled_in_run boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index thread_followups_pending on thread_followups(workspace_id,thread_id,created_at,id)
  where state in ('queued','steer','applying','failed');
alter table thread_followups enable row level security;
alter table messages add column applied_followup boolean not null default false;

create unique index thread_followups_one_delivery on thread_followups(thread_id) where state='applying';
-- The replica announces work to its machine without replicating private prompt bodies.
alter table threads add column followup_count integer not null default 0 check (followup_count>=0);
create function refresh_thread_followups() returns trigger language plpgsql as $$
declare delta integer;
begin
  delta := (new.state in ('queued','steer','applying'))::integer;
  if tg_op='UPDATE' then delta := delta - (old.state in ('queued','steer','applying'))::integer; end if;
  if delta<>0 then update threads set followup_count=followup_count+delta where id=new.thread_id; end if;
  return null;
end $$;
create trigger thread_followups_signal after insert or update of state on thread_followups
  for each row execute function refresh_thread_followups();
