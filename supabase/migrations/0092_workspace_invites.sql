-- Pending workspace invitations (docs/27 §1d). Replaces the broken flow where an admin typed
-- a password for someone else, the server created a SUPABASE auth user for it, and the invitee
-- — who signs in through CLERK — later resolved to a DIFFERENT nm_users id with no membership.
--
-- An invite is now a row plus an email. Identity is resolved when the person actually
-- authenticates: resolveClerkUser claims every pending invite matching their VERIFIED email.
-- The token link is the convenience path (it prefills sign-up); the verified-email match is
-- the truth path, so the invite lands whether they click the link, sign up first, or already
-- had an account. NOT in the powersync publication — pending invites are read through the API.
create table if not exists workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,                              -- always stored lower-cased (see the index)
  role text not null default 'member' check (role in ('member', 'admin')),
  token_hash text not null,                         -- sha256 of the emailed token; the raw token is never stored
  invited_by uuid not null references nm_users(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_user_id uuid references nm_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One live invite per address per workspace. A re-invite updates the existing row rather than
-- racing a second one, so "resend" can never fork into two claimable tokens.
create unique index if not exists workspace_invites_pending_idx
  on workspace_invites (workspace_id, lower(email)) where status = 'pending';
-- the claim lookup on sign-in: every pending invite for this verified address
create index if not exists workspace_invites_claim_idx on workspace_invites (lower(email)) where status = 'pending';
create index if not exists workspace_invites_ws_idx on workspace_invites (workspace_id, created_at desc);

alter table workspace_invites enable row level security;  -- no policies => service-role only
