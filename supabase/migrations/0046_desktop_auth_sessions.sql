-- Desktop sign-in handoff (device-code style). The packaged desktop can't complete a
-- PRODUCTION Clerk OAuth flow on its 127.0.0.1 loopback — the OAuth callback needs a
-- first-party __client cookie on clerk.neuramesh.app that a cross-site loopback can't
-- hold (dev works via the URL __clerk_db_jwt; prod doesn't). So sign-in moves to the
-- trusted neuramesh.app web page (clerk-js on the Clerk domain works there), and this
-- table is the brief server-side rendezvous: the desktop POSTs /auth/desktop/start (a
-- pending row, ~5min TTL) and opens the browser; the trusted page POSTs
-- /auth/desktop/complete with the verified nm session (result jsonb); the desktop polls
-- /auth/desktop/poll (gated by poll_secret) to claim it, then the row is deleted.
-- control-api ONLY — NOT synced to PowerSync (no publication, no sync rule). `nonce` is
-- the public correlator (it rides in the browser URL); `poll_secret_hash` gates the claim
-- so merely seeing the nonce can't steal the session.
create table desktop_auth_sessions (
  nonce            text primary key,
  poll_secret_hash text not null,
  status           text not null default 'pending' check (status in ('pending', 'done')),
  result           jsonb,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null
);
create index desktop_auth_sessions_expires_idx on desktop_auth_sessions (expires_at);
