-- The marketing crew's role (marketing-channel plan §4.4). A WORKING seat (writes brand
-- docs, drafts content, runs research) — never a support seat; every pack seats it like
-- the designer. The default marketing agent (plume 🦚) seeds into marketing-kind rooms
-- the way bosun seeds with the ship gate: idempotent, retire-aware, never repointing.
alter type agent_role add value if not exists 'marketer';
