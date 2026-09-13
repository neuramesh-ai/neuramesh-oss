// The setup tracker's derivation (onboarding.ts): what each card reads to decide it is done,
// the order that carries the strategy, and the one state a checklist must never fake — done
// from a signal it does not have. Pure: rows in, cards out.
import { describe, expect, it } from 'vitest';
import { onboardingComplete, onboardingItems, onboardingKnowable, type OnboardingSignals } from '../src/onboarding';

/** a workspace with nothing set up: one member, no machines, no credentials connected */
const fresh: OnboardingSignals = { machines: [], members: [{ user_id: 'u-me' }], credentials: [], devices: [] };
const sig = (over: Partial<OnboardingSignals> = {}): OnboardingSignals => ({ ...fresh, ...over });
const by = (s: OnboardingSignals) => Object.fromEntries(onboardingItems(s).map((i) => [i.id, i.done]));

describe('the cards and their order', () => {
  it('renders the approved mockup s four plus the phone, in the order the mockup fixed', () => {
    // the annotation says the order IS the strategy: the gift first, the subscription leading
    // the asks, the two optional CLIENTS last. asserted as a list so a reorder has to be
    // deliberate — and so adding the phone could not quietly displace an ask above it.
    expect(onboardingItems(fresh).map((i) => i.id)).toEqual(['machine', 'subscription', 'team', 'desktop', 'mobile']);
  });

  it('order does not follow state — a done card stays where the mockup put it', () => {
    const done = sig({ machines: [{ kind: 'runner' }, { kind: 'local' }], members: [{ user_id: 'a' }, { user_id: 'b' }], credentials: [{ authMode: 'subscription' }], devices: [{ platform: 'ios' }] });
    expect(onboardingItems(done).map((i) => i.id)).toEqual(['machine', 'subscription', 'team', 'desktop', 'mobile']);
  });

  it('every card names an action, and only the gift has none to offer', () => {
    expect(onboardingItems(fresh).map((i) => i.action)).toEqual(['none', 'connect-brain', 'invite', 'get-desktop', 'get-mobile']);
  });
});

describe('the cloud-machine signal', () => {
  it('any non-local machine is the cloud machine', () => {
    expect(by(sig({ machines: [{ kind: 'runner' }] }))['machine']).toBe(true);
    expect(by(sig({ machines: [{ kind: 'member' }] }))['machine']).toBe(true);
  });

  it('a laptop is not a cloud machine, and a row with no kind is a laptop', () => {
    // machines.kind is NOT NULL DEFAULT 'local' (0126) — a missing value means local, and
    // reading it as cloud would tick the card for every desktop-only workspace
    expect(by(sig({ machines: [{ kind: 'local' }] }))['machine']).toBe(false);
    expect(by(sig({ machines: [{}] }))['machine']).toBe(false);
    expect(by(sig({ machines: [{ kind: null }] }))['machine']).toBe(false);
  });
});

describe('the subscription signal', () => {
  it('a subscription credential is what the card asks for', () => {
    expect(by(sig({ credentials: [{ authMode: 'subscription' }] }))['subscription']).toBe(true);
  });

  it('an API key is not a subscription — the card asks for the plan, not for a brain', () => {
    // the starter brain already answers "can it think"; this card is about billing to YOUR plan
    expect(by(sig({ credentials: [{ authMode: 'apikey' }] }))['subscription']).toBe(false);
  });

  it('NO credential lane at all reads UNKNOWN, never done', () => {
    // the web bridge does not serve credentials yet, so `null` is a real runtime state. a tracker
    // that ticked here would retire the ask permanently on the one client that cannot check it.
    expect(by(sig({ credentials: null }))['subscription']).toBeNull();
  });
});

describe('the team signal', () => {
  it('done once a SECOND human is in the workspace', () => {
    expect(by(sig({ members: [{ user_id: 'a' }, { user_id: 'b' }] }))['team']).toBe(true);
  });

  it('alone is not a team — and an unaccepted invite cannot count, because invites are not synced', () => {
    expect(by(fresh)['team']).toBe(false);
    expect(by(sig({ members: [] }))['team']).toBe(false);
  });
});

describe('the desktop signal', () => {
  it('a local machine row means a desktop daemon has joined', () => {
    expect(by(sig({ machines: [{ kind: 'local' }] }))['desktop']).toBe(true);
    expect(by(sig({ machines: [{}] }))['desktop']).toBe(true);
  });

  it('a cloud-only workspace has no desktop yet', () => {
    expect(by(sig({ machines: [{ kind: 'runner' }] }))['desktop']).toBe(false);
  });
});

describe('a missing lane is UNKNOWN, never a negative', () => {
  it('no roster lane leaves all three row-derived cards unknown', () => {
    // the browser client today: watchRoster is unwired, so reading [] would tell a cloud-first
    // user "no cloud machine" about the machine the wizard provisioned for them one screen ago
    const blind = by(sig({ machines: null, members: null }));
    expect(blind['machine']).toBeNull();
    expect(blind['desktop']).toBeNull();
    expect(blind['team']).toBeNull();
  });

  it('an EMPTY lane is a real answer, and reads false', () => {
    // [] means "we looked and there are none" — the difference this whole type exists to keep
    const empty = by(sig({ machines: [], members: [] }));
    expect(empty['machine']).toBe(false);
    expect(empty['desktop']).toBe(false);
    expect(empty['team']).toBe(false);
  });

  it('onboardingKnowable is false only when NOTHING is known', () => {
    expect(onboardingKnowable(onboardingItems(sig({ machines: null, members: null, credentials: null, devices: null })))).toBe(false);
    expect(onboardingKnowable(onboardingItems(sig({ machines: null, members: null, credentials: null })))).toBe(true);
    expect(onboardingKnowable(onboardingItems(sig({ machines: null, members: null })))).toBe(true);
    expect(onboardingKnowable(onboardingItems(fresh))).toBe(true);
  });
});

describe('onboardingComplete', () => {
  it('true only when EVERY item is done — this is what retires the tracker', () => {
    const all = sig({
      machines: [{ kind: 'runner' }, { kind: 'local' }],
      members: [{ user_id: 'a' }, { user_id: 'b' }],
      credentials: [{ authMode: 'subscription' }],
      devices: [{ platform: 'ios' }],
    });
    expect(onboardingComplete(onboardingItems(all))).toBe(true);
    // and the phone is genuinely load-bearing: drop it and the tracker stays
    expect(onboardingComplete(onboardingItems({ ...all, devices: [] }))).toBe(false);
  });

  it('an UNKNOWN card never completes the list', () => {
    // otherwise a missing signal would make the tracker vanish instead of asking
    const unknown = sig({
      machines: [{ kind: 'runner' }, { kind: 'local' }],
      members: [{ user_id: 'a' }, { user_id: 'b' }],
      credentials: null,
    });
    expect(onboardingComplete(onboardingItems(unknown))).toBe(false);
  });

  it('a fresh workspace is not complete', () => {
    expect(onboardingComplete(onboardingItems(fresh))).toBe(false);
  });
});

describe('the phone', () => {
  it('is done once the person registered a push device, on any platform', () => {
    // a phone is not a machine and never joins the roster, so a registered device is the ONLY
    // evidence the platform has that the app was installed
    expect(by(sig({ devices: [{ platform: 'ios' }] }))['mobile']).toBe(true);
    expect(by(sig({ devices: [{ platform: 'android' }] }))['mobile']).toBe(true);
    expect(by(sig({ devices: [] }))['mobile']).toBe(false);
  });

  it('is UNKNOWN, never done, when the device lane could not be read', () => {
    // the regression this guards: treating a failed read as "no phone" is survivable, but
    // treating it as "has a phone" would tick an item the human never gets asked about again
    expect(by(sig({ devices: null }))['mobile']).toBe(null);
  });

  it('does not let the phone alone complete the checklist', () => {
    const onlyPhone = sig({ devices: [{ platform: 'ios' }] });
    expect(onboardingComplete(onboardingItems(onlyPhone))).toBe(false);
  });
});
