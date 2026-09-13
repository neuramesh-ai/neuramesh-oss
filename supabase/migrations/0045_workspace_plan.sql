-- Cloud-plan billing state on the workspace. The WORKSPACE is the billing entity — Cloud is a
-- per-seat subscription the owner buys for the team (teammates, cross-device sync, marketplace,
-- unlimited projects). `plan` is the single server-truth that replaces the old cosmetic
-- localStorage['nm:plan'] flag; every entitlement gate (project cap, invites, extra machines,
-- marketplace install, A2A sharing) reads it in the control-api command handlers — enforced, not
-- prompted. The Stripe columns are written ONLY by the Stripe webhook (POST /webhooks/stripe) and
-- are never client-settable. `primary_machine_id` enforces the Free single-machine rule: on Free
-- only that machine gets a PowerSync token; signing in elsewhere offers transfer (re-point this) or
-- upgrade. Cloud ignores it (every machine syncs). Whole-table publication, so no sync-rule edit.
alter table workspaces add column plan text not null default 'free' check (plan in ('free', 'cloud'));
alter table workspaces add column stripe_customer_id text;
alter table workspaces add column stripe_subscription_id text;
alter table workspaces add column subscription_status text;
alter table workspaces add column seats integer not null default 1 check (seats >= 1);
alter table workspaces add column current_period_end timestamptz;
alter table workspaces add column primary_machine_id uuid references machines (id) on delete set null;
