-- An invitation becomes something you ANSWER (docs/27 §1d, rev 2). Until now signing in with a
-- verified address silently created the membership, which meant: an already-signed-in user never
-- got one at all (the claim only ran on a sign-in event), and a single stray invite could bind an
-- account to a workspace it could never leave.
--
-- Membership now comes only from `workspace.accept_invite`, so the row needs a third resting
-- state: 'declined'. It deliberately leaves the `status = 'pending'` predicate that both the
-- unique index and the claim index are built on, so declining FREES the address — re-inviting
-- someone who said no once is a normal act, not a constraint violation.

-- Drop by LOOKUP, not by guessed name: 0092 declared the check inline, so its name is whatever
-- Postgres chose. A `drop constraint if exists <wrong_name>` would no-op silently and leave the
-- old three-value check in force — the new one would be added beside it and every decline would
-- fail at runtime with the migration reporting success.
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public' and rel.relname = 'workspace_invites'
       and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%status%'
  loop
    execute format('alter table public.workspace_invites drop constraint %I', c);
  end loop;
end $$;

alter table workspace_invites add constraint workspace_invites_status_check
  check (status in ('pending', 'accepted', 'revoked', 'declined'));

-- When it was answered, whichever way. accepted_at only ever covered half the outcomes.
alter table workspace_invites add column if not exists declined_at timestamptz;
