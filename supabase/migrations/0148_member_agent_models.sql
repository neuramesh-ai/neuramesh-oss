-- A person's model for each agent (docs/design/models-and-replies-2026-10/plan.md §4, 2026-10-02).
--
-- George: "a model choice changes that agent for the user; technically model selection is a user
-- configuration, not workspace". So the pick lives on the member's own row, beside the compute
-- choice (0118), and every daemon reads the REQUESTER's pick from its replica when it seats the
-- agent (packages/shared/src/model-packs.ts seatModel: the conversation's word, then this, then
-- the workspace-wide defaults). Automations use the NeuraMesh brain, whoever made them.
--
-- Shape: {"<agent uuid>": {"model": "<model id>", "thinking": "low" | "medium" | "high"}}.
-- Empty object = no pick = every agent runs its own model, exactly as before. workspace_members
-- already syncs with `select *` (sync-config.yaml), so the column reaches every client with no
-- sync-rule change, and a row a client has not seen change reads as no pick.
alter table workspace_members add column if not exists agent_models jsonb not null default '{}'::jsonb;

comment on column workspace_members.agent_models is
  'The member''s model for each agent (0148): {agentId: {model, thinking?}}. Read by every daemon '
  'when it seats an agent for a request from this member. Set via member.set_agent_model '
  '(HUMAN_ONLY, self-only).';
