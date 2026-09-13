-- A THREAD HAS A STATUS, AND SETTLED IS THE ONE A HUMAN SETS (George, 2026-09-08: "threads should have
-- status so a user can settle a thread (if in needs you) resulting in the thread state moving to
-- settled; Threads can be settled, needs you, in progress; Status becomes a filter for threads").
--
-- Two of the three statuses derive from what already syncs (shared/threadstatus.ts): a human gate
-- or an open card = needs you, a live run or the agent's turn = in progress. Only "I have seen this"
-- needs a column. The stamp is a MOMENT, not a flag: a gate or a card born AFTER it brings the
-- thread back to Needs you, so a settled thread can never hide new work. Nothing else reads it.
-- Settle is not an accept, an approve or a dismiss (thread.settle, HUMAN_ONLY, handler/thread.ts).
alter table threads add column if not exists settled_at timestamptz;
comment on column threads.settled_at is
  'when a human settled this thread (thread.settle). Read against the newest gate or card: anything newer than this stamp needs the human again. Null = never settled.';
