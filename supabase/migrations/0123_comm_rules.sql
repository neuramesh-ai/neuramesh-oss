-- Agent communication rules (docs/design/agent-comm-rules-2026-08): the workspace's voice.
-- NULL = never configured = the shipped defaults (STE-100 on, no-em-dash on, no custom
-- rules) — commRulesFrom() owns that reading, so the column only stores deliberate change.
alter table workspaces add column if not exists comm_rules jsonb;
