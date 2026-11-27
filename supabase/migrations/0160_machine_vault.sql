-- THE LOGIN VAULT (Cloud Run architecture §7, decision D1; control-api machine-vault.ts). A Cloud Run
-- machine keeps its home in RAM, so a vendor login made in its box is lost at every stop. machined
-- uploads the allowlisted login files (packages/shared login-vault.ts) here, and the next boot reads
-- them back before the box starts.
--
-- One row per machine. Only ciphertext lands here: AES-256-GCM under a random data key, and that data
-- key wrapped by the server key (key_ref names which one: 'local:v1' is NM_VAULT_KEY, a KMS key name
-- later). Both layers bind the workspace and the machine as additional authenticated data, so a row
-- copied onto another machine does not decrypt. The GCM layer binds the generation too, so an older
-- row put back under a newer generation does not decrypt either.
--
-- generation is the compare-and-swap head: a write names the generation it read. epoch is the writer's
-- fence epoch, kept for audit (the route already refused a stale one).
--
-- A tombstoned machine keeps its row id, so the cascade does not fire on a destroy: the destroy itself
-- deletes the row (member-machines.ts destroyMemberMachine). The cascade covers a hard delete.
create table machine_vault (
  machine_id   uuid primary key references machines (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  generation   bigint not null check (generation >= 1),
  epoch        bigint not null check (epoch >= 0),
  key_ref      text not null check (length(key_ref) between 1 and 400),
  wrapped_key  bytea not null check (length(wrapped_key) between 1 and 4096),
  iv           bytea not null check (length(iv) = 12),
  tag          bytea not null check (length(tag) = 16),
  ciphertext   bytea not null check (length(ciphertext) <= 1048576),
  updated_at   timestamptz not null default now()
);

comment on table machine_vault is
  'per-machine encrypted login files (AES-256-GCM, a wrapped data key, AAD bound to workspace and machine); read and written only by the machine token of that machine';

-- server-only: nm-api reaches it with its own role. No client policy exists, and it is never in the
-- sync publication, so no person lane can read even the ciphertext.
alter table machine_vault enable row level security;
