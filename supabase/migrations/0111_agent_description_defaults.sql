-- 0111 — give every agent a description it can actually be routed by.
--
-- 0110 added `description` and backfilled it from `brief`. That reached fewer agents than it
-- looked like it would, for two reasons a live workspace made obvious (founder report: rex and
-- iris both open with the field blank):
--
--   · `brief` was introduced (0056) for HIRED specialists — the thing that makes a hire better
--     than a role name. Seeded agents never had one, so there was nothing to derive from and
--     0110 correctly skipped them. rex, iris, atlas, patch, scout: all null.
--   · The seed text written in the daemon only applies at agent.register for a MISSING agent.
--     The onboarding wizard creates the starter crew directly, so the designer/shipper seeds
--     skip with "the workspace already has one" — meaning that text never applied to an
--     existing workspace, and never to a new one either.
--
-- So: fall back to the ROLE's default description for anyone still undescribed. A role default
-- cannot tell two developers apart — which is the whole job of a description — but it is a floor
-- that makes the hover card, the roster and the A2A card honest, and it is the human's to rewrite
-- (both strings are HUMAN_ONLY to edit).
--
-- NEVER OVERWRITE A HUMAN. Two guards:
--   1. `description is null` — untouched by definition.
--   2. the value byte-matches exactly what 0110's expression would have derived from this row's
--      brief. That is provably machine-written, so upgrading it cannot destroy anyone's words
--      (it is what turns plume's terse "Brand and growth" into the full routing line).
-- Anything else — a description a human or the orchestrator wrote — is left alone.
--
-- The text is duplicated from packages/shared/src/agentdesc.ts ON PURPOSE: a migration is a
-- point-in-time statement about rows that exist now, and must not start tracking a TS constant
-- that will keep changing. Later edits to that map affect newly created agents only.
--
-- Additive data-only, no schema change: no sync-rule redeploy, no re-snapshot.

with defaults(role, text) as (values
  ('orchestrator', 'Runs this room: turns requests into scoped tasks, routes them to the right teammate, and keeps the board moving. Route anything that needs triage, staffing, or a status answer here.'),
  ('architect',    'Turns approved requirements and designs into implementation-ready plans. Route work whose approach is genuinely non-obvious and needs settling before anyone builds.'),
  ('developer',    'Implements board tasks in a worktree and submits a PR with evidence. Route bug fixes, features and refactors — anything where the change lands in code.'),
  ('worker',       'Research, analysis and report-style deliverables. Route investigations, comparisons and write-ups that need sourcing rather than shipping.'),
  ('reviewer',     'Gates submitted work against its Definition of Done and the PR checks. Route review rounds; it approves or sends work back with specifics.'),
  ('designer',     'Designs user-facing work before it is built — mockups studied from the repo’s real design tokens, and the images marketing posts carry. Route any visual or UI-shaped task here.'),
  ('marketer',     'Brand and growth — brand docs, positioning, and platform-native content in the product’s voice. Route posts, campaigns, launch copy and messaging here; never code.'),
  ('shipper',      'Production readiness and release coordination. Route reviewer-approved work that has to reach prod — deploy steps, release plans, merge gates.'),
  ('curator',      'Keeps the team’s skill library: promotes what works, retires what does not. Route skill and convention curation here.'),
  ('sales',        'Outbound, prospect research and customer-facing follow-up. Route pipeline and account work here.')
)
update agents a
   set description = d.text
  from defaults d
 where d.role = a.role::text
   and (
     a.description is null
     -- exactly 0110's derivation → machine-written, safe to upgrade
     or a.description = left(
          trim(both ' -—:.' from coalesce((regexp_match(a.brief, '^([^:.]{8,})[:.](\s|$)'))[1], a.brief)),
          280)
   );
