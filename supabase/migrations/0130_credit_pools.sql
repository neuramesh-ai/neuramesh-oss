-- Credits round 2 (docs/design/credits-billing-2026-08): one pool becomes two, and the
-- machine meter learns the difference between existing and working.
--
-- PURCHASED CREDITS NEVER EXPIRE; granted ones reset monthly. One pool cannot express that:
-- the monthly refill's "granted = spent + grant" reset would eat purchases. So purchases get
-- their own pair of columns, spent AFTER the grant pool (grants expire, so burn them first).
-- Same row, same lock, same guard read — the split is bookkeeping, not a second ledger.
alter table workspace_credits
  add column purchased_micros       bigint not null default 0,
  add column purchased_spent_micros bigint not null default 0;
alter table workspace_credits
  add constraint workspace_credits_purchased_nonneg
  check (purchased_micros >= 0 and purchased_spent_micros >= 0);

-- when the machine last DID something (an agent turn, a tool call, a live pty) — reported by
-- the daemon's heartbeat, distinct from last_seen_at (liveness) and last_wake_at (messages).
-- The 48h idle stop reads greatest(last_wake_at, last_active_at): active work defends the
-- machine, which delivered messages alone never could (the task_b4c522e3 hole).
alter table machines add column last_active_at timestamptz;

-- the day's active seconds, for the dashboard's "12.3h worked" — accumulated by heartbeat,
-- beside the machine_micros those seconds were billed as.
alter table machine_usage add column active_seconds int not null default 0;
