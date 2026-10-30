-- One resumable checkout per workspace, including across API replicas and page reloads.
alter table public.workspaces add column if not exists trial_checkout_session_id text;
