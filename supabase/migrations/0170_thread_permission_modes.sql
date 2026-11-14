-- Settings are written through the authenticated control API. Keep them outside
-- user-editable message metadata, provider transcripts and client-side tool input.
alter table workspaces add column permission_mode text not null default 'default'
  check (permission_mode in ('request-review','default','auto-review','turbo'));
alter table machines add column permission_version integer not null default 0;
alter table threads add column permission_mode text
  check (permission_mode in ('request-review','default','auto-review','turbo'));
alter table threads add column legacy_coding_permissions boolean not null default false;
update threads set legacy_coding_permissions=true where kind='coding';

-- Machine-authored openers may use human authorship for display. They cannot approve a release.
alter table messages add column machine_authored boolean not null default false;

-- Only the scheduler which won the slot receives its single-use receipt.
-- Receipts are server-side, outside PowerSync, messages, and tool transcripts.
create table permission_schedule_claims (
  schedule_id uuid not null references schedules(id) on delete cascade,
  slot integer not null,
  token_hash text,
  message_id uuid unique references messages(id) on delete cascade,
  expires_at timestamptz not null default now()+interval '2 hours',
  primary key(schedule_id,slot)
);
alter table permission_schedule_claims enable row level security;
alter table tasks add column permission_run_message_id uuid references messages(id) on delete set null;
alter table tasks add column permission_mode text
  check (permission_mode in ('request-review','default','auto-review','turbo'));

-- Operation approvals can only be answered by decision ID. Legacy Q&A text may
-- still resolve ordinary questions, but two identical tool calls are distinct.
alter table decisions add column requires_exact_answer boolean not null default false;
update decisions d set requires_exact_answer=true from messages m
 where m.id=d.message_id and d.status='open' and m.body ~ '"kind"[[:space:]]*:[[:space:]]*"permission"';
