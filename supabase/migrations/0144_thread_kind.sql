-- Coding threads (docs/design/coding-threads-2026-09/plan.md, S0). A coding conversation is a
-- threads row with kind = 'coding': it lives in a room, in a project, on a machine, with an
-- origin, and shows in every list every other conversation shows in. The coding runtime
-- (Engineering) runs it exactly as a Code session ran before; what moved is where the thread
-- lives and what draws it. Born at the send that births the thread (the repo chip, door 1) or
-- moved by thread.set_kind (a human, or the room's orchestrator from its triage turn, door 2).
alter table threads add column if not exists kind text not null default 'chat';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'threads_kind_check') then
    alter table threads add constraint threads_kind_check check (kind in ('chat', 'coding'));
  end if;
end $$;
comment on column threads.kind is
  'chat (a conversation, the default) or coding (the coding runtime works on a repository in it) — set at birth or by thread.set_kind';

-- The session row a coding thread wears. A coding thread's code_sessions row keys on the thread
-- id (the engineering thread id IS the threads id, so the machine's history discovery — actor +
-- repo + thread — needs no migration); thread_id names the link so a list can join on it and a
-- legacy session (an id that is no thread) stays unlinked. The handler links it on upsert.
alter table code_sessions add column if not exists thread_id uuid references threads (id) on delete set null;
create unique index if not exists code_sessions_thread on code_sessions (thread_id) where thread_id is not null;
comment on column code_sessions.thread_id is
  'the coding thread this session belongs to (0144) — null for a Code session opened before coding threads existed';
