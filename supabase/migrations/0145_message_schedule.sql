-- Routine sessions (docs/design/routine-sessions-2026-09/plan.md). One session holds every run of its
-- schedule, and a run opens with the message the schedule's launcher posts: the routine's opener, a
-- draft run's message, or a release digest. That message carries the schedule here, so every client
-- can split a session into runs without a text marker (a marker would show raw on today's desktops).
-- The server fills it from the scheduleId the launcher sends already (0119 used it for the thread's
-- birth only). Null on every other message, including a re-ask, which stays inside its run.
alter table messages add column if not exists schedule_id uuid references schedules (id) on delete set null;
create index if not exists messages_schedule_runs on messages (schedule_id, created_at desc) where schedule_id is not null;
comment on column messages.schedule_id is
  'the schedule whose run this message opens (0145) — null for every message that opens no run';
