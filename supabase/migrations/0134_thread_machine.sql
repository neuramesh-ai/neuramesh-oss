-- WHERE A SESSION RUNS (docs/design/desktop-code-bridge-2026-09/plan.md, rule D9; George, 2026-09-04):
-- the session becomes a placement subject. Until now a thread had no machine of its own until a run
-- gave it one (continuity read the last run), and "started on the desktop" was not a fact the
-- shared-compute ladder could read. Two birth-time columns, the same contract as mode (0099),
-- brain_override (0101) and schedule_id (0119): written when the thread is born, never re-written
-- by a later message. A human may move machine_id (thread.set_machine); origin never moves.
alter table threads add column if not exists machine_id uuid references machines (id) on delete set null;
alter table threads add column if not exists origin text check (origin in ('desktop', 'web', 'routine'));
comment on column threads.machine_id is
  'the machine this session is DESIGNATED to (the composer''s machine chip, or the desktop-only default that sends sessions started on a Mac to that Mac). The ladder''s first designated rung; continuity from a prior run still outranks it. Null = no designation.';
comment on column threads.origin is
  'which client bore this session: desktop · web · routine. The ladder''s origin rung prefers a cloud machine for web- and routine-born sessions, and for desktop-born ones on Auto. Null = born before 0134: today''s ladder, unchanged.';
