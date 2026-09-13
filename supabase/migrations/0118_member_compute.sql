-- Compute choice (docs: compute-choice round, 2026-08-12): where a member's requests run.
--
-- Shared compute (0114) made agents workspace-level and machines member-owned, with origin
-- affinity as the routing rule. This adds the member's CHOICE on top: a default machine for
-- their new conversations, and per-agent overrides — both advisory routing the daemons read
-- in shouldClaim (packages/shared/src/compute.ts); the wake lease stays the enforcement.
--
-- Shape: {"machine": "<machine uuid>" | null, "agents": {"<agent uuid>": "<machine uuid>"}}.
-- Empty object = unset = origin affinity exactly as before. Continuity outranks all of it:
-- an existing thread keeps the machine that holds its files, so prefs move NEW work only.
alter table workspace_members add column if not exists compute jsonb not null default '{}'::jsonb;

comment on column workspace_members.compute is
  'The member''s compute choice (0118): {machine, agents:{agentId→machineId}}. Advisory routing '
  'read by every daemon in shouldClaim — per-member (my requests only), capability-gated at '
  'claim time, so a stale value can only slow a request, never strand it. Set via '
  'member.set_compute (HUMAN_ONLY, self-only).';
