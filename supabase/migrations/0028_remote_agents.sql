-- Consume external A2A agents (docs/decisions 2026-06-17): an agent registered by
-- its A2A Agent Card URL lives in the SAME agents table as a 'remote' kind — it
-- has no local machine (machine_id null) and an endpoint_url the host delegates to
-- over A2A JSON-RPC. Reusing the agents table means the roster, channel scoping,
-- offers, and the board FSM all work for remote agents unchanged. Local agents are
-- untouched (kind 'local'). The new columns ride the existing `select *` agents
-- sync rule + the whole-table publication — no rule edit needed.
alter table agents alter column machine_id drop not null;
alter table agents add column kind text not null default 'local' check (kind in ('local', 'remote'));
alter table agents add column endpoint_url text not null default '';
