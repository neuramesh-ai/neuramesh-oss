// Origin-affinity claim policy (0114). Every host's decision to spend a member's tokens runs
// through shouldClaim, so this is where the "shared compute" contract is actually pinned down.
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRACE_MS, MACHINE_ONLINE_MS, isCloudBorn, machineOnline, newestSeen, shouldClaim, type MachineCapability } from '../src/compute';
import { wakeCandidates } from '../src/compute-sleepers';

const NOW = Date.parse('2026-08-07T12:00:00Z');
const fresh = new Date(NOW - 10_000).toISOString();
const stale = new Date(NOW - MACHINE_ONLINE_MS - 60_000).toISOString();

const GEORGE = 'u-george';
const BOB = 'u-bob';

// `sharesWith: ['*']` by default — it mirrors what 0119's migration backfills for every workspace
// that existed before consent, so these cases describe a workspace where lending is already in
// place and are about capability/presence, not permission. The consent block at the bottom is
// where grants are varied on purpose.
const mach = (over: Partial<MachineCapability> & { machineId: string; ownerUserId: string }): MachineCapability => ({
  runtimes: ['claude-code'], lastSeenAt: fresh, sharesWith: ['*'], ...over,
});

const georgeMac = mach({ machineId: 'm-george', ownerUserId: GEORGE });
const bobMac = mach({ machineId: 'm-bob', ownerUserId: BOB });

const ctx = (self: MachineCapability, over: Partial<Parameters<typeof shouldClaim>[0]> = {}) => ({
  self,
  machines: [georgeMac, bobMac],
  runtime: 'claude-code',
  originUserId: GEORGE,
  elapsedMs: 0,
  ...over,
});

describe('capability gates everything', () => {
  it('a machine that cannot run the runtime never claims — even as the origin', () => {
    const noClaude = mach({ machineId: 'm-george', ownerUserId: GEORGE, runtimes: ['codex'] });
    // claiming work you cannot run is worse than not claiming: the claim is what stops
    // anyone else from trying
    expect(shouldClaim(ctx(noClaude), NOW)).toEqual({ act: 'skip', why: 'incapable' });
  });
});

// THE DRAW BUTTON (George, 2026-09-05). `‹gen-image:…›` runs no model turn, so the runtime rung
// must not gate it: a cloud machine with no CLI drew nothing, and the card could not even be told
// why, because the same machine's error post was refused too.
describe('work that runs no model needs no runtime', () => {
  const noClaude = mach({ machineId: 'm-george', ownerUserId: GEORGE, runtimes: [] });

  it('a machine with no runtimes at all still claims a model-free wake it is the origin for', () => {
    expect(shouldClaim(ctx(noClaude, { modelFree: true }), NOW)).toEqual({ act: 'claim', why: 'origin' });
  });

  it('the same wake without the flag is still refused — this is a per-WORK exemption, not a hole', () => {
    expect(shouldClaim(ctx(noClaude), NOW)).toEqual({ act: 'skip', why: 'incapable' });
  });

  it('model-free work still obeys every rung below capability: a designation elsewhere is honoured', () => {
    const verdict = shouldClaim(ctx(noClaude, { modelFree: true, threadMachineId: 'm-bob' }), NOW);
    expect(verdict.act).not.toEqual('claim');
  });

  it('consent still binds: an ungranted machine does not claim just because no model is needed', () => {
    const mine = mach({ machineId: 'm-bob', ownerUserId: BOB, runtimes: [], sharesWith: [] });
    const verdict = shouldClaim(ctx(mine, { modelFree: true, machines: [mine, georgeMac] }), NOW);
    expect(verdict.act).not.toEqual('claim');
  });
});

describe('the origin machine gets first refusal', () => {
  it('claims immediately when the work came from its own member', () => {
    expect(shouldClaim(ctx(georgeMac), NOW)).toEqual({ act: 'claim', why: 'origin' });
  });

  it("another member's machine waits out the grace window first", () => {
    const v = shouldClaim(ctx(bobMac), NOW);
    expect(v.act).toBe('wait');
    expect(v).toMatchObject({ why: 'origin-may-serve' });
  });

  it('...and steps in once the window elapses and nobody took it', () => {
    expect(shouldClaim(ctx(bobMac, { elapsedMs: DEFAULT_GRACE_MS }), NOW))
      .toEqual({ act: 'claim', why: 'grace-elapsed' });
  });

  it('the wait is bounded by the remaining window, never zero', () => {
    const v = shouldClaim(ctx(bobMac, { elapsedMs: DEFAULT_GRACE_MS - 100 }), NOW);
    expect(v.act).toBe('wait');
    if (v.act === 'wait') expect(v.retryInMs).toBeGreaterThan(0);
  });
});

describe('failover: no waiting on a machine that cannot serve', () => {
  it("claims at once when the origin's machine is offline", () => {
    const offline = mach({ machineId: 'm-george', ownerUserId: GEORGE, lastSeenAt: stale });
    expect(shouldClaim(ctx(bobMac, { machines: [offline, bobMac] }), NOW))
      .toEqual({ act: 'claim', why: 'no-origin-host' });
  });

  it("claims at once when the origin's machine lacks the runtime", () => {
    // george is on codex only; the agent needs claude-code. Waiting 8s for a machine that can
    // never serve is pure latency.
    const codexOnly = mach({ machineId: 'm-george', ownerUserId: GEORGE, runtimes: ['codex'] });
    expect(shouldClaim(ctx(bobMac, { machines: [codexOnly, bobMac] }), NOW))
      .toEqual({ act: 'claim', why: 'no-origin-host' });
  });

  it('claims at once when the origin member has no machine at all (phone-only member)', () => {
    expect(shouldClaim(ctx(bobMac, { machines: [bobMac] }), NOW))
      .toEqual({ act: 'claim', why: 'no-origin-host' });
  });

  it('a member with TWO machines is covered if either can serve', () => {
    const laptop = mach({ machineId: 'm-g1', ownerUserId: GEORGE, lastSeenAt: stale });
    const desktop = mach({ machineId: 'm-g2', ownerUserId: GEORGE });
    const v = shouldClaim(ctx(bobMac, { machines: [laptop, desktop, bobMac] }), NOW);
    expect(v.act).toBe('wait');
  });
});

describe('work with no human origin', () => {
  it('any capable machine may serve a sweep or a schedule immediately', () => {
    expect(shouldClaim(ctx(bobMac, { originUserId: null }), NOW))
      .toEqual({ act: 'claim', why: 'unattributed' });
  });
});

describe('machineOnline', () => {
  it('tracks the heartbeat window and treats a never-seen machine as offline', () => {
    expect(machineOnline(georgeMac, NOW)).toBe(true);
    expect(machineOnline(mach({ machineId: 'x', ownerUserId: BOB, lastSeenAt: stale }), NOW)).toBe(false);
    expect(machineOnline(mach({ machineId: 'x', ownerUserId: BOB, lastSeenAt: null }), NOW)).toBe(false);
  });
});

describe('the property that keeps the bill honest', () => {
  it('exactly one machine claims at t=0 when the origin is online and capable', () => {
    const all = [georgeMac, bobMac, mach({ machineId: 'm-c', ownerUserId: 'u-carol' })];
    const claimers = all.filter((m) => shouldClaim(ctx(m, { machines: all }), NOW).act === 'claim');
    // this is the assertion that stops three laptops each spinning a model on one chat message
    expect(claimers.map((m) => m.machineId)).toEqual(['m-george']);
  });

  it('once the origin drops, every remaining machine becomes eligible at once', () => {
    const offline = mach({ machineId: 'm-george', ownerUserId: GEORGE, lastSeenAt: stale });
    const all = [offline, bobMac, mach({ machineId: 'm-c', ownerUserId: 'u-carol' })];
    // Only the machines actually RUNNING evaluate the policy — george's is asleep, which is what
    // "offline" means. (Its own rule-2 would still fire if it woke up mid-window, and that is
    // correct: a host evaluating this is by definition alive, whatever its replicated heartbeat
    // says about itself.)
    const awake = all.filter((m) => m.machineId !== 'm-george');
    const claimers = awake.filter((m) => shouldClaim(ctx(m, { machines: all }), NOW).act === 'claim');
    // more than one may TRY — the server's atomic claim (task.claim / the run lease) is what
    // makes exactly one win. The policy's job is only to stop the needless attempts.
    expect(claimers.map((m) => m.machineId)).toEqual(['m-bob', 'm-c']);
  });

  it('a woken origin machine still serves its own member despite a stale self-heartbeat', () => {
    // the replica's view of SELF lags a resume-from-sleep; deferring to nobody would strand the
    // work for a full grace window for no reason
    const justWoke = mach({ machineId: 'm-george', ownerUserId: GEORGE, lastSeenAt: stale });
    expect(shouldClaim(ctx(justWoke, { machines: [justWoke, bobMac] }), NOW))
      .toEqual({ act: 'claim', why: 'origin' });
  });
});

// ── the designation ladder (0118): continuity → per-agent choice → default ──────────────────
// George's rules, verbatim (2026-08-12): prefs move NEW conversations; an existing thread keeps
// the machine that holds its files; capability gates every rung; offline never wedges.
import { isHouseBrain, placementFor, type ComputePrefs } from '../src/compute';
import { STARTER_MODEL } from '../src/rates';

describe('the designation ladder', () => {
  const prefs: ComputePrefs = { machine: 'm-george', agents: { 'a-scout': 'm-bob' } };

  it('continuity outranks preference: the thread’s machine keeps it even against a default', () => {
    // george's default says m-george, but this thread lives on bob's machine
    expect(shouldClaim(ctx(bobMac, { prefs, priorMachineId: 'm-bob' }), NOW))
      .toEqual({ act: 'claim', why: 'designated' });
    // …and george's own machine WAITS despite being both origin and default
    expect(shouldClaim(ctx(georgeMac, { prefs, priorMachineId: 'm-bob' }), NOW))
      .toEqual({ act: 'wait', why: 'designated-may-serve', retryInMs: DEFAULT_GRACE_MS });
  });

  it('continuity applies even to unattributed work — a routine writing into an old thread stays put', () => {
    expect(shouldClaim(ctx(bobMac, { originUserId: null, priorMachineId: 'm-bob' }), NOW))
      .toEqual({ act: 'claim', why: 'designated' });
    expect(shouldClaim(ctx(georgeMac, { originUserId: null, priorMachineId: 'm-bob' }), NOW).act).toBe('wait');
  });

  it('a per-agent choice beats the default machine', () => {
    expect(shouldClaim(ctx(bobMac, { prefs, agentId: 'a-scout' }), NOW))
      .toEqual({ act: 'claim', why: 'designated' });
    expect(shouldClaim(ctx(georgeMac, { prefs, agentId: 'a-scout' }), NOW).act).toBe('wait');
  });

  it('the default machine designates when no per-agent choice matches', () => {
    expect(shouldClaim(ctx(georgeMac, { prefs, agentId: 'a-rex' }), NOW))
      .toEqual({ act: 'claim', why: 'designated' });
  });

  it('an offline designated machine does not designate — the ladder falls through, never wedges', () => {
    const bobAsleep = mach({ machineId: 'm-bob', ownerUserId: BOB, lastSeenAt: stale });
    // thread lives on bob's sleeping machine; george is origin → origin affinity takes over
    expect(shouldClaim(ctx(georgeMac, { machines: [georgeMac, bobAsleep], priorMachineId: 'm-bob' }), NOW))
      .toEqual({ act: 'claim', why: 'origin' });
  });

  it('an incapable designated machine does not designate', () => {
    const bobNoGemini = mach({ machineId: 'm-bob', ownerUserId: BOB, runtimes: ['claude-code'] });
    const georgeGemini = mach({ machineId: 'm-george', ownerUserId: GEORGE, runtimes: ['gemini'] });
    // george picked bob's machine for scout, but bob's can't serve gemini → george's own serves
    expect(shouldClaim(ctx(georgeGemini, {
      machines: [georgeGemini, bobNoGemini], runtime: 'gemini',
      prefs: { agents: { 'a-scout': 'm-bob' } }, agentId: 'a-scout',
    }), NOW)).toEqual({ act: 'claim', why: 'origin' });
  });

  it('another member’s prefs never move MY unrelated request — prefs ride the origin only', () => {
    // bob is the origin here; the ctx carries BOB's (empty) prefs, not george's — the call site
    // owns that pairing, and with no prefs and no continuity, origin affinity rules
    expect(shouldClaim(ctx(bobMac, { originUserId: BOB, prefs: null }), NOW))
      .toEqual({ act: 'claim', why: 'origin' });
  });

  it('capability still gates rung zero: a designated-elsewhere machine that cannot serve skips outright', () => {
    const noClaude = mach({ machineId: 'm-c', ownerUserId: 'u-carol', runtimes: ['codex'] });
    expect(shouldClaim(ctx(noClaude, { priorMachineId: 'm-bob' }), NOW))
      .toEqual({ act: 'skip', why: 'incapable' });
  });

  it('after the grace window a non-designated machine steps in — designation is a delay, not a lock', () => {
    // the origin's own machine steps in AS the origin: the elapsed window hands the decision back
    // to the lower rungs rather than claiming outright (2026-09-04, see the consent case below)
    expect(shouldClaim(ctx(georgeMac, { priorMachineId: 'm-bob', elapsedMs: DEFAULT_GRACE_MS }), NOW))
      .toEqual({ act: 'claim', why: 'origin' });
    // a granted stranger steps in on the origin-affinity clock, exactly as before
    const carol = mach({ machineId: 'm-carol', ownerUserId: 'u-carol' });
    expect(shouldClaim(ctx(carol, { machines: [georgeMac, bobMac, carol], priorMachineId: 'm-bob', elapsedMs: DEFAULT_GRACE_MS }), NOW))
      .toEqual({ act: 'claim', why: 'grace-elapsed' });
  });

  it('an elapsed window is not consent: an UNGRANTED machine still stays out of designated work', () => {
    // before 2026-09-04 rung 2 returned a claim the moment the window elapsed, and nothing below
    // it ran — the one path on which a machine nobody lent could spend its owner's subscription
    const carolPrivate = mach({ machineId: 'm-carol', ownerUserId: 'u-carol', sharesWith: [] });
    expect(shouldClaim(ctx(carolPrivate, { machines: [georgeMac, bobMac, carolPrivate], priorMachineId: 'm-bob', elapsedMs: DEFAULT_GRACE_MS }), NOW))
      .toEqual({ act: 'skip', why: 'not-granted' });
  });
});

// ── the origin rung (rule D9, docs/design/desktop-code-bridge-2026-09; George, 2026-09-04) ──
// "routines and sessions started on the web should always prefer running on web over desktop if
// there's a cloud machine available; users can default local sessions to their local machine."
// The session is the subject: `threads.origin` says which client bore it, `threads.machine_id`
// what it was designated to. A cloud machine is the member's own member machine, else the runner.
describe('the origin rung: a session born on the web or by a routine prefers the cloud', () => {
  const georgeCloud = mach({ machineId: 'm-george-cloud', ownerUserId: GEORGE, kind: 'member' });
  const runner = mach({ machineId: 'm-runner', ownerUserId: 'u-platform', kind: 'runner' });
  const fleet = [georgeMac, bobMac, georgeCloud, runner];

  it('web-born: the member’s own cloud machine claims at once; their laptop waits the window, then steps in as the origin', () => {
    expect(shouldClaim(ctx(georgeCloud, { machines: fleet, origin: 'web' }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
    expect(shouldClaim(ctx(georgeMac, { machines: fleet, origin: 'web' }), NOW))
      .toEqual({ act: 'wait', why: 'cloud-may-serve', retryInMs: DEFAULT_GRACE_MS });
    expect(shouldClaim(ctx(georgeMac, { machines: fleet, origin: 'web', elapsedMs: DEFAULT_GRACE_MS }), NOW))
      .toEqual({ act: 'claim', why: 'origin' });
  });

  it('routine-born: nobody’s member machine to prefer, so the workspace runner is the cloud', () => {
    expect(shouldClaim(ctx(runner, { machines: fleet, origin: 'routine', originUserId: null }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
    expect(shouldClaim(ctx(georgeMac, { machines: fleet, origin: 'routine', originUserId: null }), NOW)).toMatchObject({ act: 'wait', why: 'cloud-may-serve' });
    // the runner stays a runner: a web-born session of george's goes to HIS cloud machine first
    expect(shouldClaim(ctx(runner, { machines: fleet, origin: 'web' }), NOW).act).toBe('wait');
  });

  it('a thread born before the column (no origin) keeps today’s ladder — the laptop is still the origin', () => {
    expect(shouldClaim(ctx(georgeMac, { machines: fleet }), NOW)).toEqual({ act: 'claim', why: 'origin' });
    expect(shouldClaim(ctx(georgeCloud, { machines: fleet }), NOW)).toEqual({ act: 'claim', why: 'origin' });
  });

  it('desktop-born on Auto: the cloud machine when one is awake…', () => {
    expect(shouldClaim(ctx(georgeCloud, { machines: fleet, origin: 'desktop' }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
    expect(shouldClaim(ctx(georgeMac, { machines: fleet, origin: 'desktop' }), NOW)).toMatchObject({ act: 'wait', why: 'cloud-may-serve' });
  });

  it('…and the laptop itself when none is — the rung is a preference, never a wall', () => {
    const cloudAsleep = mach({ machineId: 'm-george-cloud', ownerUserId: GEORGE, kind: 'member', lastSeenAt: stale });
    const runnerAsleep = mach({ machineId: 'm-runner', ownerUserId: 'u-platform', kind: 'runner', lastSeenAt: stale });
    const asleep = [georgeMac, bobMac, cloudAsleep, runnerAsleep];
    expect(shouldClaim(ctx(georgeMac, { machines: asleep, origin: 'desktop' }), NOW)).toEqual({ act: 'claim', why: 'origin' });
    expect(shouldClaim(ctx(georgeMac, { machines: asleep, origin: 'web' }), NOW)).toEqual({ act: 'claim', why: 'origin' });
    // desktop-born on Auto: an incapable cloud machine is no cloud machine for this runtime — the
    // member's Mac has their login right there, so it keeps the session (web-born differs: below)
    const cloudNoGemini = mach({ machineId: 'm-george-cloud', ownerUserId: GEORGE, kind: 'member', runtimes: ['claude-code'] });
    const georgeGemini = mach({ machineId: 'm-george', ownerUserId: GEORGE, runtimes: ['gemini'] });
    expect(shouldClaim(ctx(georgeGemini, { machines: [georgeGemini, cloudNoGemini], runtime: 'gemini', origin: 'desktop' }), NOW))
      .toEqual({ act: 'claim', why: 'origin' });
  });

  // RUNG 0 (George, 2026-09-19): "all queries / routines started on the web or mobile should always
  // run on the cloud machine; if their configured brain isn't available, it should use the
  // neuramesh brain with credits; brain availability across their devices shouldn't be what
  // decides where a thread runs". Seen live: rex seated on Claude, the runner publishing only
  // codex, `wake_skip … cannot serve claude-code` twice, and the laptop answering on an old build.
  describe('rung 0: a cloud-born session runs on the cloud, whatever brain the cloud machine holds', () => {
    const runnerCodex = mach({ machineId: 'm-runner', ownerUserId: 'u-platform', kind: 'runner', runtimes: ['codex'] });
    const noClaudeCloud = [georgeMac, bobMac, runnerCodex];

    it('web-born on a Claude seat: the codex-only runner claims; the capable laptop waits, then steps in as the origin', () => {
      expect(shouldClaim(ctx(runnerCodex, { machines: noClaudeCloud, origin: 'web' }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
      expect(shouldClaim(ctx(georgeMac, { machines: noClaudeCloud, origin: 'web' }), NOW))
        .toEqual({ act: 'wait', why: 'cloud-may-serve', retryInMs: DEFAULT_GRACE_MS });
      // the runner never took it inside the window (wedged): a delay, never a black hole
      expect(shouldClaim(ctx(georgeMac, { machines: noClaudeCloud, origin: 'web', elapsedMs: DEFAULT_GRACE_MS }), NOW)).toEqual({ act: 'claim', why: 'origin' });
    });

    it('routine-born likewise, with nobody\'s member machine to prefer', () => {
      expect(shouldClaim(ctx(runnerCodex, { machines: noClaudeCloud, origin: 'routine', originUserId: null }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
      expect(shouldClaim(ctx(georgeMac, { machines: noClaudeCloud, origin: 'routine', originUserId: null }), NOW)).toMatchObject({ act: 'wait', why: 'cloud-may-serve' });
    });

    it('the member\'s own cloud machine outranks the runner, capability unasked of either', () => {
      const cloudCodex = mach({ machineId: 'm-george-cloud', ownerUserId: GEORGE, kind: 'member', runtimes: ['codex'] });
      const both = [georgeMac, cloudCodex, runnerCodex];
      expect(shouldClaim(ctx(cloudCodex, { machines: both, origin: 'web' }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
      expect(shouldClaim(ctx(runnerCodex, { machines: both, origin: 'web' }), NOW)).toMatchObject({ act: 'wait', why: 'cloud-may-serve' });
      // after the window the runner is judged by the old rungs, and it cannot serve Claude: it skips
      expect(shouldClaim(ctx(runnerCodex, { machines: both, origin: 'web', elapsedMs: DEFAULT_GRACE_MS }), NOW)).toEqual({ act: 'skip', why: 'incapable' });
    });

    it('the chip\'s explicit pick of the cloud machine holds even when it lacks the brain', () => {
      expect(shouldClaim(ctx(runnerCodex, { machines: noClaudeCloud, origin: 'web', threadMachineId: 'm-runner' }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
      expect(shouldClaim(ctx(georgeMac, { machines: noClaudeCloud, origin: 'web', threadMachineId: 'm-runner' }), NOW)).toMatchObject({ act: 'wait', why: 'cloud-may-serve' });
      // a member machine named by another member is not theirs to pick: Auto's own pick instead (the runner)
      const bobCloud = mach({ machineId: 'm-bob-cloud', ownerUserId: BOB, kind: 'member', runtimes: ['codex'] });
      expect(shouldClaim(ctx(runnerCodex, { machines: [...noClaudeCloud, bobCloud], origin: 'web', threadMachineId: 'm-bob-cloud' }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
      expect(shouldClaim(ctx(bobCloud, { machines: [...noClaudeCloud, bobCloud], origin: 'web', threadMachineId: 'm-bob-cloud' }), NOW)).toMatchObject({ act: 'wait' });
    });

    it('the chip\'s explicit pick of a laptop is a designation: the rung stands aside', () => {
      expect(shouldClaim(ctx(georgeMac, { machines: noClaudeCloud, origin: 'web', threadMachineId: 'm-george' }), NOW)).toEqual({ act: 'claim', why: 'designated' });
      expect(shouldClaim(ctx(runnerCodex, { machines: noClaudeCloud, origin: 'web', threadMachineId: 'm-george' }), NOW)).toEqual({ act: 'skip', why: 'incapable' });
    });

    it('continuity to a laptop does not pin a cloud-born session; continuity among cloud machines does', () => {
      // a web-born thread the laptop once served (the old ladder) moves to the cloud on its next message
      expect(shouldClaim(ctx(runnerCodex, { machines: noClaudeCloud, origin: 'web', priorMachineId: 'm-george' }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
      expect(shouldClaim(ctx(georgeMac, { machines: noClaudeCloud, origin: 'web', priorMachineId: 'm-george' }), NOW)).toMatchObject({ act: 'wait', why: 'cloud-may-serve' });
      // a thread the runner served keeps its files there, even once the member's own cloud machine wakes
      const cloudCodex = mach({ machineId: 'm-george-cloud', ownerUserId: GEORGE, kind: 'member', runtimes: ['codex'] });
      const both = [georgeMac, cloudCodex, runnerCodex];
      expect(shouldClaim(ctx(runnerCodex, { machines: both, origin: 'web', priorMachineId: 'm-runner' }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
      expect(shouldClaim(ctx(cloudCodex, { machines: both, origin: 'web', priorMachineId: 'm-runner' }), NOW)).toMatchObject({ act: 'wait', why: 'cloud-may-serve' });
      // a prior cloud machine that is asleep is no home: Auto's pick again
      const runnerAsleep = mach({ machineId: 'm-runner', ownerUserId: 'u-platform', kind: 'runner', runtimes: ['codex'], lastSeenAt: stale });
      expect(shouldClaim(ctx(cloudCodex, { machines: [georgeMac, cloudCodex, runnerAsleep], origin: 'web', priorMachineId: 'm-runner' }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
    });

    it('a thread born before the column, and a desktop-born one, never reach the rung', () => {
      expect(isCloudBorn('web')).toBe(true);
      expect(isCloudBorn('routine')).toBe(true);
      expect(isCloudBorn('desktop')).toBe(false);
      expect(isCloudBorn(null)).toBe(false);
      expect(shouldClaim(ctx(runnerCodex, { machines: noClaudeCloud }), NOW)).toEqual({ act: 'skip', why: 'incapable' });
      expect(shouldClaim(ctx(runnerCodex, { machines: noClaudeCloud, origin: 'desktop' }), NOW)).toEqual({ act: 'skip', why: 'incapable' });
    });
  });

  it('the desktop default on “here”: the session is DESIGNATED to that Mac at birth, and designation outranks the cloud', () => {
    expect(shouldClaim(ctx(georgeMac, { machines: fleet, origin: 'desktop', threadMachineId: 'm-george' }), NOW)).toEqual({ act: 'claim', why: 'designated' });
    expect(shouldClaim(ctx(georgeCloud, { machines: fleet, origin: 'desktop', threadMachineId: 'm-george' }), NOW))
      .toEqual({ act: 'wait', why: 'designated-may-serve', retryInMs: DEFAULT_GRACE_MS });
  });

  it('the chip’s explicit choice is the same designation, from any client', () => {
    expect(shouldClaim(ctx(bobMac, { machines: fleet, origin: 'web', threadMachineId: 'm-bob' }), NOW)).toEqual({ act: 'claim', why: 'designated' });
    expect(shouldClaim(ctx(georgeCloud, { machines: fleet, origin: 'web', threadMachineId: 'm-bob' }), NOW).act).toBe('wait');
  });

  it('a session’s designation needs the owner’s grant, like every preference; a routine may name any machine', () => {
    const bobPrivate = mach({ machineId: 'm-bob', ownerUserId: BOB, sharesWith: [] });
    const withPrivate = [georgeMac, bobPrivate, georgeCloud];
    // george's web session named bob's ungranted laptop: it does not designate, the cloud rung takes over
    expect(shouldClaim(ctx(georgeCloud, { machines: withPrivate, origin: 'web', threadMachineId: 'm-bob' }), NOW)).toEqual({ act: 'claim', why: 'cloud' });
    expect(shouldClaim(ctx(bobPrivate, { machines: withPrivate, origin: 'web', threadMachineId: 'm-bob' }), NOW)).toMatchObject({ act: 'wait', why: 'cloud-may-serve' });
    // a routine has nobody's grants to read: its designation stands
    expect(shouldClaim(ctx(bobPrivate, { machines: withPrivate, origin: 'routine', originUserId: null, threadMachineId: 'm-bob' }), NOW))
      .toEqual({ act: 'claim', why: 'designated' });
  });

  it('continuity still outranks everything for a desktop-born thread: it stays on the machine that served it', () => {
    expect(shouldClaim(ctx(bobMac, { machines: fleet, origin: 'desktop', priorMachineId: 'm-bob' }), NOW)).toEqual({ act: 'claim', why: 'designated' });
    expect(shouldClaim(ctx(georgeCloud, { machines: fleet, origin: 'desktop', priorMachineId: 'm-bob' }), NOW).act).toBe('wait');
  });

  it('liveCloudMachine names the member’s own cloud machine before the runner, and only when awake and capable', () => {
    const need = { runtime: 'claude-code', model: null };
    expect(liveCloudMachine(fleet, GEORGE, need, NOW)).toBe('m-george-cloud');
    expect(liveCloudMachine(fleet, BOB, need, NOW)).toBe('m-runner');
    expect(liveCloudMachine(fleet, null, need, NOW)).toBe('m-runner');
    expect(liveCloudMachine([georgeMac, bobMac], GEORGE, need, NOW)).toBeNull();
    // capability unasked (rung 0): the codex-only runner is still the cloud for a Claude seat
    const runnerCodex = mach({ machineId: 'm-runner', ownerUserId: 'u-platform', kind: 'runner', runtimes: ['codex'] });
    expect(liveCloudMachine([georgeMac, runnerCodex], GEORGE, need, NOW)).toBeNull();
    expect(liveCloudMachine([georgeMac, runnerCodex], GEORGE, null, NOW)).toBe('m-runner');
  });

  it('placementFor with an origin previews the same rung, after the member’s own choices', () => {
    expect(placementFor({ id: 'a-rex', runtime: 'claude-code' }, null, fleet, GEORGE, NOW, 'web')).toEqual({ machineId: 'm-george-cloud', why: 'cloud' });
    // the preview agrees with rung 0: a cloud-born session's cloud machine needs no capability
    const runnerCodex = mach({ machineId: 'm-runner', ownerUserId: 'u-platform', kind: 'runner', runtimes: ['codex'] });
    expect(placementFor({ id: 'a-rex', runtime: 'claude-code' }, null, [georgeMac, runnerCodex], GEORGE, NOW, 'web')).toEqual({ machineId: 'm-runner', why: 'cloud' });
    expect(placementFor({ id: 'a-rex', runtime: 'claude-code' }, null, [georgeMac, runnerCodex], GEORGE, NOW, 'desktop')).toEqual({ machineId: 'm-george', why: 'origin' });
    expect(placementFor({ id: 'a-rex', runtime: 'claude-code' }, { machine: 'm-george' }, fleet, GEORGE, NOW, 'web')).toEqual({ machineId: 'm-george', why: 'default' });
    // the Compute panel's standing column asks with no origin and reads as before
    expect(placementFor({ id: 'a-rex', runtime: 'claude-code' }, null, fleet, GEORGE, NOW)).toEqual({ machineId: 'm-george', why: 'origin' });
  });
});
import { liveCloudMachine } from '../src/compute';

describe('placementFor — the panel’s effective column', () => {
  const machines = [georgeMac, bobMac];
  it('per-agent choice, then default, each capability-gated', () => {
    expect(placementFor({ id: 'a-scout', runtime: 'claude-code' }, { machine: 'm-george', agents: { 'a-scout': 'm-bob' } }, machines, GEORGE, NOW))
      .toEqual({ machineId: 'm-bob', why: 'agent-choice' });
    expect(placementFor({ id: 'a-rex', runtime: 'claude-code' }, { machine: 'm-george' }, machines, GEORGE, NOW))
      .toEqual({ machineId: 'm-george', why: 'default' });
  });
  it('unset prefs resolve to the member’s own machine; incapable falls to the first capable peer', () => {
    expect(placementFor({ id: 'a-rex', runtime: 'claude-code' }, null, machines, GEORGE, NOW))
      .toEqual({ machineId: 'm-george', why: 'origin' });
    const gemBob = [georgeMac, mach({ machineId: 'm-bob', ownerUserId: BOB, runtimes: ['gemini'] })];
    expect(placementFor({ id: 'a-scout', runtime: 'gemini' }, { machine: 'm-george' }, gemBob, GEORGE, NOW))
      .toEqual({ machineId: 'm-bob', why: 'failover' });
  });
  it('nobody can serve → none, and the panel says so instead of pretending', () => {
    expect(placementFor({ id: 'a-scout', runtime: 'agy' }, null, machines, GEORGE, NOW))
      .toEqual({ machineId: null, why: 'none' });
  });
});

// ── consent (0119): a machine is LENT, never taken ─────────────────────────────────────────
// The hole this closes: before it, any member could point their requests at anyone's machine and
// failover could recruit any capable machine — both spending the owner's subscription without
// ever asking them (George, 2026-08-12).
import { machineAvailableTo, availableMachines } from '../src/compute';

describe('consent', () => {
  const noShare = (over: Partial<MachineCapability> & { machineId: string; ownerUserId: string }) =>
    mach({ ...over, sharesWith: [] });

  it('machineAvailableTo: mine always; anyone else only with a grant', () => {
    const bobs = noShare({ machineId: 'm-bob', ownerUserId: BOB });
    expect(machineAvailableTo(bobs, BOB)).toBe(true);       // his own
    expect(machineAvailableTo(bobs, GEORGE)).toBe(false);   // not lent
    expect(machineAvailableTo({ ...bobs, sharesWith: [GEORGE] }, GEORGE)).toBe(true);
    expect(machineAvailableTo({ ...bobs, sharesWith: ['*'] }, GEORGE)).toBe(true);
    // unattributed work carries nobody's grants
    expect(machineAvailableTo({ ...bobs, sharesWith: ['*'] }, null)).toBe(false);
  });

  it('availableMachines is what the panel lists — mine plus what is lent to me', () => {
    const mine = noShare({ machineId: 'm-george', ownerUserId: GEORGE });
    const lent = mach({ machineId: 'm-bob', ownerUserId: BOB, sharesWith: [GEORGE] });
    const other = noShare({ machineId: 'm-c', ownerUserId: 'u-carol' });
    expect(availableMachines([mine, lent, other], GEORGE).map((m) => m.machineId)).toEqual(['m-george', 'm-bob']);
  });

  it('an UNGRANTED machine will not serve another member — even as the last one awake', () => {
    // george is offline; bob's machine is the only host running, and it is capable. Before
    // consent this was the failover case and bob claimed. Now it stays out.
    const georgeAsleep = mach({ machineId: 'm-george', ownerUserId: GEORGE, lastSeenAt: stale });
    const bobPrivate = noShare({ machineId: 'm-bob', ownerUserId: BOB });
    expect(shouldClaim(ctx(bobPrivate, { machines: [georgeAsleep, bobPrivate] }), NOW))
      .toEqual({ act: 'skip', why: 'not-granted' });
    // …and with the grant, it is the failover it always was
    const bobLends = mach({ machineId: 'm-bob', ownerUserId: BOB, sharesWith: [GEORGE] });
    expect(shouldClaim(ctx(bobLends, { machines: [georgeAsleep, bobLends] }), NOW))
      .toEqual({ act: 'claim', why: 'no-origin-host' });
  });

  it('an ungranted preference does not designate — it degrades to your own machine', () => {
    // george picked bob's machine, then bob revoked. The request must still run, on george's own.
    const bobPrivate = noShare({ machineId: 'm-bob', ownerUserId: BOB });
    const machines = [georgeMac, bobPrivate];
    expect(shouldClaim(ctx(georgeMac, { machines, prefs: { machine: 'm-bob' } }), NOW))
      .toEqual({ act: 'claim', why: 'origin' });
    // and bob's own machine does not pick it up on george's behalf either
    expect(shouldClaim(ctx(bobPrivate, { machines, prefs: { machine: 'm-bob' } }), NOW))
      .toEqual({ act: 'skip', why: 'not-granted' });
  });

  it('CONTINUITY IS UNGATED — a revoked grant never strands a thread already living there', () => {
    // George's rule: follow-ups are fine, the files are already on that disk. Revoke stops NEW
    // conversations; §08's confirm counts these and offers to move them.
    const bobPrivate = noShare({ machineId: 'm-bob', ownerUserId: BOB });
    expect(shouldClaim(ctx(bobPrivate, { machines: [georgeMac, bobPrivate], priorMachineId: 'm-bob' }), NOW))
      .toEqual({ act: 'claim', why: 'designated' });
  });

  it('your own machine never needs a grant, and capability still outranks everything', () => {
    const mineNoShare = noShare({ machineId: 'm-george', ownerUserId: GEORGE });
    expect(shouldClaim(ctx(mineNoShare, { machines: [mineNoShare] }), NOW))
      .toEqual({ act: 'claim', why: 'origin' });
    // incapable is still checked FIRST — an ungranted incapable machine reports the reason it
    // could never help, not the permission it also lacks
    const incapable = noShare({ machineId: 'm-bob', ownerUserId: BOB, runtimes: ['codex'] });
    expect(shouldClaim(ctx(incapable, { machines: [incapable] }), NOW))
      .toEqual({ act: 'skip', why: 'incapable' });
  });

  it('placementFor never names a machine you cannot reach', () => {
    const bobPrivate = noShare({ machineId: 'm-bob', ownerUserId: BOB, runtimes: ['gemini'] });
    const machines = [georgeMac, bobPrivate];
    // gemini exists in the workspace but is not lent to george — the panel says "none", not m-bob
    expect(placementFor({ id: 'a-gem', runtime: 'gemini' }, null, machines, GEORGE, NOW))
      .toEqual({ machineId: null, why: 'none' });
    const bobLends = { ...bobPrivate, sharesWith: [GEORGE] };
    expect(placementFor({ id: 'a-gem', runtime: 'gemini' }, null, [georgeMac, bobLends], GEORGE, NOW))
      .toEqual({ machineId: 'm-bob', why: 'failover' });
  });
});

import { applyShare, nobodyCanServe } from '../src/compute';
import { hostSpeaksForOrigin } from '../src/compute-voice';

describe('applyShare — the set math the CLIENT must not do', () => {
  const ALL = ['u-george', 'u-bob', 'u-carol'];
  it('expands a wildcard using the AUTHORITATIVE roster, not a partial one', () => {
    expect(applyShare(['*'], ALL, 'u-george', 'u-bob', false).sort()).toEqual(['u-carol']);
  });
  it('turning someone ON when already covered by "*" is a no-op, not a silent revoke', () => {
    // the exact live misfire: the switch read ON because of '*', the human clicked meaning
    // "enable", and the old client-side code deleted them
    expect(applyShare(['*'], ALL, 'u-george', 'u-bob', true)).toEqual(['*']);
  });
  it('lending to everyone collapses back to "*" so the next joiner is covered', () => {
    expect(applyShare(['u-bob'], ALL, 'u-george', 'u-carol', true)).toEqual(['*']);
  });
  it('an empty grant stays empty; revoking someone absent changes nothing', () => {
    expect(applyShare([], ALL, 'u-george', 'u-bob', false)).toEqual([]);
    expect(applyShare(['u-bob'], ALL, 'u-george', 'u-carol', false)).toEqual(['u-bob']);
  });
});

describe('nobodyCanServe — so a request is never dropped in silence', () => {
  it('true when the origin has no capable machine and nobody lent them one', () => {
    const mine = mach({ machineId: 'm-g', ownerUserId: GEORGE, runtimes: [], sharesWith: [] });
    const theirs = mach({ machineId: 'm-b', ownerUserId: BOB, sharesWith: [] });
    expect(nobodyCanServe([mine, theirs], 'claude-code', GEORGE, NOW)).toBe(true);
  });
  it('false the moment one is lent, or the origin can serve itself', () => {
    const mine = mach({ machineId: 'm-g', ownerUserId: GEORGE, runtimes: [], sharesWith: [] });
    const lent = mach({ machineId: 'm-b', ownerUserId: BOB, sharesWith: [GEORGE] });
    expect(nobodyCanServe([mine, lent], 'claude-code', GEORGE, NOW)).toBe(false);
    expect(nobodyCanServe([mach({ machineId: 'm-g', ownerUserId: GEORGE })], 'claude-code', GEORGE, NOW)).toBe(false);
  });
  it('an offline lender cannot serve', () => {
    const asleep = mach({ machineId: 'm-b', ownerUserId: BOB, sharesWith: [GEORGE], lastSeenAt: stale });
    expect(nobodyCanServe([asleep], 'claude-code', GEORGE, NOW)).toBe(true);
  });
});

describe('hostSpeaksForOrigin — who says "nobody can", so the request never vanishes', () => {
  it("the origin's own machine always speaks", () => {
    expect(hostSpeaksForOrigin([], GEORGE, GEORGE, 'local', NOW)).toBe(true);
    expect(hostSpeaksForOrigin([], GEORGE, GEORGE, 'member', NOW)).toBe(true);
  });
  it('a runner speaks only when the origin has no awake machine of their own', () => {
    const runnerOwner = 'u-workspace';
    // the local fleet harness (2026-09-19): the runner was the only host and stayed silent, so a
    // human sat on "thinking…" forever
    expect(hostSpeaksForOrigin([], GEORGE, runnerOwner, 'runner', NOW)).toBe(true);
    const georgeAsleep = mach({ machineId: 'm-g', ownerUserId: GEORGE, lastSeenAt: stale });
    expect(hostSpeaksForOrigin([georgeAsleep], GEORGE, runnerOwner, 'runner', NOW)).toBe(true);
    const georgeAwake = mach({ machineId: 'm-g', ownerUserId: GEORGE, runtimes: [] });
    expect(hostSpeaksForOrigin([georgeAwake], GEORGE, runnerOwner, 'runner', NOW)).toBe(false);
  });
  it("another member's laptop never speaks, and nobody speaks for no origin", () => {
    expect(hostSpeaksForOrigin([], GEORGE, BOB, 'local', NOW)).toBe(false);
    expect(hostSpeaksForOrigin([], GEORGE, BOB, 'member', NOW)).toBe(false);
    expect(hostSpeaksForOrigin([], null, GEORGE, 'runner', NOW)).toBe(false);
  });
});

// THE HOUSE BRAIN NEEDS NO RUNTIME (2026-08-29, reported live).
//
// Its turns go through control-api's metered proxy — the platform holds the key and no CLI is
// installed anywhere — so gating it on `machine.runtimes` asks for something that by design is
// never present. A cloud workspace running entirely on the starter brain showed its runner
// serving "0 of 7 agents", and every agent reading "no machine you can use serves gemini", about
// a machine that could serve all seven.
describe('the house brain is servable by any awake machine', () => {
  // a cloud runner with NOTHING installed — the real shape: agent_host runtimes=none
  const bareRunner = mach({ machineId: 'm-runner', ownerUserId: GEORGE, runtimes: [] });

  it('places a house-brain agent on a machine with no runtimes at all', () => {
    const p = placementFor({ id: 'a-rex', runtime: 'gemini', model: STARTER_MODEL }, null, [bareRunner], GEORGE, NOW);
    expect(p.machineId).toBe('m-runner');
  });

  it('and still refuses a BYO-brain agent that machine genuinely cannot serve', () => {
    // the check is not weakened for everyone — only the brain that needs no local runtime
    const p = placementFor({ id: 'a-rex', runtime: 'gemini', model: 'gemini-3.5-flash' }, null, [bareRunner], GEORGE, NOW);
    expect(p).toEqual({ machineId: null, why: 'none' });
  });

  it('an absent model is treated as BYO — the exemption is opt-in, never a default', () => {
    expect(placementFor({ id: 'a-rex', runtime: 'gemini' }, null, [bareRunner], GEORGE, NOW).machineId).toBeNull();
  });

  it('nobodyCanServe agrees, so the daemon does not refuse work the panel says is placeable', () => {
    // these two disagreeing is how an agent gets told "nobody can serve you" beside a UI that
    // names the machine that would
    expect(nobodyCanServe([bareRunner], 'gemini', GEORGE, NOW)).toBe(true);
    expect(nobodyCanServe([bareRunner], 'gemini', GEORGE, NOW, STARTER_MODEL)).toBe(false);
  });

  it('names the house brain by its id, not by its runtime', () => {
    expect(isHouseBrain(STARTER_MODEL)).toBe(true);
    expect(isHouseBrain('gemini-3.5-flash')).toBe(false);
    expect(isHouseBrain(null)).toBe(false);
    expect(isHouseBrain(undefined)).toBe(false);
  });
});

// ── the machine's derived state (cloud-cap round) ────────────────────────────────────────────
// These pin the ORDER of the rules, because the order is the design: a machine that is
// heartbeating must never read "asleep", and one scaled up but silent must stop claiming to be on
// its way once that stops being plausible. Each was a distinct situation "offline" used to cover.
import { MACHINE_WAKE_GRACE_MS, capResetLabel, capSpent, machineState, msUntilCapReset } from '../src/compute';

describe('machineState — the two axes, resolved once', () => {
  const NOW = Date.parse('2026-08-29T12:00:00Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const CAPPED = { minutes: 60, capMinutes: 60 };
  const ROOM = { minutes: 12, capMinutes: 60 };
  const CLOUD = { minutes: 900, capMinutes: null };

  it('a heartbeat beats intent — a machine answering right now is never "asleep"', () => {
    // the gap between a cap-stop landing and the pod going away: intent is already 0, but it IS up
    const s = machineState({ desiredReplicas: 0, lastSeenAt: ago(5_000) }, CAPPED, NOW);
    expect(s.status).toBe('online');
  });

  // THE WAKE THAT CANNOT HAPPEN. bumpMachineWake raises desired_replicas only on a positive
  // balance and reports nothing, so a zero-balance machine fell through to 'asleep' — whose
  // reason promises "a message wakes it", which was false, and whose thread ghost went further
  // and drew a spinner claiming it was already starting.
  it('out of credits is its OWN state, not an ordinary nap', () => {
    const s = machineState({ desiredReplicas: 0, lastSeenAt: null }, { minutes: 3, capMinutes: null, outOfCredits: true }, NOW);
    expect(s.status).toBe('no_credits');
    expect(s.reason).toMatch(/credits/i);
    // the guard is that the ASLEEP copy never leaks in here, matched on its opening rather than
    // on one clause of it, so a rewrite of the sentence cannot quietly disarm this test
    expect(s.reason).not.toMatch(/asleep until someone needs it/i);
  });

  it('a RUNNING machine is never described as out of credits — the sweep parks it, not the reader', () => {
    const s = machineState({ desiredReplicas: 1, lastSeenAt: ago(5_000) }, { minutes: 3, capMinutes: null, outOfCredits: true }, NOW);
    expect(s.status).toBe('online');
  });

  it('a positive balance leaves the ordinary asleep state alone', () => {
    const s = machineState({ desiredReplicas: 0, lastSeenAt: null }, { minutes: 3, capMinutes: null, outOfCredits: false }, NOW);
    expect(s.status).toBe('asleep');
  });

  it('scaled up and silent, inside the grace, is WAKING — the state that did not exist', () => {
    const s = machineState({ desiredReplicas: 1, lastSeenAt: null, lastWakeAt: ago(20_000) }, ROOM, NOW);
    expect(s.status).toBe('waking');
  });

  it('scaled up and silent PAST the grace is a fault, not a nap', () => {
    const s = machineState({ desiredReplicas: 1, lastSeenAt: null, lastWakeAt: ago(MACHINE_WAKE_GRACE_MS + 1_000) }, ROOM, NOW);
    expect(s.status).toBe('unreachable');
  });

  it('intent 0 with the day spent is CAPPED — the reason it will not come back on its own', () => {
    const s = machineState({ desiredReplicas: 0, lastSeenAt: ago(600_000) }, CAPPED, NOW);
    expect(s.status).toBe('capped');
    expect(s.reason).toMatch(/free machine hours/i);
  });

  it('intent 0 with room left is just asleep', () => {
    expect(machineState({ desiredReplicas: 0, lastSeenAt: ago(600_000) }, ROOM, NOW).status).toBe('asleep');
  });

  it('an uncapped (Cloud) workspace can never read capped, however many minutes it has burned', () => {
    expect(capSpent(CLOUD)).toBe(false);
    expect(machineState({ desiredReplicas: 0, lastSeenAt: ago(600_000) }, CLOUD, NOW).status).toBe('asleep');
  });

  it('destroyed outranks everything, including a stale heartbeat', () => {
    expect(machineState({ lifecycle: 'destroyed', desiredReplicas: 1, lastSeenAt: ago(1_000) }, CAPPED, NOW).status).toBe('stopped');
  });

  it('a wake with no last_wake_at is unreachable, not waking — an unknown clock is not a young one', () => {
    expect(machineState({ desiredReplicas: 1, lastSeenAt: null, lastWakeAt: null }, ROOM, NOW).status).toBe('unreachable');
  });

  it('every status carries a written reason, so no surface has to compose one', () => {
    for (const m of [
      { desiredReplicas: 0, lastSeenAt: ago(5_000) },
      { desiredReplicas: 1, lastSeenAt: null, lastWakeAt: ago(1_000) },
      { desiredReplicas: 1, lastSeenAt: null, lastWakeAt: null },
      { desiredReplicas: 0, lastSeenAt: ago(600_000) },
      { lifecycle: 'destroyed' },
    ]) expect(machineState(m, CAPPED, NOW).reason.length).toBeGreaterThan(10);
  });

  it('the reset clock is the next UTC midnight — the same day boundary machine_usage counts on', () => {
    const noon = Date.parse('2026-08-29T12:00:00Z');
    expect(msUntilCapReset(noon)).toBe(12 * 3600_000);
    const late = Date.parse('2026-08-29T23:30:00Z');
    expect(msUntilCapReset(late)).toBe(30 * 60_000);
  });
});

describe('capResetLabel — the roll-over, in the reader\'s clock', () => {
  it('agrees with the countdown instead of asking for timezone arithmetic', () => {
    // the exact confusion: the boundary is UTC midnight, but the reader lives somewhere else, so
    // the label must name the moment THEY will see on their own clock
    const now = Date.now();
    const label = capResetLabel(now);
    const at = new Date(now + msUntilCapReset(now));
    expect(label).toContain(at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    expect(label).not.toMatch(/UTC/);
  });

  it('says "tomorrow" only when the roll-over lands on the reader\'s next calendar day', () => {
    const now = Date.now();
    const at = new Date(now + msUntilCapReset(now));
    const sameDay = at.toDateString() === new Date(now).toDateString();
    expect(capResetLabel(now).startsWith('tomorrow')).toBe(!sameDay);
  });
});

// THE BUG THAT SHIPPED (George, 2026-08-29): a fresh cloud runner woke because a message asked
// for it, then refused the very work that started it. `runtimes=none` on the box, rex on the
// house brain, and shouldClaim's capability gate knew only about runtimes — so it answered
// "incapable" and the message sat unanswered while a healthy machine idled beside it.
//
// placementFor and nobodyCanServe already knew the house-brain rule. shouldClaim did not, and
// shouldClaim is the gate the wake path actually consults. These pin all three sites.
describe('shouldClaim and the house brain', () => {
  const NOW = Date.parse('2026-08-29T12:00:00Z');
  const fresh = new Date(NOW - 5_000).toISOString();
  const runner = { machineId: 'runner', ownerUserId: 'u1', runtimes: [] as string[], lastSeenAt: fresh };

  it('a runtime-less machine CLAIMS house-brain work — the bug, pinned', () => {
    const v = shouldClaim({
      self: runner, machines: [runner], runtime: 'gemini', model: STARTER_MODEL,
      originUserId: 'u1', elapsedMs: 0,
    }, NOW);
    expect(v.act).toBe('claim');
  });

  it('and still refuses work that genuinely needs a runtime it does not have', () => {
    const v = shouldClaim({
      self: runner, machines: [runner], runtime: 'claude-code', model: 'claude-opus-4',
      originUserId: 'u1', elapsedMs: 0,
    }, NOW);
    expect(v).toEqual({ act: 'skip', why: 'incapable' });
  });

  it('no model given still means "needs the runtime" — the rule is opt-in, never a loophole', () => {
    const v = shouldClaim({ self: runner, machines: [runner], runtime: 'gemini', originUserId: 'u1', elapsedMs: 0 }, NOW);
    expect(v).toEqual({ act: 'skip', why: 'incapable' });
  });

  it('the origin-can-serve rung uses the same rule, so a house brain does not wait on a peer', () => {
    // the origin owns a runtime-less machine; for house-brain work it COUNTS as able to serve,
    // so another member's box defers to it rather than grabbing the work
    const peer = { machineId: 'peer', ownerUserId: 'u2', runtimes: ['gemini'], lastSeenAt: fresh };
    const v = shouldClaim({
      self: { ...peer, machineId: 'peer' }, machines: [runner, peer], runtime: 'gemini',
      model: STARTER_MODEL, originUserId: 'u1', elapsedMs: 0, requireGrant: false,
    }, NOW);
    expect(v.act).toBe('wait');
  });
});

// THE SLEEPER RUNG (member-machines round): which asleep cloud machines may be woken for work
describe('wakeCandidates — the sleeper rung', () => {
  const cloud = (over: Partial<MachineCapability> & { machineId: string; ownerUserId: string }): MachineCapability =>
    mach({ kind: 'member', lastSeenAt: stale, ...over });

  it('names the origin\'s own sleeping cloud machine first, then one lent to them; never a laptop, never an awake one', () => {
    const own = cloud({ machineId: 'c-george', ownerUserId: GEORGE, sharesWith: [] });
    const lentToGeorge = cloud({ machineId: 'c-bob', ownerUserId: BOB, sharesWith: [GEORGE] });
    const laptop = mach({ machineId: 'm-laptop', ownerUserId: GEORGE, kind: 'local', lastSeenAt: stale });
    const awake = cloud({ machineId: 'c-awake', ownerUserId: BOB, lastSeenAt: fresh });
    const out = wakeCandidates({ machines: [lentToGeorge, laptop, awake, own], runtime: 'claude-code', originUserId: GEORGE }, NOW);
    expect(out.map((m) => m.machineId)).toEqual(['c-george', 'c-bob']);
  });

  it('for unattributed work only a machine lent to the whole workspace — or the runner — qualifies', () => {
    const narrow = cloud({ machineId: 'c-narrow', ownerUserId: BOB, sharesWith: [GEORGE] });
    const wide = cloud({ machineId: 'c-wide', ownerUserId: BOB, sharesWith: ['*'] });
    const runner = cloud({ machineId: 'c-runner', ownerUserId: 'u-owner', kind: 'runner', sharesWith: [] });
    expect(wakeCandidates({ machines: [narrow, wide, runner], runtime: 'claude-code', originUserId: null }, NOW).map((m) => m.machineId).sort()).toEqual(['c-runner', 'c-wide']);
  });

  it('capability is the published runtimes; the house brain needs none', () => {
    const codexOnly = cloud({ machineId: 'c-codex', ownerUserId: BOB, runtimes: ['codex'], sharesWith: ['*'] });
    expect(wakeCandidates({ machines: [codexOnly], runtime: 'claude-code', originUserId: GEORGE }, NOW)).toEqual([]);
    expect(wakeCandidates({ machines: [codexOnly], runtime: 'codex', originUserId: GEORGE }, NOW).map((m) => m.machineId)).toEqual(['c-codex']);
    const bare = cloud({ machineId: 'c-bare', ownerUserId: BOB, runtimes: [], sharesWith: ['*'] });
    expect(wakeCandidates({ machines: [bare], runtime: 'gemini', model: 'gemini-3.5-flash-lite', originUserId: GEORGE }, NOW).map((m) => m.machineId)).toEqual(['c-bare']);
  });
});


// THE CARD THAT CONTRADICTED ITSELF (George, 2026-09-06: the machine card read "seen now" on its
// facts line and "The machine does not answer." on its reason line, at the same moment). The two
// halves read two clocks: the reason came from a snapshot polled every 60s, the fact from the live
// replica row. Rule 2 says online beats intent, and it can only obey that with the newest evidence
// the screen holds.
describe('the freshest heartbeat', () => {
  const older = '2026-09-06T21:00:00.000Z';
  const newer = '2026-09-06T21:02:00.000Z';

  it('picks the later of the two', () => {
    expect(newestSeen(older, newer)).toBe(newer);
    expect(newestSeen(newer, older)).toBe(newer);
  });

  it('takes whichever one exists', () => {
    expect(newestSeen(null, newer)).toBe(newer);
    expect(newestSeen(newer, undefined)).toBe(newer);
    expect(newestSeen(null, null)).toBeNull();
  });

  it('ignores a value it cannot read', () => {
    expect(newestSeen('not a date', newer)).toBe(newer);
    expect(newestSeen(newer, 'not a date')).toBe(newer);
  });

  it('turns "seen now, does not answer" into online', () => {
    const now = Date.parse('2026-09-06T21:02:10.000Z');
    const polled = { desiredReplicas: 1, lastSeenAt: '2026-09-06T20:58:00.000Z', lastWakeAt: '2026-09-06T20:50:00.000Z', lifecycle: 'running' };
    expect(machineState(polled, null, now).status).toBe('unreachable');
    expect(machineState({ ...polled, lastSeenAt: newestSeen(polled.lastSeenAt, '2026-09-06T21:02:00.000Z') }, null, now).status).toBe('online');
  });
});
