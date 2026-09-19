// STARTER IS THE FALLBACK BRAIN (George, 2026-09-17: "starter should be a fallback brain that's
// available, if credit allows, to run any workflow that other roles run if the configured brain is
// unavailable, usage expired, etc; the reason verbose to the user in the thread; the decision to
// switch auto for routines and scheduled items, manual for everything else, where the user clicks a
// button to switch the brain").
//
// ONE DOOR. Every site that finds a seat unable to run — a login expired or missing, no machine
// able to serve the runtime, a usage cap — calls `starterFallback` instead of posting its own card.
// The door decides once, from the conversation that OWNS the turn:
//   · a ROUTINE's conversation re-seats the failing role on the house model by itself, records the
//     move as the thread's brain override (the same row "Use Starter here" writes, read by every
//     machine through seatFor), and says why in the thread;
//   · a HUMAN conversation says why and offers the switch as a button on the card. Nothing moves
//     until the person clicks, and the click moves THIS conversation's seat, so a pinned agent
//     moves too (docs/10 §15.1, thread > pin);
//   · on a CLOUD machine (George, 2026-09-19: "it should be the default on cloud anyways", "default
//     on web") a human conversation moves by itself too. The machine carries no vendor login by
//     design, the person is in a browser with nothing to sign in to, and a card that asks for a
//     click there asks for the only answer there is. The NeuraMesh brain is that machine's default,
//     and the switch is recorded in the thread the same way a routine's is.
// Credits gate all three: out of credits, the door says so and offers nothing it cannot deliver.
//
// Configured once at boot (agents.ts, beside the worker lane) so the flows keep their signatures.
import { AUTH_LABEL, STARTER_MODEL, authCardBlock, parseBrainOverride, runtimeForModel, type AgentRole, type BrainOverride, type NmAuth } from '@neuramesh/shared';
import type { LogFn } from '../agentlog';
import type { HostedAgent } from '../agents';
import { apiAuthHeaders } from '../apiauth';
import type { NoComputeReason } from '../computenotice';
import { providerFor, type ProviderName } from '../runtime/adapter';
import type { AuthResolution } from '../runtime/authpolicy';

export type Unavailable =
  | { kind: 'login'; provider: ProviderName; reason: 'expired' | 'missing' }
  | { kind: 'nocompute'; provider: ProviderName; reason: NoComputeReason; cloudLacksLogin?: boolean }
  | { kind: 'capped'; model: string };

/** the credential probe's verdict as a fallback trigger, or null when the seat can run */
export function unavailableOf(cred: Pick<AuthResolution, 'authMode' | 'blocked'> | null | undefined, runtime: string): Unavailable | null {
  if (process.env['NM_AGENT_MODE'] === 'echo' || !cred) return null;
  if (cred.blocked) return { kind: 'login', provider: cred.blocked.provider, reason: cred.blocked.reason === 'expired' ? 'expired' : 'missing' };
  if (cred.authMode === 'none') return { kind: 'login', provider: providerFor(runtime), reason: 'missing' };
  return null;
}

const labelOf = (u: Unavailable, runtime: string): string => AUTH_LABEL[u.kind === 'capped' ? providerFor(runtime) : u.provider] ?? runtime;

/** why the seat cannot run, said plainly (STE) */
export function whyUnavailable(u: Unavailable, runtime: string): string {
  const label = labelOf(u, runtime);
  if (u.kind === 'capped') return `The usage limit on ${u.model} is reached.`;
  const why = u.reason === 'expired'
    ? `The ${label} login on this machine expired.`
    : u.reason === 'missing' || u.kind === 'login'
      ? `This machine has no ${label} login.`
      : `No machine available to me can serve ${label}.`;
  return u.kind === 'nocompute' && u.cloudLacksLogin ? `${why} Your cloud machine has no ${label} login either.` : why;
}

export type FallbackOutcome = 'auto' | 'offer' | 'nocredits' | 'house';
/** who moved by itself: a routine's conversation, or a conversation on a cloud machine */
export type AutoOwner = 'routine' | 'conversation';

/** the sentence the thread reads — the reason first, then what happens now */
export function fallbackText(agent: { name: string; runtime: string }, u: Unavailable, outcome: FallbackOutcome, owner: AutoOwner = 'routine'): string {
  const label = labelOf(u, agent.runtime);
  const why = whyUnavailable(u, agent.runtime);
  if (outcome === 'house') return `@${agent.name} cannot run on the NeuraMesh brain now. ${why}`;
  const head = `@${agent.name} cannot run on ${label} here. ${why}`;
  if (outcome === 'auto') return `${head} This ${owner} continues on the NeuraMesh brain, on credits. Reset the brain in this conversation to go back.`;
  if (outcome === 'nocredits') return `${head} The NeuraMesh brain cannot take it either: this workspace is out of credits. Sign in to ${label} again on this machine, or add credits.`;
  return `${head} Sign in to ${label} again on this machine, or run this conversation on the NeuraMesh brain, on credits.`;
}

/** the card's payload — what the renderer's card and the docked notice read (packages/shared cards.ts) */
function cardOf(agent: HostedAgent, u: Unavailable, scope: { threadId: string } | null, starter: boolean, taskNumber?: number): NmAuth {
  return {
    provider: u.kind === 'capped' ? providerFor(agent.runtime) : u.provider,
    reason: u.kind === 'login' && u.reason === 'expired' ? 'expired' : 'unavailable',
    agent: agent.name, ...(taskNumber ? { taskNumber } : {}),
    why: whyUnavailable(u, agent.runtime), starter, ...(scope ? { scope: { ...scope, role: agent.role } } : {}),
  };
}

/** the card a human conversation gets: the reason, then the buttons (cards/AuthCard.tsx) */
export function offerCard(agent: HostedAgent, u: Unavailable, scope: { threadId: string } | null, starter: boolean, taskNumber?: number): string {
  return `${fallbackText(agent, u, starter ? 'offer' : 'nocredits')}\n\n${authCardBlock(cardOf(agent, u, scope, starter, taskNumber))}`;
}

/** the record a routine's conversation gets: the same card, marked as a switch that already happened
 *  (2026-09-17, George: "easily missed") — the docked notice reads it, the server mints no decision from it */
export function switchedCard(agent: HostedAgent, u: Unavailable, scope: { threadId: string }, taskNumber?: number, owner: AutoOwner = 'routine'): string {
  return `${fallbackText(agent, u, 'auto', owner)}\n\n${authCardBlock({ ...cardOf(agent, u, scope, true, taskNumber), switched: true })}`;
}

/** a cloud machine (runner or member): machined sets NM_MACHINE_KIND on the image, a laptop leaves it unset */
export const onCloudMachine = (): boolean => ['runner', 'member'].includes(process.env['NM_MACHINE_KIND'] ?? '');

export const reseatOnStarter = (a: HostedAgent): HostedAgent => ({ ...a, model: STARTER_MODEL, runtime: runtimeForModel(STARTER_MODEL) });

type Db = { get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined | null> };
interface Ctx { db: Db; apiUrl: string; ownerActorId: string }
let ctx: Ctx | null = null;
/** seats this host moved a moment ago (`thread:role` → when): the wake ladder's door and the wake's
 *  own door can run 40 ms apart, before the replica shows the first one's override — seen live as
 *  the reason posted twice. A seat moved within the window is taken silently, whatever the replica says. */
const moved = new Map<string, number>();
const MOVED_MEMO_MS = 60_000;
export function configureStarterFallback(c: Ctx | null): void { ctx = c; moved.clear(); }

type Row = { id: string; schedule_id: string | null; brain_override: string | null };
/** the conversation a turn belongs to: the thread itself, a task's own thread, else the conversation
 *  that owns the unit (tasks.origin_thread_id) — the same row threadBrain (host/hire.ts) reads */
export async function owningThread(db: Db, where: { threadId?: string | null; taskId?: string | null }): Promise<{ id: string; routine: boolean; override: BrainOverride | null } | null> {
  // the replica's `get` THROWS on an empty result (PowerSync), it does not return undefined — and an
  // anchored unit has no thread of its own, so the first of the two task queries is empty by design
  const one = (sql: string, params: unknown[]) => db.get<Row>(sql, params).catch(() => undefined);
  if (where.threadId) {
    const r = await one('select id, schedule_id, brain_override from threads where id = ?', [where.threadId]);
    return r ? { id: r.id, routine: !!r.schedule_id, override: parseBrainOverride(r.brain_override) } : null;
  }
  if (!where.taskId) return null;
  const own = await one('select id, schedule_id, brain_override from threads where task_id = ?', [where.taskId]);
  const origin = await one('select th.id, th.schedule_id, th.brain_override from tasks t join threads th on th.id = t.origin_thread_id where t.id = ?', [where.taskId]);
  const r = own ?? origin;
  return r ? { id: r.id, routine: !!(own?.schedule_id || origin?.schedule_id), override: parseBrainOverride(r.brain_override) } : null;
}

/** does a routine own this turn? (the capped path asks before it offers, so a human thread keeps its failover card) */
export async function routineOwned(where: { threadId?: string | null; taskId?: string | null }): Promise<boolean> {
  if (!ctx) return false;
  return (await owningThread(ctx.db, where).catch(() => null))?.routine ?? false;
}

async function creditsOk(apiUrl: string, workspace: string, ownerActorId: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/v1/usage?workspace=${encodeURIComponent(workspace)}`, { headers: await apiAuthHeaders(apiUrl, { kind: 'human', id: ownerActorId }) });
    if (!res.ok) return true; // unknown → let the proxy be the judge; its 402 reads as a refusal, not an empty turn
    const j = (await res.json()) as { credits?: { outOfCredits?: boolean } };
    return !j.credits?.outOfCredits;
  } catch { return true; }
}

/**
 * The door. Returns the agent to continue with — re-seated on the NeuraMesh brain — or null when the
 * turn must stop: the reason (and, in a human conversation, the card) has already been posted.
 */
export async function starterFallback(
  agent: HostedAgent, u: Unavailable,
  where: { workspace: string; channelId: string; threadId?: string | null; taskId?: string | null; taskNumber?: number; replyTo?: string | null },
  log?: LogFn,
): Promise<HostedAgent | null> {
  if (!ctx) return null;
  const { db, apiUrl, ownerActorId } = ctx;
  const post = async (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) =>
    fetch(`${apiUrl}${path}`, { method: 'POST', headers: await apiAuthHeaders(apiUrl, actor as never), body: JSON.stringify(body) });
  const placed = { workspace: where.workspace, channel: where.channelId, ...(where.taskId ? { taskId: where.taskId } : where.threadId ? { threadId: where.threadId } : {}) };
  // a message that ENDS the turn replies to the trigger, so it lands where the person looks and
  // holds the one-reply-per-trigger slot (0060). A message the turn CONTINUES past must not: the
  // agent's real answer replies to the same trigger next, and the slot would refuse it as a
  // duplicate — seen live, a routine's thread ending on the reason with its answer thrown away.
  const target = { ...placed, ...(where.replyTo ? { replyTo: where.replyTo } : {}) };
  const say = (body: string, ends = true) => post('/v1/messages', { kind: 'agent', id: agent.id, role: agent.role }, { ...(ends ? target : placed), body }).catch(() => {});
  if (agent.model === STARTER_MODEL) { await say(fallbackText(agent, u, 'house')); return null; }
  const thread = await owningThread(db, where).catch(() => null);
  // moved by an earlier pass (a retry, the gate ahead of the wake): take the seat, say nothing twice —
  // by the replica's word, or by this host's own memory when the replica has not caught up yet
  const key = thread ? `${thread.id}:${agent.role}` : null;
  if (thread?.override?.[agent.role as AgentRole] === STARTER_MODEL) return reseatOnStarter(agent);
  if (key && Date.now() - (moved.get(key) ?? 0) < MOVED_MEMO_MS) return reseatOnStarter(agent);
  const credits = await creditsOk(apiUrl, where.workspace, ownerActorId);
  const offer = async () => {
    await say(offerCard(agent, u, thread ? { threadId: thread.id } : null, credits, where.taskNumber));
    log?.({ kind: 'wake', phase: 'stood_down', summary: `${whyUnavailable(u, agent.runtime)} ${credits ? 'offered the NeuraMesh brain' : 'out of credits'}`, level: 'warn' });
    return null;
  };
  // a routine moves by itself, and so does any conversation on a cloud machine: the default there
  const auto = !!thread && (thread.routine || onCloudMachine());
  if (!auto || !credits) return offer();
  const owner: AutoOwner = thread.routine ? 'routine' : 'conversation';
  const override: BrainOverride = { ...(thread.override ?? {}), [agent.role]: STARTER_MODEL };
  // the routine runs as the owner already (schedules.ts posts its opener as the human), so the
  // owner's word records the move — the server keeps set_brain HUMAN_ONLY, and this is the human's rule
  const r = await post('/v1/commands', { kind: 'human', id: ownerActorId }, { type: 'thread.set_brain', workspace: where.workspace, threadId: thread.id, override }).catch(() => null);
  if (!r?.ok) return offer();
  if (key) moved.set(key, Date.now());
  // a CAP arrives after the turn already ran, and a second run for the same (agent, trigger) loses
  // the wake lease by construction (runs' partial unique index). So the reason is posted AS THE
  // OWNER — the routine speaks as the owner already — and mentions the agent: that is a fresh
  // trigger, so the normal wake path re-asks the turn on the new seat. Every other cause is found
  // before the turn, and the caller simply continues with the returned agent.
  if (u.kind === 'capped') {
    await post('/v1/messages', { kind: 'human', id: ownerActorId }, { ...placed, body: fallbackText(agent, u, 'auto', owner) }).catch(() => {});
  } else {
    // the reason, and a card that RECORDS the switch: the docked notice in the thread reads it.
    // Not a reply to the trigger — the turn continues, and its real answer is that reply.
    await say(switchedCard(agent, u, { threadId: thread.id }, where.taskNumber, owner), false);
  }
  log?.({ kind: 'wake', phase: 'channel', summary: `re-seated on the NeuraMesh brain — ${whyUnavailable(u, agent.runtime)}` });
  return reseatOnStarter(agent);
}

/** configured at boot; a host that never opened the door keeps its old notices */
export const starterDoorOpen = (): boolean => ctx !== null;

/** the member whose conversation this is — the human who opened the owning thread. A unit the
 *  orchestrator created has no human creator, but its conversation does (a routine's opener is the
 *  owner's word), and that is who the claim door speaks for. Null for a conversation nobody opened. */
export async function conversationOrigin(where: { threadId?: string | null; taskId?: string | null }): Promise<string | null> {
  if (!ctx) return null;
  const thread = await owningThread(ctx.db, where).catch(() => null);
  if (!thread) return null;
  const root = await ctx.db.get<{ author_kind: string; author_id: string | null }>(
    'select m.author_kind, m.author_id from threads th join messages m on m.id = th.root_message_id where th.id = ?', [thread.id],
  ).catch(() => null);
  return root?.author_kind === 'human' && root.author_id ? root.author_id : null;
}
