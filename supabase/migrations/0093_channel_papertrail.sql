-- Channel papertrail attribution. A new room's feed opens with its own history — "geo created
-- this channel", "geo added rex, atlas and 3 others" — so the room explains itself instead of
-- rendering one grey "no messages yet" line.
--
-- The events table already records both facts with full attribution (channel.created,
-- agent.channels_synced), but insertEvent never populates events.channel_id — every row lands
-- with a null channel — so a channel-scoped slice can't be selected, let alone synced. Rather
-- than backfill a column nothing reads yet, the two facts the trail needs are stamped on the
-- rows that already carry them and already sync.
--
-- Nullable by design: rooms and memberships created before this migration keep a null actor and
-- render actor-less ("this channel was created"). No backfill, no re-snapshot — both tables ride
-- `select *` sync rules, so this is a client-core / desktop schema mirror only.
alter table channels
  add column created_by_kind text check (created_by_kind in ('human', 'agent')),
  add column created_by text;

alter table agent_channels
  add column created_by_kind text check (created_by_kind in ('human', 'agent')),
  add column created_by text;

comment on column channels.created_by is
  'actor id that ran channel.create — nm_users.id when created_by_kind = human, agents.id when agent. Null for rooms predating 0093.';
comment on column agent_channels.created_by is
  'actor id that ran channel.add_agent. Null for memberships predating 0093, and for the orchestrator auto-seeded into every new room.';
