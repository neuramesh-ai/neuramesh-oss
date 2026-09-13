-- Live activity: agents surface what they're doing — thinking (chat wake in
-- flight) and working (task execution) — through the same synced status.
alter table agents drop constraint agents_status_check;
alter table agents add constraint agents_status_check
  check (status in ('online', 'offline', 'thinking', 'working'));
