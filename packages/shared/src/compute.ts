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
import { MACHINE_ONLINE_MS } from './machine-state';

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

/** a session started on the web, on the phone (web-born by construction) or by a routine: it runs
 *  on the cloud (rung 0 of shouldClaim). A desktop-born session keeps the member's own defaults. */
export const isCloudBorn = (origin: SessionOrigin | null | undefined): boolean => origin === 'web' || origin === 'routine';

export type ClaimVerdict =
  /** claim it now */
  | { act: 'claim'; why: 'origin' | 'no-origin-host' | 'grace-elapsed' | 'unattributed' | 'designated' | 'cloud' }
  /** not mine to run, ever */
  | { act: 'skip'; why: 'incapable' | 'not-granted' }
  /** a better-placed machine could still take it — check back after the grace window */
  | { act: 'wait'; why: 'origin-may-serve' | 'designated-may-serve' | 'cloud-may-serve'; retryInMs: number };

export const DEFAULT_GRACE_MS = 8_000;

export function machineOnline(m: MachineCapability, now: number): boolean {
  return !!m.lastSeenAt && now - new Date(m.lastSeenAt).getTime() < MACHINE_ONLINE_MS;
}

/**
 * Should THIS host claim this unit of work?
 *
 * The order matters and each rule earns its place:
 *   0. a cloud-born session (web, phone, routine) → the cloud machine, capability unasked: a brain
 *      it lacks is re-seated on the NeuraMesh brain by the wake's own door, in the thread.
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
export const runtimeOk = (m: MachineCapability, ctx: Pick<ClaimContext, 'runtime' | 'model' | 'modelFree'>): boolean =>
  ctx.modelFree === true || isHouseBrain(ctx.model) || m.runtimes.includes(ctx.runtime);

export function shouldClaim(ctx: ClaimContext, now: number): ClaimVerdict {
  const grace = ctx.graceMs ?? DEFAULT_GRACE_MS;

  // 0 — CLOUD-BORN SESSIONS RUN ON THE CLOUD (George, 2026-09-19: "all queries / routines started on
  // the web or mobile should always run on the cloud machine; if their configured brain isn't
  // available, it should use the neuramesh brain with credits; brain availability across their
  // devices shouldn't be what decides where a thread runs"). The capability question is NOT asked
  // of the cloud machine: a brain it lacks is the wake's own door's to handle (host/starterfallback
  // .ts re-seats the conversation on the NeuraMesh brain and says so in the thread). Before this
  // rung, capability came first: the runner asked "can I serve claude-code?", skipped, and the
  // member's laptop took a web session on whatever build it ran — and the laptop, asking the same
  // question about the runner, never saw it as a candidate at all. A laptop that is not the cloud
  // machine waits the window; no cloud machine awake, or one that never claimed inside it, and the
  // rungs below decide, as they do for a wedged designation — a delay, never a black hole.
  const cloudBorn = isCloudBorn(ctx.origin) ? cloudMachineForSession(ctx, now) : null;
  if (cloudBorn === ctx.self.machineId) return { act: 'claim', why: 'cloud' };
  if (cloudBorn && ctx.elapsedMs < grace) return { act: 'wait', why: 'cloud-may-serve', retryInMs: Math.max(250, grace - ctx.elapsedMs) };

  // 1 — capability, always first for everything else
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
 *  when they have one, else a live workspace runner. The online window applies, and a member
 *  machine must be the origin member's own (it is never lent). Capability applies when `need` is
 *  given; `null` asks none, for a cloud-born session (its door re-seats). null = none awake. */
export function liveCloudMachine(
  machines: readonly MachineCapability[],
  originUserId: string | null,
  need: Pick<ClaimContext, 'runtime' | 'model' | 'modelFree'> | null,
  now: number,
): string | null {
  const ok = (m: MachineCapability): boolean => (need === null || runtimeOk(m, need)) && machineOnline(m, now);
  const mine = originUserId ? machines.find((m) => m.kind === 'member' && m.ownerUserId === originUserId && ok(m)) : undefined;
  if (mine) return mine.machineId;
  const runner = machines.find((m) => m.kind === 'runner' && ok(m));
  return runner?.machineId ?? null;
}

/** The cloud machine a CLOUD-BORN session runs on (rung 0), capability unasked. The chip's pick of
 *  a laptop is a designation for rung 2, so the rung stands aside; among cloud machines,
 *  continuity keeps a thread where its files are (a Code session's worktree), then the chip's
 *  pick (the runner is everyone's; a member machine is its owner's, or anyone's for a routine),
 *  then the member's own live member machine, else the live runner. */
function cloudMachineForSession(ctx: ClaimContext, now: number): string | null {
  const find = (id: string | null | undefined): MachineCapability | undefined => (id ? ctx.machines.find((m) => m.machineId === id) : undefined);
  const cloud = (m: MachineCapability | undefined): m is MachineCapability => !!m && (m.kind ?? 'local') !== 'local' && machineOnline(m, now);
  const named = find(ctx.threadMachineId);
  if (named && (named.kind ?? 'local') === 'local') return null;
  const prior = find(ctx.priorMachineId);
  if (cloud(prior)) return prior.machineId;
  if (cloud(named) && (named.kind === 'runner' || !ctx.originUserId || named.ownerUserId === ctx.originUserId)) return named.machineId;
  return liveCloudMachine(ctx.machines, ctx.originUserId, null, now);
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
    // a cloud-born session's cloud machine needs no capability (rung 0: its door re-seats)
    const cloud = liveCloudMachine(reachable, selfUserId, isCloudBorn(origin) ? null : { runtime: agent.runtime, model: agent.model ?? null }, now);
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

// THE MACHINE'S STATE (machineState, the labels, the wait lines, the cap clock) lives in
// machine-state.ts, split out for the size cap. It is re-exported here, so every import stays.
export * from './machine-state';
