-- 0110 — an agent gets TWO strings, because they have two readers.
--
-- `brief` has been doing both jobs badly: it is injected into the agent's own system prompt
-- ("Your specialty: X — bring that lens"), and it was never shown to the orchestrator at all —
-- so `list_agents` returned a roster with no capabilities in it and staffing leaned on role
-- names alone. Capping it at 2000 makes sense for instructions and no sense for something read
-- on every staffing turn.
--
-- The split is the convergent design across every agent framework: a ROUTING string separate
-- from the SYSTEM PROMPT. Claude Code subagents require `description` = "when Claude should
-- delegate to this subagent", distinct from the prompt body; the OpenAI Agents SDK separates
-- `handoff_description` from `instructions`; and A2A — the protocol we already implement —
-- says a client agent reads the card's `description` "to determine an agent's suitability".
--
--   description  →  third person, capability + when to route here, ≤280. Read by rex in
--                   list_agents, by the hover card, by the roster, by the A2A card.
--   brief        →  second person, how the work is done, ≤2000. Injected into every turn.
--                   Surfaced everywhere as "Instructions" (the column keeps its name).
--
-- Additive + nullable on a table the sync rules already `select *` from (dev/stack/powersync/
-- sync-config.yaml), so the replica picks the column up with NO sync-rule redeploy and no
-- re-snapshot. A null description is legal and lists as role alone — exactly today's behaviour —
-- so a row this backfill misses can never break staffing.
alter table agents add column if not exists description text;

-- Backfill: every existing brief is already both fields glued together — a capability clause,
-- then behaviour ("Production-readiness plans and release coordination: study the approved
-- change, surface every manual prod step…"). Take the text before the first ':' or '.', which
-- is the capability clause, and leave `brief` untouched as the instructions. Deterministic and
-- reversible: nothing is invented and nothing is lost.
--
-- The {8,} guard stops an abbreviation or a version number producing a three-word description;
-- when no delimiter matches, the whole brief (capped) is the description, which is still a
-- usable routing string. Both are editable in the app from the moment this lands, and the
-- seeded agents (rex, iris, bosun, plume) carry hand-written descriptions from seed.ts.
update agents
   set description = left(
         trim(both ' -—:.' from coalesce((regexp_match(brief, '^([^:.]{8,})[:.](\s|$)'))[1], brief)),
         280)
 where description is null
   and brief is not null
   and trim(brief) <> '';
