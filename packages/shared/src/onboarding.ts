// What is left to set up — the pure half of Home's setup tracker (cloud-first round, item 14).
//
// Derived, never stored, for the needsyou.ts reason: a stored checklist is a second copy of
// the truth, and the two drift. Someone connects a subscription from their laptop, someone
// else opens the workspace in a browser, and a stored "connected: false" would keep asking a
// question the workspace already answered. Every input below is a row (or a read) both clients
// already have, so both clients agree without anything being written down — and the tracker
// cannot survive the thing it tracks, because there is nothing to leave behind.
//
// THE LIST IS THE APPROVED MOCKUP'S, PLUS THE PHONE.
// The build inventory's prose lists five (connect a brain · connect your subscription · invite
// teammates · connect GitHub · install desktop). The approved round-4 mockup
// (mockups/onboarding-cloud-first.html:441-455) draws FOUR: it collapses brain and subscription
// into one, and omits GitHub. The mockup wins — CLAUDE.md #11, the approved round is the visual
// contract the developer builds to — and it is the better list: with the starter brain seated at
// signup, "connect a brain" is no longer an unmet need, so the ask is the subscription; and
// GitHub belongs to the first repo-backed task, not to a workspace's first five minutes.
//
// The PHONE is the fifth, added by George on 2026-08-28 because the mobile app exists and the
// list should say so. It closes the row beside the desktop: both are optional CLIENTS, and
// neither is a step you must take to work here.
//
// ORDER IS THE STRATEGY, so it is fixed here rather than sorted by state. The mockup's annotation
// is explicit: the machine leads BECAUSE it is already done (a gift received, not a chore), the
// subscription leads the asks, and the optional clients come last. Sorting done items to the
// bottom would destroy that reading, so the array order is the contract and `done` only ever
// changes how an item renders.

/** A machine row (synced). `kind` is NOT NULL DEFAULT 'local' in the schema (0126), so a row
 *  that arrives without one is a local machine — a desktop daemon, not cloud compute. */
export interface OnboardingMachine {
  kind?: string | null;
}

/** A workspace_members row (synced). Only the identity matters: the question is how many. */
export interface OnboardingMember {
  user_id: string;
}

/** A workspace provider credential. `subscription` is a marker with no token (0037) — the
 *  member signed in on their own machine and the platform never held the credential. */
export interface OnboardingCredential {
  authMode: string;
}

/** A registered push device. The PLATFORM only, never the token — /v1/devices answers "have you
 *  got the app" and deliberately cannot answer "what is your push credential". */
export interface OnboardingDevice {
  platform: string;
}

// EVERY SIGNAL IS NULLABLE, and that is not defensiveness — it is the difference between "we
// looked and found none" and "we could not look". A tracker that read a missing lane as an empty
// one would tell a cloud-first user "no cloud machine" about the machine the wizard just
// provisioned for them. `null` in, `null` out: the card asks, and nothing claims to know what it
// does not. Both clients serve every lane (the browser's arrive via webnm-rows.ts), so `null`
// here means a read that failed, not a client that was never wired.
export interface OnboardingSignals {
  /** synced machines rows; NULL when this client has no roster lane */
  machines: OnboardingMachine[] | null;
  /** synced workspace_members rows; NULL when this client has no roster lane */
  members: OnboardingMember[] | null;
  /** workspace credentials; NULL when this client cannot read them at all. Not the same as
   *  "none connected", and the card must not pretend otherwise. */
  credentials: OnboardingCredential[] | null;
  /** the SIGNED-IN PERSON's push devices (`device_tokens`, /v1/devices) — the only evidence the
   *  platform has that someone installed the phone app, since a phone is not a machine and never
   *  joins the roster. Per-user, not per-workspace: your phone is yours across every workspace,
   *  which is why this card can read done in a workspace you just joined. */
  devices: OnboardingDevice[] | null;
}

/** What a card's button does. A string, not a handler: this module is shared with the server
 *  and the daemon, and a pure derivation that closed over React callbacks would not be pure. */
export type OnboardingAction = 'none' | 'connect-brain' | 'invite' | 'get-desktop' | 'get-mobile';

export type OnboardingItemId = 'machine' | 'subscription' | 'team' | 'desktop' | 'mobile';

export interface OnboardingItem {
  id: OnboardingItemId;
  label: string;
  detail: string;
  /** `null` = UNKNOWN — no signal for this card exists on this client. A card with an unknown
   *  state renders as an ask, never as a tick: claiming "done" from missing data is the one
   *  failure mode a setup tracker cannot recover from, because the user never sees the ask
   *  again. `false` and `null` render alike; they are kept apart so a caller can tell why. */
  done: boolean | null;
  action: OnboardingAction;
}

/** A cloud machine is any machine that is not the local one. `lifecycle` is not in the replica
 *  schema, so this reads presence, not health — "we provisioned you one", which is what the
 *  card claims. A destroyed machine would still read done here; that is the known edge. */
const isCloud = (m: OnboardingMachine): boolean => (m.kind ?? 'local') !== 'local';

export function onboardingItems(s: OnboardingSignals): OnboardingItem[] {
  return [
    {
      id: 'machine',
      label: 'Cloud machine',
      detail: 'Awake and yours. Free to start.',
      done: s.machines === null ? null : s.machines.some(isCloud),
      action: 'none',
    },
    {
      id: 'subscription',
      label: 'Bring your subscription',
      detail: 'Sign in to Claude on your machine. The terminal opens here. Your plan pays for the usage.',
      done: s.credentials === null ? null : s.credentials.some((c) => c.authMode === 'subscription'),
      action: 'connect-brain',
    },
    {
      id: 'team',
      // A SECOND HUMAN, not a sent invite: invites are not synced, so an unaccepted one is
      // invisible to every client and a tracker built on it would go quiet for the wrong
      // reason. "Someone else is here" is the outcome the card is actually asking for.
      label: 'Invite your team',
      detail: 'Each member can get their own machine.',
      done: s.members === null ? null : s.members.length > 1,
      action: 'invite',
    },
    {
      id: 'desktop',
      label: 'Desktop app',
      detail: 'Optional. Your Mac joins as home base. Everything works in the browser too.',
      done: s.machines === null ? null : s.machines.some((m) => !isCloud(m)),
      action: 'get-desktop',
    },
    {
      // The two optional CLIENTS close the list together (George, 2026-08-28). Desktop was
      // "deliberately last" because it is not required; the phone is the same class of thing, so
      // it joins it at the end rather than displacing an ask above.
      id: 'mobile',
      label: 'Mobile app',
      detail: 'Optional. Approve work and follow threads from your phone.',
      // a phone is NOT a machine — it runs no agents and never joins the roster — so the only
      // evidence we have is a push device the person registered. absent that lane, unknown.
      done: s.devices === null ? null : s.devices.length > 0,
      action: 'get-mobile',
    },
  ];
}

/** True once every card is settled — the tracker's own retirement condition. An UNKNOWN card
 *  (`done: null`) is deliberately not settled: a checklist that disappears because a signal
 *  went missing would hide the asks rather than complete them. */
export function onboardingComplete(items: OnboardingItem[]): boolean {
  return items.every((i) => i.done === true);
}

/** True when at least one card knows its own state. A tracker with NOTHING known has nothing
 *  to tell anyone — four permanent asks would be noise, not a checklist — so the surface stays
 *  silent rather than guessing, and comes back the moment a lane starts serving. */
export function onboardingKnowable(items: OnboardingItem[]): boolean {
  return items.some((i) => i.done !== null);
}
