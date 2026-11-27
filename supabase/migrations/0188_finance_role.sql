-- The Finance crew's role (George, 2026-11-17). A seeded seat like bosun and plume: the
-- workspace's Finance agent (ledger) answers Finance chats when a person picks it. It joins
-- no room, so no daemon wakes it for a room message.
alter type agent_role add value if not exists 'finance';
