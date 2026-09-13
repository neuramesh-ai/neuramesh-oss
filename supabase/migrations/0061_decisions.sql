-- Decisions (docs/12 slice 2): every ```nmq question card an agent posts becomes a
-- first-class row with authoritative open/answered state. Rows are created by the
-- SERVER inside POST /v1/messages — the one choke point every card already flows
-- through (the daemon's deterministic cards AND the LLM-authored ones its prompts
-- instruct) — transactionally with the message insert, so a card without a decision
-- row is impossible by construction (enforced, not prompted). Mission Control renders
-- open rows as answer-in-place cards; the thread card reads this status instead of
-- string-matching answer lines (string-match stays as the fallback for pre-0061
-- history). New synced table → publication (0062_publish_decisions.sql, prod;
-- dev/CI list it in dev/stack/init/99-publication.sql) + the sync rules.
create type decision_status as enum ('open', 'answered', 'dismissed');

create table decisions (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces (id) on delete cascade,
  channel_id       uuid not null references channels (id) on delete cascade,
  task_id          uuid references tasks (id) on delete cascade,          -- null = channel-level card
  message_id       uuid not null references messages (id) on delete cascade, -- the card-bearing message (the client's join key)
  asker_kind       actor_kind not null,
  asker_id         uuid not null,
  question         text not null,
  options          jsonb not null default '[]'::jsonb,                    -- [{label, description?}]
  allow_other      boolean not null default true,                         -- mirrors NmQuestion: absent = true
  status           decision_status not null default 'open',
  answer           text,
  answered_by_kind actor_kind,
  answered_by_id   uuid,
  created_at       timestamptz not null default now(),
  answered_at      timestamptz
);
create index decisions_ws_status on decisions (workspace_id, status);
create index decisions_message on decisions (message_id);

alter table decisions enable row level security;
create policy members_read on decisions for select using (nm_is_member(workspace_id));
