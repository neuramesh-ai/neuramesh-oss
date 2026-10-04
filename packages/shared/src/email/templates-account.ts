// Transactional email bodies — invite, joined, publish-failed. Each renders to one
// RenderedEmail; the meta beside it is what the preview harness lists.
// Split out of email/templates.ts.
import {
  b, button, card, esc, h1, h2, kv, layout, linkline, p, rule, small,
} from './layout';
import { done, type RenderedEmail, type TemplateMeta } from './templates';

export const inviteMeta: TemplateMeta = {
  kind: 'transactional',
  shape: 'The invitation. Open in medias res; work is underway and a door opens',
  claims: [
    ['Six agents are seeded by default', 'App.tsx:9272-9278 + :9384'],
    ['Work stops and waits for a human sign-off', 'states.ts:144, :296'],
    ['14-day single-use token', '0092_workspace_invites.sql expires_at'],
    ['Signing in with the invited address claims it', 'app.ts /auth/clerk to claimInvitesForEmail'],
  ],
};

export function renderInvite(v: {
  inviter: string; inviterEmail: string; workspace: string; role: string; acceptUrl: string;
}): RenderedEmail {
  const subject = `${v.inviter} added you to ${v.workspace}`;
  const preheader = 'Six agents are already working in there. The board needs a person.';
  return done(subject, preheader, layout({
    preheader,
    footerWhy: `${esc(v.inviter)} (${esc(v.inviterEmail)}) invited this address to a NeuraMesh workspace. If that wasn't expected, ignore this. The invitation expires on its own.`,
    body: [
      h1(`You're in ${esc(v.workspace)}`),
      p(`${esc(v.inviter)} put your name on a workspace where six agents are already working: planning, writing code, reviewing each other's pull requests.`),

      card(kv('Workspace', esc(v.workspace)) + kv('Invited by', `${esc(v.inviter)} · ${esc(v.inviterEmail)}`) + kv('Your role', esc(v.role))),

      h2('The part they can’t do'),
      p(`When work passes review it stops, and waits for a person to sign it off. ${b('That')} is what you're being invited to.`),

      button('Accept invitation', v.acceptUrl),
      linkline('The link works for 14 days.', v.acceptUrl),

      rule(),
      small('Already have a NeuraMesh account on this address? Sign in instead. The invitation finds you either way.'),
    ].join(''),
  }));
}

export const joinedMeta: TemplateMeta = {
  kind: 'transactional',
  shape: 'The beat. One thing happened, here it is, stop',
  claims: [
    ['Members see the whole workspace, not just their channels', 'sync-config.yaml:11-40; 0001_core.sql:316'],
    ['Channel membership organises work, it does not restrict humans', 'sync-config.yaml:11'],
    ['Trial seat count (n of 1); the line drops on Pro', 'entitlements.ts FREE_SEAT_CAP, TRIAL_LABEL; onauth.ts seatLine'],
  ],
};

export function renderJoined(v: {
  joinedEmail: string; workspace: string; role: string; seatLine: string | null; openUrl: string;
}): RenderedEmail {
  const subject = `${v.joinedEmail} joined ${v.workspace}`;
  const preheader = 'They can see the whole workspace. Worth knowing before you paste anything sensitive.';
  return done(subject, preheader, layout({
    preheader,
    footerWhy: 'You invited this person to your NeuraMesh workspace.',
    body: [
      h1(`${esc(v.joinedEmail.split('@')[0] ?? 'They')} is in`),
      p(`${b(esc(v.joinedEmail))} accepted and joined ${esc(v.workspace)}.`),

      card(kv('Joined', esc(v.joinedEmail)) + kv('Role', esc(v.role)) + (v.seatLine ? kv('Seats', esc(v.seatLine)) : '')),

      h2('What they can see'),
      p(`A workspace member sees ${b('the whole workspace')}: every channel, every task, every artifact. Channel membership decides who works where. It doesn't hide a room from a teammate.`),
      p(`So if something belongs in a private repo rather than a channel, keep it there.`),

      button('Open your workspace', v.openUrl),
    ].join(''),
  }));
}

export const trialEndingMeta: TemplateMeta = {
  kind: 'transactional',
  shape: 'The notice. A date and a price, and the one door to change them',
  claims: [
    ['Stripe sends the event 3 days before a trial ends', 'trial.ts trialReminder; Stripe customer.subscription.trial_will_end'],
    ['The trial turns into Pro at the seat price', 'billing.ts createTrialSession; entitlements.ts PRO_SEAT_USD'],
    ['A cancel before the date costs nothing', 'billing.ts trial_period_days; Stripe charges at the trial end'],
    ['Pro credits refill on the 1st of each month', 'fleet-lifecycle.ts /internal/credit-refill'],
    ['The Credits view opens the Stripe portal', 'CreditsView.tsx Manage plan'],
  ],
};

export function renderTrialEnding(v: {
  workspace: string; endsOn: string; seats: number; seatUsd: number; manageUrl: string;
}): RenderedEmail {
  const first = v.seats * v.seatUsd;
  const subject = `Your Pro trial ends on ${v.endsOn}`;
  const preheader = `Then Pro is $${v.seatUsd} a seat each month. Cancel before ${v.endsOn} and you pay nothing.`;
  return done(subject, preheader, layout({
    preheader,
    footerWhy: 'You started a Pro trial with a payment method. We send this once, before the first charge.',
    body: [
      h1('Your Pro trial ends in 3 days'),
      p(`The Pro trial for ${b(esc(v.workspace))} ends on ${b(esc(v.endsOn))}. Then Stripe charges the payment method you added.`),

      card(kv('Trial ends', esc(v.endsOn)) + kv('First charge', `$${first} for ${v.seats} seat${v.seats === 1 ? '' : 's'}`) + kv('After that', `$${v.seatUsd} a seat each month`)),

      h2('To keep Pro'),
      p('Do nothing. Pro continues, and your credits refill on the 1st of each month.'),

      h2('To stop'),
      p(`Cancel before ${esc(v.endsOn)} and you pay nothing. Open Credits in your workspace, then manage your plan on Stripe.`),

      button('Manage your plan', v.manageUrl),
    ].join(''),
  }));
}
