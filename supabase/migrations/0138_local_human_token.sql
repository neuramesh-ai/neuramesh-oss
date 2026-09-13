-- The local stack's one human (docs/local-mode.md, source-release round U2). Under NM_LOCAL=1 the
-- control-api seeds one nm_users row (clerk_user_id 'local') and stores the sha256 of the human's
-- `nmh_` bearer here — the desktop mints the bearer and keeps it in the keychain, so the secret
-- never reaches the container, only its hash does (machine-auth.ts is the pattern). Nullable and
-- unique: every cloud row keeps NULL, and no two users can share a bearer. NOT synced — nm_users
-- is published only for the sync rules' parameter join, and no query selects this column.
alter table nm_users add column if not exists local_token_hash text;
create unique index if not exists nm_users_local_token_hash_key on nm_users (local_token_hash) where local_token_hash is not null;
