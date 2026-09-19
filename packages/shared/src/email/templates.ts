// Every NeuraMesh email, as a pure function props -> RenderedEmail. Lives in shared so the
// control-api renders them to send and the preview harness renders them to look at: one
// definition, never a drifting copy.
//
// Copy standard: docs/28-email-voice.md. Every factual claim carries its file:line in the
// `claims` list beside the template, and the golden-file test snapshots both, so a claim
// changing without its citation changing shows up as a review diff.
//
// NO EM DASHES. They read as filler at small sizes and hide weak sentence joins. Use a full
// stop, a colon, or a comma. Enforced by a test.
import {
  APP_URL, b, button, card, esc, h1, h2, layout, linkline, monoList, p, quote, rule, small, stats, toText,
} from './layout';
import { inviteMeta, joinedMeta } from './templates-account';
import { day1Meta, day3Meta, welcomeMeta } from './templates-lifecycle';
import { hostedFreeNoticeMeta } from './templates-notice';
import { announceReadyMeta } from './templates-announce';

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

/** Transactional mail ignores opt-out and carries no unsubscribe link. */
export type EmailKind = 'transactional' | 'lifecycle' | 'broadcast';

export interface TemplateMeta {
  kind: EmailKind;
  /** docs/28 story shape, declared so the reviewer can agree it's the right one. */
  shape: string;
  /** [claim, file:line]. Law 2. "proposed:…" means the behaviour does not exist yet. */
  claims: Array<[string, string]>;
}

export const done = (subject: string, preheader: string, html: string): RenderedEmail =>
  ({ subject, preheader, html, text: toText(html) });

// ── transactional ──────────────────────────────────────────────────────────

export const publishFailedMeta: TemplateMeta = {
  kind: 'transactional',
  shape: 'The beat. One thing happened, and it needs a hand',
  claims: [
    ['A failed publish writes status=failed + last_error', 'connectors.ts:439 markContentFailed'],
    ['Publishing runs as a cron over due + approved items', 'connectors.ts:425; vercel.json crons'],
    ['The draft survives the failure, only status changes', 'connectors.ts:439'],
    ['This email is the failure’s only surface', 'schema.ts:54 synced; zero renderers in App.tsx'],
  ],
};
export function renderPublishFailed(v: {
  platform: string; slot: string; error: string; queuedBehind: number; reconnectUrl: string;
}): RenderedEmail {
  const subject = `Your ${v.slot} post didn't go out`;
  const preheader = `${v.platform} rejected it${v.queuedBehind > 0 ? `. ${v.queuedBehind} more queued behind it.` : '.'}`;
  return done(subject, preheader, layout({
    preheader,
    footerWhy: 'You approved this post for publishing. Delivery failures always reach you.',
    body: [
      h1(`${esc(v.platform)} rejected the post`),
      p(`The post you approved for ${b(esc(v.slot))} didn't publish. This is what came back:`, { tight: true }),

      quote(esc(v.error)),

      h2('What happens now'),
      p(`Your draft is untouched and still sitting in the calendar.` + (v.queuedBehind > 0
        ? ` ${b(`${v.queuedBehind} more post${v.queuedBehind === 1 ? '' : 's'}`)} ${v.queuedBehind === 1 ? 'is' : 'are'} queued behind this one, and ${v.queuedBehind === 1 ? 'it' : 'they'}'ll hit the same wall until the account is reconnected.`
        : '')),

      button('Reconnect the account', v.reconnectUrl),

      rule(),
      small('Reconnecting takes one round-trip through the provider, and the queue picks up from there.'),
    ].join(''),
  }));
}

// ── lifecycle ──────────────────────────────────────────────────────────────

export const marketingMeta: TemplateMeta = {
  kind: 'lifecycle',
  shape: "The other room. The half of the product they haven't opened",
  claims: [
    ['A channel has a kind: build or marketing', '0079_channel_kind.sql'],
    ['A marketing room is Feed, Calendar, Library', '0079_channel_kind.sql (header)'],
    ['plume seeds into marketing rooms, idempotent + retire-aware', 'seed.ts:130-152'],
    ['plume never publishes; humans approve everything outbound', 'seed.ts:148; handler.ts:1062'],
    ['Agents draft new items but cannot edit your calendar', 'handler.ts:1049'],
    ['Setting up the HQ is free on every plan', '0080_channel_marketing.sql (header)'],
  ],
};
export function renderMarketing(v: {
  shippedThing: string | null; worker: string; reviewer: string; openUrl: string; unsubscribeUrl: string;
}): RenderedEmail {
  const subject = `${v.worker} shipped it. Who's telling anyone?`;
  const preheader = 'Turn a room into a marketing HQ and plume moves in.';
  const opener = v.shippedThing
    ? `This week ${esc(v.worker)} shipped ${b(esc(v.shippedThing))} and ${esc(v.reviewer)} signed it off. It's live. Nobody outside your workspace knows that.`
    : `Work has been landing on your board and getting signed off. It's live. Nobody outside your workspace knows that.`;
  return done(subject, preheader, layout({
    preheader,
    unsubscribeUrl: v.unsubscribeUrl,
    footerWhy: "You're in your first weeks on NeuraMesh. These onboarding emails stop after the sequence ends.",
    body: [
      h1("The half of the board you haven't opened"),
      p(opener),

      h2('Change a room’s kind to marketing'),
      p(`It changes shape: a feed, a calendar and a library instead of a task board. ${b('plume')} moves in.`),
      p("plume researches your product and your market properly, writes the brand docs, and drafts posts in your voice, one platform at a time."),

      h2('What plume will not do'),
      p("Publish. Every outbound post waits on a human, and the calendar stays yours. Agents add drafts, they don't move your slots."),

      h2('What it brings'),
      monoList([
        ['brand-research', 'who you are, in your words'],
        ['competitor-scan', 'who else is in the room'],
        ['post-quality', 'the bar a draft has to clear'],
        ['content-calendar', 'what goes out, and when'],
      ]),

      p("Setting the room up costs nothing on any plan. Point it at your site, say what you're going for, and let plume read."),

      button('Open a marketing room', v.openUrl),
    ].join(''),
  }));
}

export const day7Meta: TemplateMeta = {
  kind: 'lifecycle',
  shape: 'The threshold. The moment the current shape stops fitting',
  claims: [
    ['Free: 3 members, 3 projects, 1 machine', 'entitlements.ts; docs/07:11-15'],
    ['Schedules are Cloud-only', 'handler.ts:947-951'],
    ['$22 per seat / month', 'docs/07-billing-and-plans.md:3'],
    ['Cancellation runs through Stripe’s hosted portal, to period end', 'billing.ts:89-107; app.ts:556'],
  ],
};
export function renderDay7(v: {
  seatsUsed: number; seatCap: number; billingUrl: string; downloadUrl: string; unsubscribeUrl: string;
}): RenderedEmail {
  const subject = v.seatsUsed > 1
    ? `You're using ${v.seatsUsed} of your ${v.seatCap} seats`
    : 'The third chair';
  const preheader = `Free covers ${v.seatCap} people. Nothing expires when you reach the third.`;
  return done(subject, preheader, layout({
    preheader,
    unsubscribeUrl: v.unsubscribeUrl,
    footerWhy: "You've been on NeuraMesh for a week on the Individual plan. This is the last email in your onboarding sequence.",
    body: [
      h1('The third chair'),
      p(`Free NeuraMesh covers ${v.seatCap} people, 3 projects and one machine. That runs the whole loop: plan, build, review, ship, with two colleagues watching the same board.`),
      p("It stops being enough at a specific moment, and you'll know the one when it arrives. A fourth person needs in. A second repo needs its own project. Or you want the crew working to a schedule instead of waiting for you to ask."),

      h2('What Team adds'),
      card(
        `<div class="nm-ink" style="font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14.5px;line-height:2.15;color:#38332d;font-weight:600;">` +
        ['A fourth teammate, and past that', 'Unlimited projects', 'Every machine you own', 'Scheduled work: the crew on a cadence']
          .map((t) => `<span class="nm-green" style="color:#2f9e6b;font-weight:700;">&#10003;</span>&nbsp; ${t}`).join('<br>') +
        `</div>`,
      ),

      p(`${b('$22 per seat, per month.')} Cancel from the billing portal whenever you like. Team stays on until the end of the period you've paid for.`),

      button('Upgrade to Team', v.billingUrl),
      linkline("Or don't. Free isn't a trial, and it doesn't expire.", v.downloadUrl),
    ].join(''),
  }));
}

export const digestMeta: TemplateMeta = {
  kind: 'lifecycle',
  shape: 'The ledger. What happened, and what is owed',
  claims: [
    ['Content moves draft, scheduled, published or failed', '0084_content_items.sql'],
    ['Nothing publishes without a human approving it', 'handler.ts:1062 content.approve HUMAN_ONLY'],
    ['Approval has no push notification today', 'push.ts GATE_STATES, task states only'],
  ],
};
export function renderDigest(v: {
  channel: string; published: number; waiting: number; failed: number; drafted: number;
  window: string; openUrl: string; unsubscribeUrl: string;
}): RenderedEmail {
  const subject = v.waiting > 0
    ? `${v.published} went out. ${v.waiting} ${v.waiting === 1 ? 'is' : 'are'} waiting on you.`
    : `${v.published} went out last week.`;
  const preheader = `Last week in #${v.channel}.`;
  return done(subject, preheader, layout({
    preheader,
    unsubscribeUrl: v.unsubscribeUrl,
    footerWhy: "You're registered to a marketing channel in this workspace. This digest only sends in weeks with activity.",
    body: [
      h1(`Last week in #${esc(v.channel)}`),

      stats([
        { n: v.published, label: 'published', green: true },
        { n: v.waiting, label: 'waiting on you' },
        { n: v.failed, label: 'failed' },
      ], v.window),

      p(`plume drafted ${v.drafted} post${v.drafted === 1 ? '' : 's'} last week. You approved ${v.published} and ${v.published === 1 ? 'it went' : 'they went'} out on schedule.`),

      ...(v.waiting > 0 ? [
        h2('Waiting on you'),
        p(`${v.waiting === 1 ? 'One is' : `${v.waiting} are`} still in the calendar. Nothing publishes until you approve it, so ${v.waiting === 1 ? 'it' : 'they'} will wait as long as it takes. But ${v.waiting === 1 ? 'it was' : 'they were'} written against last week's news, and ${v.waiting === 1 ? 'it ages' : 'they age'}.`),
      ] : []),

      button(v.waiting > 0 ? `Review ${v.waiting} draft${v.waiting === 1 ? '' : 's'}` : 'Open the calendar', v.openUrl),
    ].join(''),
  }));
}

// ── broadcast ──────────────────────────────────────────────────────────────

export const broadcastMeta: TemplateMeta = {
  kind: 'broadcast',
  shape: 'Author-supplied. The marketer declares the shape in the draft',
  claims: [['Body is human-approved before any send', 'handler.ts:1062 content.approve HUMAN_ONLY']],
};
/** A marketer-drafted announcement. The wrapper, footer and unsubscribe are never
 *  author-controlled; only the eyebrow, heading, paragraphs and one CTA are. */
export function renderBroadcast(v: {
  subject: string; preheader: string; eyebrow?: string | null; heading: string;
  paragraphs: string[]; ctaLabel?: string | null; ctaUrl?: string | null; unsubscribeUrl: string;
}): RenderedEmail {
  return done(v.subject, v.preheader, layout({
    preheader: v.preheader,
    unsubscribeUrl: v.unsubscribeUrl,
    footerWhy: 'You have a NeuraMesh account. Product announcements go out roughly monthly.',
    body: [
      v.eyebrow ? `<div class="nm-muted" style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;color:#8a847a;margin-bottom:14px;">${esc(v.eyebrow)}</div>` : '',
      h1(esc(v.heading)),
      ...v.paragraphs.map((t) => p(esc(t))),
      v.ctaLabel && v.ctaUrl ? button(esc(v.ctaLabel), v.ctaUrl) : '',
    ].join(''),
  }));
}

/** Registry for the preview harness + the golden-file test. */
export const TEMPLATE_META: Record<string, TemplateMeta> = {
  invite: inviteMeta, joined: joinedMeta, publishFailed: publishFailedMeta,
  welcome: welcomeMeta, day1: day1Meta, day3: day3Meta, marketing: marketingMeta,
  day7: day7Meta, digest: digestMeta, broadcast: broadcastMeta, hostedFreeNotice: hostedFreeNoticeMeta,
  announceReady: announceReadyMeta,
};

export { APP_URL };
