// Split from compute.ts for the size cap (2026-11-06). compute.ts re-exports all of it. This file
// imports nothing from compute.ts, so the two never form an import cycle.

/** a machine is a live candidate only while its heartbeat is fresh (machine.heartbeat is 30s) */
export const MACHINE_ONLINE_MS = 90_000;

// ── THE MACHINE'S STATE, DERIVED ONCE (cloud-cap round, 2026-08-29) ──────────────────────────
//
// A machine has TWO independent axes and the UI rendered only one of them:
//
//   intent   — `desired_replicas` (0|1): should it be running. Moved by the message path's wake
//              bump, and by the sweep's cap-stop / idle-stop.
//   liveness — `last_seen_at`: is its daemon actually heartbeating right now.
//
// Everything read liveness alone, so the single word "offline" covered five different
// situations: asleep on purpose, waking right now, refused because the free day is spent,
// crashed, and never provisioned. A person looking at a machine that is deliberately asleep and
// a person looking at one that died see the same word — and the second one is the only one worth
// interrupting anybody about.
//
// So the state is derived HERE, once, and every surface renders the result: the compute pill, the
// Compute row, the thread's gate card, the attention bar. A surface that derives its own version
// is how two of them come to disagree.
export type MachineStatus = 'online' | 'waking' | 'asleep' | 'sleeping' | 'held' | 'no_credits' | 'capped' | 'unreachable' | 'stopped';

/** How long a machine may be scaled-up-but-silent before that stops being "waking" and becomes a
 *  fault worth naming. A cold pod pulls an image and boots a daemon, which is tens of seconds on
 *  a good day; three minutes is generous enough that a slow start never cries wolf, and short
 *  enough that a genuinely dead machine does not sit there claiming to be on its way. */
export const MACHINE_WAKE_GRACE_MS = 180_000;

export interface MachineIntent {
  /** Explicit startup gate for newer Cloud Run daemons; null/absent keeps legacy compatibility. */
  interactiveReady?: boolean | null;
  /** the fleet's intent — 1 = should be up. NOT synced to the replica; it rides /v1/machines/usage */
  desiredReplicas?: number | null;
  lastSeenAt?: string | null;
  /** when intent last moved to 1 — the clock `waking` is measured against */
  lastWakeAt?: string | null;
  /** 'destroyed' takes precedence over everything: there is no machine to have a state */
  lifecycle?: string | null;
  /** when this run of the machine started (null while stopped). A heartbeat from BEFORE it belongs
   *  to an earlier run, so it cannot make this run online (the prewake moves it, not last_wake_at) */
  startedAt?: string | null;
  /** a Cloud Run drain under way: 'requested' | 'draining' | 'resizing', and why (idle, cap, grow, roll, ...) */
  drainState?: string | null;
  drainReason?: string | null;
  /** the crash-loop breaker tripped: the machine stays asleep until a person's message */
  bootLoopAt?: string | null;
  /** when the last stop parked it (Cloud Run): the "asleep since" time */
  parkedAt?: string | null;
}

/** today's meter for the workspace this machine belongs to. `capMinutes` null = uncapped (Cloud). */
export interface MachineCap {
  minutes: number;
  capMinutes: number | null;
  /** the workspace cannot pay for compute. THE ONLY THING THAT STOPS A WAKE now (bumpMachineWake
   *  raises desired_replicas only on a positive balance), so a surface that does not know this
   *  will describe a machine as "asleep — a message wakes it" when no message ever will. */
  outOfCredits?: boolean;
}

export interface MachineStateOut {
  status: MachineStatus;
  /** one sentence, already written for a person — surfaces render it, they do not compose it */
  reason: string;
}

/** the cap is spent when there IS one and the meter has reached it */
export function capSpent(cap: MachineCap | null | undefined): boolean {
  return !!cap && cap.capMinutes !== null && cap.minutes >= cap.capMinutes;
}

/**
 * ORDER MATTERS, and each rule earns its place:
 *
 *   1. destroyed: there is no machine. Nothing else can be true of it.
 *   2. INTENT BEATS A HEARTBEAT. A machine the fleet stopped (desired 0) is asleep, even when its
 *      last beat is seconds old. A parked Cloud Run machine was seen just now BECAUSE it just
 *      drained, and "Awake and ready" beside a stopped machine is a lie about the bill
 *      (George, live build 25f8d8dd, 2026-11-06). Only an unknown intent (an older server, a
 *      laptop) falls back to the heartbeat alone.
 *   3. intent 1 and a stop drain under way (idle, cap)  -> sleeping: it saves its work, then stops.
 *      intent 1 and a resize or a roll                  -> waking: it restarts in a moment.
 *   4. intent 1 and a fresh beat since this run started -> online.
 *   5. intent 1, no beat since the start, in the grace  -> waking.
 *   6. intent 1 otherwise                               -> unreachable: it should be up and is not.
 *   7. intent 0: no credits, then the spent day, then the breaker, then asleep.
 */
const WAKE_GRACE = MACHINE_WAKE_GRACE_MS;
const at = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

export function machineState(m: MachineIntent, cap: MachineCap | null, now: number): MachineStateOut {
  if (m.lifecycle === 'destroyed') return { status: 'stopped', reason: 'This machine is removed.' };
  const seen = at(m.lastSeenAt);
  const fresh = !Number.isNaN(seen) && now - seen < MACHINE_ONLINE_MS;
  const ONLINE: MachineStateOut = { status: 'online', reason: 'Awake and ready for your agents. It uses credits while it is awake.' };
  if (m.desiredReplicas === undefined || m.desiredReplicas === null) {
    // no intent to read: the heartbeat is all there is (an older server, a local machine)
    if (fresh) return ONLINE;
  } else if (m.desiredReplicas >= 1) {
    const drain = m.drainState ?? null;
    if ((drain === 'requested' || drain === 'draining') && (m.drainReason === 'idle' || m.drainReason === 'cap')) {
      return { status: 'sleeping', reason: 'Going to sleep. It saves your work first. Then it uses no credits.' };
    }
    if (drain === 'requested' || drain === 'draining' || drain === 'resizing') {
      return { status: 'waking', reason: 'Restarting. It saves your work and starts again in a moment.' };
    }
    const started = at(m.startedAt);
    if (m.interactiveReady === false) {
      const clock = !Number.isNaN(started) ? started : at(m.lastWakeAt);
      return now - clock < MACHINE_WAKE_GRACE_MS
        ? { status: 'waking', reason: 'Starting your machine. Your workspace opens when it is ready.' }
        : { status: 'unreachable', reason: 'The machine is taking longer than usual to start. Your saved work is preserved. Try again shortly.' };
    }
    const seenThisRun = fresh && (Number.isNaN(started) || seen >= started);
    if (seenThisRun) return ONLINE;
    const clock = !Number.isNaN(started) ? started : at(m.lastWakeAt);
    const everSeenThisRun = !Number.isNaN(seen) && !Number.isNaN(started) && seen >= started;
    if (!everSeenThisRun && !Number.isNaN(clock) && now - clock < WAKE_GRACE) {
      return { status: 'waking', reason: 'Starting now. Your agents continue their work when it is ready. It uses credits while it is awake.' };
    }
    return everSeenThisRun
      ? { status: 'unreachable', reason: 'The machine stopped answering. Start it again.' }
      : { status: 'unreachable', reason: 'The machine does not answer. Start it again.' };
  }
  // A WAKE THAT CANNOT HAPPEN MUST NOT LOOK LIKE ONE THAT HAS NOT HAPPENED YET. At a zero
  // balance the server leaves desired_replicas at 0 and says nothing, so the asleep words
  // ("a message wakes it") would be false. A machine that is up stays up until the sweep parks it,
  // so this is checked only after the running states above.
  if (cap?.outOfCredits) {
    return {
      status: 'no_credits',
      reason: 'No credits, so this machine cannot start. Add credits and the next message starts it.',
    };
  }
  if (capSpent(cap)) {
    return {
      status: 'capped',
      reason: "Today's free machine hours are spent. It starts again after the reset, or now on the Team plan.",
    };
  }
  if (m.bootLoopAt) {
    return { status: 'held', reason: 'Paused after it failed to start several times. It uses no credits. Send a message to try again.' };
  }
  return { status: 'asleep', reason: 'Asleep. It uses no credits. A message wakes it.' };
}

/** the one word a surface shows for a status (the pill's tooltip and the Compute row) */
export const MACHINE_STATUS_LABEL: Record<MachineStatus, string> = {
  online: 'Awake', waking: 'Waking', asleep: 'Asleep', sleeping: 'Going to sleep', held: 'Paused',
  no_credits: 'No credits', capped: 'Paused for today', unreachable: 'Offline', stopped: 'Removed',
};

/** the green dot: only a machine that is awake and answering */
export const machineLit = (status: MachineStatus | null | undefined): boolean => status === 'online';

/**
 * The "when" fact beside a machine's state. A stopped machine was often seen seconds ago (it just
 * drained), so "seen just now" beside "Asleep" reads as awake. A machine that is not running says
 * when it went to sleep instead (its park, or its last beat). `ago` formats a time as "5 mins ago".
 */
export function machineSeenFact(status: MachineStatus, m: Pick<MachineIntent, 'lastSeenAt' | 'parkedAt'>, ago: (iso: string) => string): string | null {
  const resting = status === 'asleep' || status === 'held' || status === 'no_credits' || status === 'capped';
  if (resting) {
    const since = newestSeen(m.parkedAt ?? null, m.lastSeenAt ?? null);
    return since ? `went to sleep ${ago(since)}` : null;
  }
  if (status === 'stopped') return null;
  return m.lastSeenAt ? `seen ${ago(m.lastSeenAt)}` : null;
}

/** THE FRESHER HEARTBEAT WINS.
 *
 *  This store is polled every 60s. The replica's `machines.last_seen_at` is watched, so it is live.
 *  A machine that answered 20 seconds ago therefore reads "seen now" from the replica while THIS
 *  snapshot still holds the heartbeat from before it woke — and machineState, given only the stale
 *  half, called it unreachable. George's card said "seen now · The machine does not answer" at the
 *  same time, which is not a state any machine was ever in.
 *
 *  machineState's own rule 2 is "online beats intent". It can only obey that with the newest
 *  evidence the screen holds, so the screen hands it both and this picks. Same derivation, better
 *  input: nothing here forms a second opinion. */
export function newestSeen(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a ? Date.parse(a) : Number.NaN;
  const tb = b ? Date.parse(b) : Number.NaN;
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? null : (b ?? null);
  if (Number.isNaN(tb)) return a ?? null;
  return ta >= tb ? (a ?? null) : (b ?? null);
}


/**
 * WHAT A PERSON WAITING ON AN ANSWER IS TOLD ABOUT THE MACHINE.
 *
 * The desktop has said this since the cloud-cap round, in `waitghost-rule.ts`. The phone said
 * nothing, so a 146-second cold start after a send was dead air (George, 2026-09-06: "it takes a
 * while after i send a message for the agent thinking state to appear; if machine is off, it should
 * say that and stream in the status of the machine until it starts similar to how the web handles
 * this"). One machine must not get two stories, so the words live here and both clients read them.
 *
 * `online` and `capped` are deliberately absent. `online` hands over to the real agent indicator,
 * because two of them are worse than none, and `capped` has its own card that says far more.
 */
export const MACHINE_WAIT_LINE: Partial<Record<MachineStatus, string>> = {
  // THESE ARE BUSY-STATE LABELS, and CLAUDE.md #11 names that exception itself: a waiting state
  // reads as "Please wait…" or "Thinking…", present participle and ellipsis, because the shape is
  // what says "still going". A full stop closes the sentence and the reader takes it as the end of
  // the story — George read "The cloud machine starts now." beside a thread that then sat there
  // and called it wrong (2026-09-07). Progress is punctuated as progress.
  waking: 'Starting the cloud machine…',
  asleep: 'Waking the cloud machine…',
  // a stop drain under way: the message wakes it again once the drain ends (the sweep's rewake)
  sleeping: 'Waking the cloud machine…',
  // a person's message clears the breaker for one more start
  held: 'Waking the cloud machine…',
  // it should be up and it is not. Still a wait, so still an ellipsis.
  unreachable: 'Waiting for the cloud machine to answer…',
  // NOT progress, and the one here that ends in a full stop for that reason. A workspace at a zero
  // balance never raises desired_replicas, so the machine is not on its way and never will be until
  // somebody adds credits. MACHINE_WAIT_STALLED drops the orb to match.
  no_credits: 'No credits, so the cloud machine cannot start.',
};

/** the lines above that are NOT going anywhere: no spinner, and no promise of an answer on its way */
export const MACHINE_WAIT_STALLED: Partial<Record<MachineStatus, true>> = { no_credits: true };

/** the line and whether it moves, or null when the machine's state is nobody's business here */
export function machineWaitLine(status: MachineStatus | undefined | null): { line: string; stalled: boolean } | null {
  const line = status ? MACHINE_WAIT_LINE[status] : undefined;
  return line ? { line, stalled: !!(status && MACHINE_WAIT_STALLED[status]) } : null;
}

/** ms until the meter resets: the next UTC midnight after `now`. The cap is a per-UTC-day counter
 *  (machine_usage.day), so this is the one clock every "resets in…" label may read. */
export function msUntilCapReset(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

/**
 * WHEN THE FREE DAY ROLLS OVER, in the reader's own clock.
 *
 * The cap counts against `machine_usage.day`, which is a UTC date, so the reset really is UTC
 * midnight. Saying that out loud was a mistake: at 3:33pm local (UTC-7) the card read "resets at
 * midnight UTC" beside "resets in 1h 27m", and the only way to see that both were true was to do
 * timezone arithmetic in your head. George read it and reasonably concluded the timer was broken.
 *
 * The countdown was always right. What was wrong was naming the boundary in a clock the reader is
 * not living in. So the label is LOCAL: "5:00 PM" agrees with "in 1h 27m" without any arithmetic,
 * and the UTC boundary stays an implementation detail of the meter rather than something a person
 * has to translate.
 *
 * `tomorrow` is not decoration: east of UTC the roll-over lands on the reader's next calendar day,
 * and a bare "1:00 AM" would look like it had already passed.
 */
export function capResetLabel(now: number): string {
  const at = new Date(now + msUntilCapReset(now));
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return at.toDateString() === new Date(now).toDateString() ? time : `tomorrow at ${time}`;
}
