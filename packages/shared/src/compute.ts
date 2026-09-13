// Shared compute (0114): a workspace's agents are workspace-level resources, but they RUN on
// members' own machines, under each member's own subscription or key. That is the point of
// having more than one person in a workspace.
//
// Until now `agents.machine_id` pinned every agent to exactly one laptop: a teammate could see
// rex in the roster while every request they made was served by the owner's machine, and went
// unanswered when that machine slept. The pin was only ever a client-side assumption — the
// server has always tolerated competing daemons (task.claim is `for update` + state-guarded, and
// migration 0060's unique index exists precisely because "a human message that wakes an agent can
// be observed by MORE THAN ONE live daemon").
//
// What was missing is a POLICY. Left as a pure race, three member machines would each spin a
// model on the same chat message and throw two answers away. The rule below is origin-affinity
// with capability failover: the machine the work came from gets first refusal, and other machines
// step in only when it cannot serve.

/** What a host can actually run, published on its `machines` row and refreshed by the heartbeat.
 *  A machine with no Claude login and no key cannot serve a claude-code agent, and must not
 *  claim work it would only fail — so capability has to be visible ACROSS machines, not just
 *  probed locally. */
import { STARTER_MODEL } from './rates';

export interface MachineCapability {
  machineId: string;
  /** the member whose machine this is (`machines.owner_user_id`) */
  ownerUserId: string;
  /** runtimes this host can serve right now — a login present, or a key available */
  runtimes: readonly string[];
  /** last heartbeat; a machine that stopped beating cannot be waited for */
  lastSeenAt: string | null;
  /** CONSENT (0119): the members this machine's OWNER lends it to — `workspace_members.compute.shares`
   *  on the owner's row, joined on at read time. `['*']` = everyone in the workspace. Absent/empty
   *  means the owner lends to nobody, and only they can run on it. */
  sharesWith?: readonly string[];
  /** `machines.kind` — 'local' (a laptop) · 'member' · 'runner' (cloud). A cloud machine can be
   *  WOKEN; a laptop cannot. Absent on rows read before the column existed: treated as local. */
  kind?: string;
}

/** May `userId` run work on this machine? Your own is always yours; anyone else's needs a grant
 *  from its owner. This is the whole consent rule, and every gate below calls exactly this. */
export function machineAvailableTo(m: MachineCapability, userId: string | null): boolean {
  if (!userId) return false;                       // unattributed work has nobody's grants to read
  if (m.ownerUserId === userId) return true;       // mine
  const shares = m.sharesWith ?? [];
  return shares.includes('*') || shares.includes(userId);
}

/** Every machine `userId` may reach — the Compute panel's "available to you", and the set every
 *  routing rung below rung 1 is allowed to choose from. */
export function availableMachines(machines: readonly MachineCapability[], userId: string | null): MachineCapability[] {
  return machines.filter((m) => machineAvailableTo(m, userId));
}

/** A member's compute choice (0118, `workspace_members.compute`): where THEIR requests run.
 *  `machine` is the default for new conversations; `agents` overrides it per agent. Both are
 *  advisory routing the daemons read — the wake lease stays the enforcement. */
export interface ComputePrefs {
  machine?: string | null;
  agents?: Record<string, string>;
  /** WHERE SESSIONS STARTED ON THIS MEMBER'S DESKTOP RUN (docs/design/desktop-code-bridge-2026-09,
   *  rule D9): 'here' designates the Mac they were started on at birth; 'auto' (the default) lets
   *  the ladder prefer a cloud machine when one is awake, else that Mac. Desktop-only to set; the
   *  browser never reads it, because a web-born session is never "here". */
  desktopSessions?: 'here' | 'auto';
  /** CONSENT (0119): the members THIS member lends their own machines to. `['*']` = the whole
   *  workspace. Lives on the lender's row because the grant is theirs to give and to revoke. */
  shares?: string[];
}

export interface ClaimContext {
  /** this host */
  self: MachineCapability;
  /** every machine registered to the workspace, including self */
  machines: readonly MachineCapability[];
  /** the runtime the agent needs (claude-code / codex / agy …) */
  runtime: string;
  /** WORK THAT RUNS NO MODEL TURN (the card's draw button — `genImageItemId`). It needs an image
   *  credential, which is a workspace fact, not a CLI on the box, so the runtime rung must not
   *  gate it. Absent/false = a normal wake, which needs its runtime. */
  modelFree?: boolean;
  /** the agent's MODEL, and it is load-bearing: a house-brain agent runs through the metered
   *  starter proxy, so it needs no local runtime at all. Omitting it here is what made a cloud
   *  runner with `runtimes=none` refuse every house-brain wake — see runtimeOk below. */
  model?: string | null;
  /** the member the work came FROM: the human who sent the message, or asked for the task.
   *  null when nothing human triggered it (a sweep, a schedule) — then there is no origin to
   *  prefer and any capable machine may serve. */
  originUserId: string | null;
  /** ms since the work became claimable — drives the deferral window for non-origin hosts */
  elapsedMs: number;
  /** how long a non-origin host waits before stepping in. Long enough that a healthy origin
   *  machine always wins the common case; short enough that a wedged one is not a hang. */
  graceMs?: number;
  /** the agent being woken — the key into the origin member's per-agent choices */
  agentId?: string;
  /** the ORIGIN member's compute choice; null/absent = unset (origin affinity as before) */
  prefs?: ComputePrefs | null;
  /** When true (the default), rungs 2/3 and failover may only choose machines the origin member
   *  has been GRANTED (0119). Set false only to reproduce pre-consent behaviour in a test. */
  requireGrant?: boolean;
  /** continuity (George, 2026-08-12): the machine that last served this thread/task. Its files,
   *  worktrees and step logs live there, so it outranks every preference — prefs move NEW
   *  conversations, never running ones. null = fresh thread / channel-feed wake. */
  priorMachineId?: string | null;
  /** THE SESSION'S OWN DESIGNATION (rule D9, 2026-09-04): `threads.machine_id` — the composer's
   *  machine chip, or the desktop-only default that sends a session started on a Mac to that Mac.
   *  Read after continuity and before every preference: a person named a machine for this one
   *  session, and that beats their standing choices. null = none. */
  threadMachineId?: string | null;
  /** which client bore the session (`threads.origin`). Known origins prefer a CLOUD machine when
   *  one is awake — web- and routine-born sessions always, desktop-born ones on Auto — and fall
   *  through to the rungs below otherwise. null = born before the column: today's ladder. */
  origin?: SessionOrigin | null;
}

export type SessionOrigin = 'desktop' | 'web' | 'routine';

export type ClaimVerdict =
  /** claim it now */
  | { act: 'claim'; why: 'origin' | 'no-origin-host' | 'grace-elapsed' | 'unattributed' | 'designated' | 'cloud' }
  /** not mine to run, ever */
  | { act: 'skip'; why: 'incapable' | 'not-granted' }
  /** a better-placed machine could still take it — check back after the grace window */
  | { act: 'wait'; why: 'origin-may-serve' | 'designated-may-serve' | 'cloud-may-serve'; retryInMs: number };

export const DEFAULT_GRACE_MS = 8_000;
/** a machine is a live candidate only while its heartbeat is fresh (machine.heartbeat is 30s) */
export const MACHINE_ONLINE_MS = 90_000;

export function machineOnline(m: MachineCapability, now: number): boolean {
  return !!m.lastSeenAt && now - new Date(m.lastSeenAt).getTime() < MACHINE_ONLINE_MS;
}

/**
 * Should THIS host claim this unit of work?
 *
 * The order matters and each rule earns its place:
 *   1. incapable → never. Claiming work you cannot run converts a slow answer into a failed one,
 *      and the claim is what stops anyone else from trying.
 *   2. I am an origin machine → claim immediately. The member who asked has their own keys and
 *      their own machine right there; that is the whole "shared compute" promise, and it keeps
 *      billing where the request came from.
 *   3. no origin machine is online AND capable → claim immediately. This is the failover: waiting
 *      out a grace window for a laptop that is closed (or that lacks the runtime) is pure latency.
 *   4. otherwise → wait. An origin machine can serve and has not yet; stepping in now would race
 *      it and, on a chat wake, burn a second model turn for an answer we would throw away.
 *
 * `now` is injected so this stays pure and testable.
 */
/**
 * CAN THIS MACHINE RUN THIS AGENT AT ALL?
 *
 * The house brain is served by the metered starter proxy rather than by a CLI on the box, so a
 * machine with no runtimes installed can still run it. Everything else needs the runtime present.
 *
 * This exists as ONE predicate because the rule was previously written into `placementFor` and
 * `nobodyCanServe` but NOT into shouldClaim, and shouldClaim is the gate the wake path actually
 * consults. The result: a fresh cloud runner (`runtimes=none`) woke, evaluated a house-brain
 * agent, decided "this machine cannot serve gemini", and skipped — so the message that started
 * the machine was never answered by it (George, 2026-08-29). Two gates, one taught.
 *
 * `modelFree` is the same lesson a second time (George, 2026-09-05): the calendar's draw button
 * runs NO model turn — it needs an image credential, a workspace fact — yet the gate asked the
 * runtime question anyway, so a cloud machine with no CLI skipped every draw the browser asked
 * for and the card sat on "still drawing" with no error, because the machine could not even
 * post one. Ask what the WORK needs, not what the agent usually needs.
 */
const runtimeOk = (m: MachineCapability, ctx: Pick<ClaimContext, 'runtime' | 'model' | 'modelFree'>): boolean =>
  ctx.modelFree === true || isHouseBrain(ctx.model) || m.runtimes.includes(ctx.runtime);

export function shouldClaim(ctx: ClaimContext, now: number): ClaimVerdict {
  const grace = ctx.graceMs ?? DEFAULT_GRACE_MS;

  // 1 — capability, always first
  if (!runtimeOk(ctx.self, ctx)) return { act: 'skip', why: 'incapable' };

  // 2 — designation: the ladder above origin affinity (0118). Continuity outranks preference —
  // an existing thread's files live on the machine that served it — and preference only speaks
  // for the member the work came from. A rung whose machine is offline or incapable simply does
  // not designate: prefs can slow a request, never strand it.
  const designated = designatedMachine(ctx, now);
  if (designated) {
    if (designated === ctx.self.machineId) return { act: 'claim', why: 'designated' };
    if (ctx.elapsedMs < grace) return { act: 'wait', why: 'designated-may-serve', retryInMs: Math.max(250, grace - ctx.elapsedMs) };
    // the window elapsed and the designated machine never took it: FALL THROUGH. Who steps in is
    // the lower rungs' call — the origin's own machine at once, a stranger only with a grant
    // (0119). Returning a claim here let an UNGRANTED machine step in after the grace window,
    // the one place the consent rule was not in the path (found writing 2b, 2026-09-04).
  }

  // 2b — THE ORIGIN RUNG (rule D9, George, 2026-09-04): a session whose origin is known prefers a
  // CLOUD machine when one is awake — the member's own member machine, else the workspace runner.
  // Web- and routine-born sessions always; desktop-born ones on Auto (with the desktop default on
  // "here", the session was designated to that Mac at birth and never reaches this rung). A laptop
  // that is not the cloud machine waits the grace window, exactly as it does for a designation, so
  // a sleeping or wedged cloud machine is a delay and never a black hole. A thread born before the
  // column has no origin and keeps today's ladder.
  else if (ctx.origin) {
    const cloud = liveCloudMachine(ctx.machines, ctx.originUserId, ctx, now);
    if (cloud) {
      if (cloud === ctx.self.machineId) return { act: 'claim', why: 'cloud' };
      if (ctx.elapsedMs < grace) return { act: 'wait', why: 'cloud-may-serve', retryInMs: Math.max(250, grace - ctx.elapsedMs) };
      // same fall-through as rung 2: after the window the lower rungs decide, consent included
    }
  }

  // nothing human triggered this (sweep, schedule): no origin to defer to
  if (!ctx.originUserId) return { act: 'claim', why: 'unattributed' };

  // 3 — I am the origin. Never needs a grant: it is this member's own machine.
  if (ctx.self.ownerUserId === ctx.originUserId) return { act: 'claim', why: 'origin' };

  // CONSENT (0119): from here down this host would be serving SOMEONE ELSE's request on its
  // owner's subscription. Without a grant it stays out — even when it is the only machine awake,
  // because "the only one awake" is not consent.
  if (ctx.requireGrant !== false && !machineAvailableTo(ctx.self, ctx.originUserId)) {
    return { act: 'skip', why: 'not-granted' };
  }

  // 4 — is any OTHER machine both the origin's and able to serve this runtime?
  const originCanServe = ctx.machines.some((m) => (
    m.ownerUserId === ctx.originUserId
    && runtimeOk(m, ctx)
    && machineOnline(m, now)
  ));
  if (!originCanServe) return { act: 'claim', why: 'no-origin-host' };

  // 5 — it can serve; give it the window before anyone else steps in
  if (ctx.elapsedMs >= grace) return { act: 'claim', why: 'grace-elapsed' };
  return { act: 'wait', why: 'origin-may-serve', retryInMs: Math.max(250, grace - ctx.elapsedMs) };
}

/** The machine this work is DESIGNATED to, or null when no rung names a live, capable one:
 *  the thread's prior machine → the origin member's per-agent choice → their default. */
function designatedMachine(ctx: ClaimContext, now: number): string | null {
  const gated = ctx.requireGrant !== false;
  const live = (id: string | null | undefined, needsGrant: boolean): string | null => {
    if (!id) return null;
    const m = ctx.machines.find((x) => x.machineId === id);
    if (!m || !runtimeOk(m, ctx) || !machineOnline(m, now)) return null;
    // CONSENT (0119): a preference may only name a machine its owner lends you. An ungranted
    // pick does not designate — it falls through to origin affinity rather than erroring, so a
    // revoked grant degrades to "runs on your own machine" instead of breaking the request.
    if (needsGrant && gated && !machineAvailableTo(m, ctx.originUserId)) return null;
    return id;
  };
  // continuity is DELIBERATELY ungated: the thread's files, worktrees and step logs are already
  // on that machine and it already served this work. Revoking a grant stops NEW conversations
  // (and the revoke confirm says so, and offers to move the existing ones).
  return live(ctx.priorMachineId, false)
    // the session's own designation needs the origin member's grant on that machine, like every
    // preference; an unattributed session (a routine) may name any machine in the workspace
    ?? live(ctx.threadMachineId, !!ctx.originUserId)
    // prefs are the ORIGIN member's; unattributed work has nobody's prefs to read
    ?? (ctx.originUserId ? live(ctx.agentId ? ctx.prefs?.agents?.[ctx.agentId] : null, true) ?? live(ctx.prefs?.machine, true) : null);
}

/** the cloud machine a session with a known origin prefers: the member's own live member machine
 *  when they have one, else a live workspace runner. Capability and the online window apply, and
 *  a member machine must be the origin member's own (it is never lent). null = none awake. */
export function liveCloudMachine(
  machines: readonly MachineCapability[],
  originUserId: string | null,
  need: Pick<ClaimContext, 'runtime' | 'model' | 'modelFree'>,
  now: number,
): string | null {
  const ok = (m: MachineCapability): boolean => runtimeOk(m, need) && machineOnline(m, now);
  const mine = originUserId ? machines.find((m) => m.kind === 'member' && m.ownerUserId === originUserId && ok(m)) : undefined;
  if (mine) return mine.machineId;
  const runner = machines.find((m) => m.kind === 'runner' && ok(m));
  return runner?.machineId ?? null;
}

/** Where a NEW conversation with this agent would run for this member — the Compute panel's
 *  "runs on" column. Same rungs as the claim ladder minus continuity (a new thread has none),
 *  with origin affinity resolved to the member's own machine and failover to the first capable
 *  peer. The `why` is the row's short reason. */
/** the platform-served brain: no key, no CLI, no runtime — control-api's metered proxy runs it,
 *  so any reachable awake machine can host an agent on it. */
// STARTER_MODEL is the house brain's id (rates.ts)
export const isHouseBrain = (model?: string | null): boolean => model === STARTER_MODEL;

export function placementFor(
  /** `model` matters as much as `runtime`: the HOUSE brain needs no local runtime at all. */
  agent: { id: string; runtime: string; model?: string | null },
  prefs: ComputePrefs | null | undefined,
  machines: readonly MachineCapability[],
  selfUserId: string | null,
  now: number,
  /** the session's origin, when the caller is placing a SESSION (the composer's chip) rather than
   *  reading an agent's standing placement (the Compute panel's column) — rule D9's cloud rung */
  origin: SessionOrigin | null = null,
): { machineId: string | null; why: 'agent-choice' | 'default' | 'cloud' | 'origin' | 'failover' | 'none' } {
  // "capable" now means capable AND lent to you — the column must never name a machine your
  // request would be refused by, or the panel is confidently wrong
  const reachable = availableMachines(machines, selfUserId);
  /**
   * THE HOUSE BRAIN NEEDS NO RUNTIME. Its turns go through control-api's metered proxy — the
   * platform holds the key and no CLI is installed anywhere — so requiring the machine to carry
   * a matching runtime asks for something that by design is never there.
   *
   * Left unhandled, a cloud workspace running entirely on the starter brain showed a machine
   * serving "0 of 7 agents" and every agent reading "no machine you can use serves gemini" —
   * about a runner that could serve all seven perfectly well (George, live). The runtime check
   * is about what a machine has INSTALLED; the house brain's requirement is only that some
   * machine is reachable and awake.
   */
  const servesAgent = (m: MachineCapability): boolean =>
    (isHouseBrain(agent.model) || m.runtimes.includes(agent.runtime)) && machineOnline(m, now);
  const capable = (id: string | null | undefined): boolean => {
    const m = id ? reachable.find((x) => x.machineId === id) : undefined;
    return !!m && servesAgent(m);
  };
  const byAgent = prefs?.agents?.[agent.id];
  if (capable(byAgent)) return { machineId: byAgent!, why: 'agent-choice' };
  if (capable(prefs?.machine)) return { machineId: prefs!.machine!, why: 'default' };
  if (origin) {
    const cloud = liveCloudMachine(reachable, selfUserId, { runtime: agent.runtime, model: agent.model ?? null }, now);
    if (cloud) return { machineId: cloud, why: 'cloud' };
  }
  const mine = reachable.find((m) => m.ownerUserId === selfUserId && servesAgent(m));
  if (mine) return { machineId: mine.machineId, why: 'origin' };
  const any = reachable.find((m) => servesAgent(m));
  return any ? { machineId: any.machineId, why: 'failover' } : { machineId: null, why: 'none' };
}

/**
 * Can ANY machine this member may use actually serve this runtime right now?
 *
 * The question the ladder never asked. Each host decides only about ITSELF, so when they all
 * skip — the origin's because it has no login, everyone else's because they were not lent — the
 * request lands nowhere and the human is told nothing at all (George, live 2026-08-14: "no agent
 * status streaming, and eventually no response"). The origin's own daemon is still running, so it
 * is the one host that can always speak; this is what it uses to tell "someone else has it" from
 * "nobody can".
 */
export function nobodyCanServe(
  machines: readonly MachineCapability[],
  runtime: string,
  originUserId: string | null,
  now: number,
  /** the agent's model — the house brain is servable by any awake machine (see placementFor) */
  model?: string | null,
): boolean {
  return !availableMachines(machines, originUserId)
    .some((m) => (isHouseBrain(model) || m.runtimes.includes(runtime)) && machineOnline(m, now));
}

/**
 * Apply ONE lend/revoke against the AUTHORITATIVE member set.
 *
 * `'*'` means "everyone in this workspace", so excluding one person must expand it into the
 * explicit rest. Doing that expansion on the CLIENT was the live bug: the renderer's member list
 * comes from the replica, and on a stale one the expansion silently dropped everyone it had not
 * synced — turning "stop lending to one person" into "stop lending to most of them", with nothing
 * on screen to say so. The server knows the roster; the client only states intent.
 */
export function applyShare(
  shares: readonly string[] | undefined,
  allMemberIds: readonly string[],
  selfId: string,
  member: string,
  on: boolean,
): string[] {
  const others = allMemberIds.filter((id) => id !== selfId);
  const set = new Set((shares ?? []).includes('*') ? others : (shares ?? []).filter((x) => x !== '*'));
  if (on) set.add(member); else set.delete(member);
  // collapse back to '*' so "everyone" stays true as the workspace grows, rather than freezing
  // today's roster into a list that silently excludes the next person to join
  if (others.length && others.every((id) => set.has(id))) return ['*'];
  return [...set];
}

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
export type MachineStatus = 'online' | 'waking' | 'asleep' | 'no_credits' | 'capped' | 'unreachable' | 'stopped';

/** How long a machine may be scaled-up-but-silent before that stops being "waking" and becomes a
 *  fault worth naming. A cold pod pulls an image and boots a daemon, which is tens of seconds on
 *  a good day; three minutes is generous enough that a slow start never cries wolf, and short
 *  enough that a genuinely dead machine does not sit there claiming to be on its way. */
export const MACHINE_WAKE_GRACE_MS = 180_000;

export interface MachineIntent {
  /** the fleet's intent — 1 = should be up. NOT synced to the replica; it rides /v1/machines/usage */
  desiredReplicas?: number | null;
  lastSeenAt?: string | null;
  /** when intent last moved to 1 — the clock `waking` is measured against */
  lastWakeAt?: string | null;
  /** 'destroyed' takes precedence over everything: there is no machine to have a state */
  lifecycle?: string | null;
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
 *   1. destroyed  — there is no machine; nothing else can be true of it.
 *   2. ONLINE BEATS INTENT. A heartbeat inside the window means it is up, whatever the fleet
 *      currently intends. Reading intent first would show "asleep" on a machine that is answering
 *      right now, in the gap between a cap-stop landing and the pod actually going away.
 *   3. intent=1, still inside the grace  → waking (the state that did not exist before).
 *   4. intent=1, past the grace          → unreachable. It should be up and it is not: a fault,
 *      not a nap, and the only status here that means "something is wrong".
 *   5. intent=0 and the day is spent     → capped, which is WHY it is not coming back on its own.
 *   6. intent=0 otherwise                → asleep, the ordinary resting state.
 */
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

export function machineState(m: MachineIntent, cap: MachineCap | null, now: number): MachineStateOut {
  if (m.lifecycle === 'destroyed') return { status: 'stopped', reason: 'This machine is destroyed.' };
  if (machineOnline({ lastSeenAt: m.lastSeenAt } as MachineCapability, now)) {
    return { status: 'online', reason: 'Awake and ready for your agents.' };
  }
  const wants = (m.desiredReplicas ?? 0) >= 1;
  if (wants) {
    const since = m.lastWakeAt ? now - new Date(m.lastWakeAt).getTime() : Number.POSITIVE_INFINITY;
    return since < MACHINE_WAKE_GRACE_MS
      ? { status: 'waking', reason: 'It starts now. Your agents continue their work automatically.' }
      : { status: 'unreachable', reason: 'The machine does not answer. Start it again.' };
  }
  // A WAKE THAT CANNOT HAPPEN MUST NOT LOOK LIKE ONE THAT HAS NOT HAPPENED YET. At a zero
  // balance the server leaves desired_replicas at 0 and says nothing, so every surface fell
  // through to 'asleep' and its "a message wakes it" — which is false, and the thread ghost
  // went further and claimed the machine was already starting. Checked BEFORE the asleep
  // fallback and AFTER the running states: a machine that is up stays up until the sweep
  // parks it, and describing a live machine as out of credits would be its own lie.
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
  return { status: 'asleep', reason: 'Asleep until someone needs it. A message starts it.' };
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

/**
 * THE SLEEPER RUNG (member-machines plan §4.3), the pure half. When nobody awake can serve, a
 * CLOUD machine that published this runtime while it was awake and is now asleep can be asked to
 * wake: the origin's own, one its owner lends the origin, or — for unattributed work such as a
 * routine — one lent to the whole workspace. The runner is the workspace's, so it always
 * qualifies on consent. Ordered best-first: the origin's own machine before a lent one. The
 * daemon side (host/sleepers.ts) does the asking and the remembering.
 */
export function wakeCandidates(
  ctx: Pick<ClaimContext, 'machines' | 'runtime' | 'model' | 'modelFree' | 'originUserId' | 'requireGrant'>,
  now: number,
): MachineCapability[] {
  const gated = ctx.requireGrant !== false;
  const lent = (m: MachineCapability): boolean => {
    if (m.kind === 'runner') return true;
    if (ctx.originUserId) return !gated || machineAvailableTo(m, ctx.originUserId);
    return (m.sharesWith ?? []).includes('*');
  };
  return ctx.machines
    .filter((m) => (m.kind ?? 'local') !== 'local' && !machineOnline(m, now) && runtimeOk(m, ctx as ClaimContext) && lent(m))
    .sort((a, b) => Number(b.ownerUserId === ctx.originUserId) - Number(a.ownerUserId === ctx.originUserId));
}
