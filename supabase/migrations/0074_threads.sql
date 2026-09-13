-- Conversation threads (the conversation-first shell): every send from Home starts a
-- thread — chat-first, task-ready. A thread is the durable grouping for its messages
-- (messages.thread_id); when the orchestrator fans a task out OF a conversation the
-- thread links to it (threads.task_id) and the surface upgrades in place — the chat
-- thread IS the task thread from then on. Task-thread messages keep task_id exactly
-- as today; thread_id is additive, so nothing existing re-routes.
-- Title/description are born from a server-side heuristic at creation and may be
-- refined later by the orchestrator or a human (thread.update).
create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  title text not null default '',
  description text not null default '',
  created_by text not null default '',
  task_id uuid references tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists threads_channel_idx on threads(channel_id, updated_at desc);
create unique index if not exists threads_task_idx on threads(task_id) where task_id is not null;

alter table messages add column if not exists thread_id uuid references threads(id) on delete set null;
create index if not exists messages_thread_idx on messages(thread_id) where thread_id is not null;
