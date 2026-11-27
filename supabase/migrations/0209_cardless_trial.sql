-- THE PRO TRIAL WITH NO CARD (docs/design/onboarding-2026-11/trial.md, T2 to T4). Every hosted sign-up starts
-- on Pro. "Add a card later" starts a 7-day Stripe subscription in its trial with no payment method, and a card
-- added during it moves the trial to 14 days from its start.
--
-- nm_users.trial_claimed_at: one trial with no card for each person, claimed before Stripe is called (the
-- signup_grant_at idiom, 0186), so a delete and a new sign-up do not start a second one.
-- workspaces.card_on_file: the subscription has a default payment method. The subscription events write it
-- (billing.ts planPatchFromEvent), and Today reads it to ask for a card. A subscription before this
-- migration came from a checkout that always took a card.
alter table nm_users add column if not exists trial_claimed_at timestamptz;
alter table workspaces add column if not exists card_on_file boolean not null default false;
update workspaces set card_on_file = true where stripe_subscription_id is not null;
