-- Chat mode (docs/34): the Tasks toggle on the composer.
--
-- One chip decides what a message BECOMES. 'tasks' (the default, today's behaviour byte for
-- byte) — the orchestrator triages it into board work. 'chat' — the agent answers in the thread
-- with real tools and nothing reaches the board.
--
-- The mode lives on the THREAD, not on the message or the channel, because a conversation must
-- stay what it was: every wake in the thread reads it, not just the first. It is frozen at the
-- thread's birth (the message that births the row carries it) and changed afterwards only by a
-- human, via thread.set_mode — the escalation valve that turns a chat into board work in place.
--
-- threads syncs as `select *`, so this column rides the existing sync rule with NO PowerSync
-- work (the 0098 precedent).
alter table threads add column if not exists mode text not null default 'tasks';

-- Enforced, not prompted (doctrine §4): an unknown mode is not storable. Added separately so a
-- re-run on a database that already has the column still gets the constraint.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'threads_mode_check') then
    alter table threads add constraint threads_mode_check check (mode in ('tasks', 'chat'));
  end if;
end $$;

-- Every thread that already exists was born before the toggle, so it is a tasks thread by
-- definition — which the column default already gives it. No backfill needed; this comment
-- exists so the absence of one reads as a decision rather than an omission.
