-- per-member cloud machines (docs/design/member-machines-2026-09/plan.md §3): one LIVE member
-- machine per (workspace × member). Tombstones (lifecycle = 'destroyed') are excluded on purpose:
-- a member who leaves and re-joins gets a fresh machine — the old one's volume and logins were
-- deleted with their membership, so there is nothing to revive. The runner keeps its own rule
-- (machines_one_runner, 0126). No new columns: the kind, the owner and the tombstone all exist.
create unique index if not exists machines_one_member
  on machines (workspace_id, owner_user_id)
  where kind = 'member' and (lifecycle is null or lifecycle <> 'destroyed');
