-- machine tokens (architecture.md §3.3): a cloud machine's only identity. the token is
-- minted once at provision and returned once; only its sha-256 lands here. null = a local
-- (laptop) machine or an unprovisioned cloud row — both refuse the sync-token exchange.
alter table machines add column token_hash text;

create index machines_token_hash on machines (token_hash) where token_hash is not null;
