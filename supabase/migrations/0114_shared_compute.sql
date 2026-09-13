-- Shared compute (docs/39): a workspace's agents are workspace-level resources that RUN on
-- members' own machines, under each member's own subscription or key.
--
-- `agents.machine_id` used to pin every agent to exactly one laptop, so a teammate could see rex
-- in the roster while every request they made was served by the owner's machine — and went
-- unanswered when that machine slept. That pin was always a CLIENT assumption: the server has
-- tolerated competing daemons since 0060, whose own comment reads "a human message that wakes an
-- agent can be observed by MORE THAN ONE live daemon".
--
-- Three things are missing to make it real, and they are all here.

-- ── 1. the wake lease ───────────────────────────────────────────────────────────────────────
-- Task work was already safe: `task.claim` is `for update` + state-guarded, and the host claims
-- BEFORE it spends a token. Chat wakes were not: 0060 dedupes at the REPLY INSERT, which happens
-- after generation — so three member machines would each spin a model on one message and throw
-- two answers away. Moving the race earlier makes the claim cost nothing.
--
-- A run IS the lease: opening one is the claim. Reusing `runs` rather than inventing a lease
-- table means the rail's live-work surface renders "who is answering" for free.
alter table runs add column if not exists trigger_message_id uuid references messages (id) on delete cascade;
alter table runs add column if not exists machine_id uuid references machines (id) on delete set null;

-- ONE run per (agent, triggering message). The losing host's insert fails and it stands down
-- without generating anything. Partial so the column stays null for task/sweep runs, which are
-- already deduped by their own claim.
create unique index if not exists runs_one_per_trigger
  on runs (agent_id, trigger_message_id) where trigger_message_id is not null;

-- ── 2. published capability ─────────────────────────────────────────────────────────────────
-- A host can probe ITSELF for a Claude login (resolveToken already does). It cannot probe anyone
-- else — so "is the origin's machine able to serve this runtime?" is undecidable unless each
-- machine publishes what it can run. Without this, failover would either wait out the grace
-- window for a machine that can never serve, or skip the wait entirely and race every time.
alter table machines add column if not exists runtimes jsonb not null default '[]'::jsonb;

-- ── 3. agents stop being pinned ─────────────────────────────────────────────────────────────
-- machine_id becomes provenance ("the machine that registered this agent"), not routing. Kept
-- rather than dropped: the Agents page still shows where an agent was created, and dropping a
-- not-null FK that 30-odd call sites read is a bigger change than this slice needs.
alter table agents alter column machine_id drop not null;

comment on column agents.machine_id is
  'The machine that REGISTERED this agent. NOT where it runs — since 0114 any member machine that '
  'publishes the required runtime may claim its work (see shared/src/compute.ts).';
comment on column machines.runtimes is
  'Runtimes this host can serve (login present or key available), republished by machine.register '
  'at every app LAUNCH — machine.heartbeat only touches last_seen_at. Cross-machine capability: '
  'the origin-affinity policy needs it to tell "busy" from "cannot serve". A host reads its OWN '
  'capability from a live local probe, never from this column, so a stale value can only make '
  'peers fail over sooner — never make a machine refuse work it can actually do.';
comment on column runs.trigger_message_id is
  'The message this run answers. The unique index on (agent_id, trigger_message_id) is the '
  'PRE-GENERATION wake lease — one host generates, the rest stand down.';
