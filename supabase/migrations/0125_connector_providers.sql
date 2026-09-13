-- 0125 — connectors may be LinkedIn, Instagram and TikTok, not only X.
--
-- 0086 created the table with `check (provider in ('x'))` when X was the only connector. The
-- app grew past it: providerConfigured() has handled linkedin/instagram/tiktok since the
-- connectors round, the Connections panel offers all four, and publishing routes through them —
-- but the CHECK was never widened, so upsertConnector's insert on a completed LinkedIn OAuth
-- would fail the constraint and the account could never be stored. Found 2026-08-26 while
-- building the dependency preflight, whose whole ruling is "one connector is enough and a run
-- covers every one that is live" — unreachable while the schema can hold exactly one kind.
--
-- Idempotent and safe: the constraint is dropped only if present, and the new set is a strict
-- superset, so every existing row still satisfies it.
alter table connectors drop constraint if exists connectors_provider_check;
alter table connectors add constraint connectors_provider_check
  check (provider in ('x', 'linkedin', 'instagram', 'tiktok'));
