-- Agent retirement (soft): a retired agent leaves the active roster — the daemon
-- stops hosting it, offer/plan/design/review selection skips it, its A2A card
-- unpublishes — but the row stays so events/tasks attribution and the Agent
-- Retro's derived history (docs/13 recomputes levels from events) never orphan.
-- null = active. Re-registering the same name clears it (rehire, same identity).
alter table agents add column retired_at timestamptz;
