// A PERSON WRITES ONLY INTO WORKSPACES THEY BELONG TO (the Cloud Run feature suite, 2026-11-02).
// The suite's `tenancy` scenario sent commands as a signed-in stranger who knew a workspace's ids,
// and they all landed: a message, a task, a fact, a skill, a whiteboard, a routine. The token lanes
// already hold AGENT claims to their own workspace (machine-auth.ts machineMayClaim, bearer-auth.ts
// resolveBearerActor), but a HUMAN actor was never checked against the workspace a command names:
// the /v1 gate proves who you are, not where you may write. Ids are not secrets (credentials-authz.ts).
//
// EVERY ROW A COMMAND NAMES, NOT JUST ITS `workspace` (R10 lane A, 2026-11-09: NM-002, NM-004,
// NM-012). The guard used to read the command's `workspace`, else its channel's, else its task's,
// and leave everything else to "the id-only commands whose handlers resolve and check the row
// themselves" — which most of them never did. A deep review deleted another tenant's projects,
// agents, routines, skills and drafts by id alone; credential.set with the caller's OWN workspace
// and a victim's agentId swapped that agent's API key; policy.delete with a victim's policy id
// removed their guardrails. An agent claim (and so the machine lane's) skipped the check outright,
// and a database error or an empty member list let the write through. Now:
//   · every id the command carries (commandRefs below: one table, tested to cover the whole union)
//     is resolved to the workspace that owns its row (store/scope-rows.ts), and they must all agree
//     with each other and with the command's `workspace`;
//   · EVERY actor is held to that one workspace: a person must be a member of it, an agent must
//     live in it (its row says so, not its claim), and a machine token writes only inside its own;
//   · it fails CLOSED: a database error is a 503, a row that resolves nowhere is a 404, an empty
//     member list or an unknown agent is a refusal.
// The in-memory store (the single-person dev server and the unit suite, where workspaces are
// phantom strings with no rows) has no row resolver: there the guard keeps its legacy reading.
import type { Actor } from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';
import { localMode } from '../localmode';
import type { Store } from '../store';
import { UUID, looseUuid, type ScopeKind, type ScopeRef } from '../store/scope-rows';

/** commands whose actor is, by design, not a member yet (or whose workspace does not exist yet), and
 *  the exits whose own store calls already answer a non-member with NOT_FOUND (leaving twice is a
 *  clean 404, invites.pg.test.ts) */
export const OUTSIDE = new Set<Command['type']>(['workspace.create', 'workspace.accept_invite', 'workspace.decline_invite', 'account.delete', 'workspace.leave', 'workspace.delete']);

/** a command field → the kind of row its value names. Fields that name PEOPLE (member, person,
 *  forUserId, createdBy, offerTo) are not rows of a workspace: their handlers check them. */
export const FIELD_KIND: Readonly<Record<string, ScopeKind>> = {
  taskId: 'task', runTaskId: 'task', parent: 'task', task: 'task',
  channel: 'channel', channelId: 'channel', project: 'project', projectId: 'project',
  agent: 'agent', agentId: 'agent', schedule: 'schedule', scheduleId: 'schedule',
  skillId: 'skill', packId: 'skillpack', item: 'content', artifactId: 'artifact', whiteboardId: 'whiteboard',
  connector: 'connector', factId: 'fact', supersededBy: 'fact', message: 'message', triggerMessageId: 'message',
  reminder: 'reminder', runId: 'run', parentRunId: 'run', permissionRunId: 'run', decisionId: 'decision',
  policyId: 'policy', threadId: 'thread', thread: 'thread', originThread: 'thread',
  machineId: 'machine', machine: 'machine', repoId: 'repo', codeSessionId: 'code_session', invite: 'invite',
};
/** where a command type reads a field differently (null = the field is not a row id there) */
export const TYPE_FIELD_KIND: Readonly<Partial<Record<Command['type'], Readonly<Record<string, ScopeKind | null>>>>> = {
  'run.open': { id: 'run' }, // caller-minted: an id that already belongs to another workspace's run is refused
  'policy.set': { id: 'policy' }, // setPolicy upserts by id
  'schedule.create': { agent: null }, // an agent NAME, resolved in the channel's workspace at run time
  'modelpack.save': { packId: 'modelpack' },
  'modelpack.delete': { packId: 'modelpack' },
};

/** every row the command names by id, nested ones included */
export function commandRefs(cmd: Command): ScopeRef[] {
  const refs: ScopeRef[] = [];
  const add = (kind: ScopeKind, v: unknown): void => { if (typeof v === 'string' && v) refs.push({ kind, id: v }); };
  const over: Readonly<Record<string, ScopeKind | null>> = TYPE_FIELD_KIND[cmd.type] ?? {};
  const c = cmd as unknown as Record<string, unknown>;
  for (const [field, value] of Object.entries(c)) {
    if (field === 'type' || field === 'workspace') continue;
    const kind = field in over ? over[field] : FIELD_KIND[field];
    if (kind) add(kind, value);
  }
  if (Array.isArray(c['channels'])) for (const ch of c['channels']) add('channel', ch);
  const nested = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  add('repo', nested(c['repo'])['id']);
  add('repo', nested(c['releases'])['repoId']); // marketing.setup
  add('repo', nested(c['value'])['repoId']); // setup.step
  add('modelpack', c['activeModelPack']); // workspace.update
  add('modelpack', c['modelPack']); // project.update
  add('task', nested(c['codingHandoff'])['requestId']);
  add('task', nested(c['codingHandoff'])['taskId']);
  for (const [agent, machine] of Object.entries(nested(c['agents']))) { add('agent', agent); add('machine', machine); }
  if (Array.isArray(c['items'])) for (const it of c['items']) add('agent', nested(it)['agentId']);
  return refs;
}

type ScopeStore = Pick<Store, 'humanMemberIds' | 'agentWorkspace' | 'channelWorkspace' | 'getTask' | 'scopeWorkspaces'>;
const norm = (w: string): string => (UUID.test(w) ? w.toLowerCase() : w);

/** the legacy reading, kept for the in-memory store: the command's `workspace`, else its channel's,
 *  else its task's */
async function legacyWorkspace(store: ScopeStore, cmd: Command): Promise<string | null> {
  const c = cmd as { workspace?: unknown; channel?: unknown; taskId?: unknown };
  if (typeof c.workspace === 'string' && c.workspace) return c.workspace;
  if (typeof c.channel === 'string' && UUID.test(c.channel)) {
    const ch = await store.channelWorkspace(c.channel).catch(() => null);
    if (ch) return ch.workspace;
  }
  if (typeof c.taskId === 'string' && c.taskId) {
    const task = await store.getTask(c.taskId).catch(() => null);
    if (task) return task.workspace;
  }
  return null;
}

/** the ONE workspace a command acts in: its `workspace` and the owner of every row it names. Refuses
 *  a command whose rows span workspaces, and (on a store that resolves rows) one that resolves to none. */
export async function commandWorkspace(store: ScopeStore, cmd: Command): Promise<string | null> {
  if (!store.scopeWorkspaces) return legacyWorkspace(store, cmd);
  const named = (cmd as { workspace?: unknown }).workspace;
  const refs = commandRefs(cmd);
  // ONE SPELLING FOR A ROW. the database reads a uuid with no hyphens or in braces as the same row,
  // so an id in any form but the standard one is refused here, before a later check can read it two ways
  const odd = typeof named === 'string' && looseUuid(named) ? 'workspace' : refs.find((r) => looseUuid(r.id))?.kind;
  if (odd) throw new DomainError('INVALID_INPUT', `the ${odd} id is not in the standard uuid form`);
  let owners: Array<string | null>;
  try { owners = await store.scopeWorkspaces(refs); } catch (e) {
    console.error('command scope: row lookup failed', e);
    throw new DomainError('AUTH_UNAVAILABLE', 'the workspace check is unavailable, try again');
  }
  const found = new Set<string>();
  if (typeof named === 'string' && named) found.add(norm(named));
  for (const w of owners) if (w) found.add(norm(w));
  if (found.size > 1) {
    // a row of another workspace answers exactly as a missing one does: it is not in yours
    const first = norm(typeof named === 'string' && named ? named : (owners.find(Boolean) as string));
    const foreign = refs.find((_, i) => owners[i] && norm(owners[i]!) !== first) ?? refs[0]!;
    throw new DomainError('NOT_FOUND', `${foreign.kind} ${foreign.id} not found`);
  }
  const [workspace] = [...found];
  if (!workspace) {
    const first = refs[0];
    throw new DomainError('NOT_FOUND', first ? `${first.kind} ${first.id} not found` : 'this command names no workspace');
  }
  return workspace;
}

export interface ScopeMachine { id: string; workspaceId: string }
/** the lane the actor came in on: a machine token, and/or the member a bearer proved (the /v1 gate
 *  sets `machine` and `memberId`). Neither = the bare actor-header lane, or a call the server made. */
export interface ScopeVia { machine?: ScopeMachine | null; memberId?: string | null }

/** may this actor write into this workspace? A person must be a member; an agent must live there
 *  (its row decides, never its claim); a machine token writes only inside its own workspace, and a
 *  daemon acting as its owner still needs the owner to be a member. Store errors THROW.
 *
 *  AN AGENT WITH NO ROW can only arrive on the bare actor-header lane: the bearer and machine lanes
 *  refuse such a claim at the gate (bearer-auth.ts, machine-auth.ts). That lane is anyone-as-anyone
 *  by design (closed unless NM_ALLOW_ACTOR_HEADER=1, secret-gated on a public URL, and its holders
 *  — the e2e driver, the dev stack, the test suites — may name any person anyway), so its row-less
 *  agents pass; a header-lane agent that HAS a row is held to it like any other. On the in-memory
 *  store (no row resolver) a workspace with no members, or an agent it has never seen, is not a
 *  tenant boundary and passes, as it always did. */
export async function actorMayWrite(store: Pick<ScopeStore, 'humanMemberIds' | 'agentWorkspace' | 'scopeWorkspaces'>, actor: Actor, workspace: string, via: ScopeVia = {}): Promise<boolean> {
  const strict = !!store.scopeWorkspaces;
  const machine = via.machine ?? null;
  if (machine && norm(machine.workspaceId) !== norm(workspace)) return false;
  if (actor.kind === 'agent') {
    const home = strict && !UUID.test(actor.id) ? null : await store.agentWorkspace(actor.id);
    if (home) return norm(home) === norm(workspace);
    return !strict || (!machine && !via.memberId);
  }
  if (actor.kind !== 'human') return false;
  const members = await store.humanMemberIds(workspace);
  return members.length ? members.includes(actor.id) : !strict;
}

/** the route form, for the direct write lanes that bypass /v1/commands (/v1/messages, /v1/artifacts,
 *  /v1/whiteboards, /v1/x/search): the body's workspace, every row the body names by id (each must
 *  live in that workspace, or not exist yet), and the actor. A LOOKUP THAT FAILS THROWS a 503, never
 *  a "no": the clients treat a 4xx as a final verdict and drop the write from their outbox, so a
 *  database hiccup answered 403 lost the person's message (the security lane's review, 2026-11-13).
 *  It still fails closed: nothing is written, and the client tries again. */
export async function routeMayWrite(store: Pick<ScopeStore, 'humanMemberIds' | 'agentWorkspace' | 'scopeWorkspaces'>, actor: Actor, workspace: string, refs: Array<[ScopeKind, unknown]> = [], via: ScopeVia = {}): Promise<boolean> {
  if (localMode()) return true;
  try {
    if (store.scopeWorkspaces) {
      const named = refs.flatMap(([kind, id]) => (typeof id === 'string' && id ? [{ kind, id }] : []));
      if (looseUuid(workspace) || named.some((r) => looseUuid(r.id))) return false; // one spelling for a row (commandWorkspace)
      const owners = await store.scopeWorkspaces(named);
      if (owners.some((w) => w && norm(w) !== norm(workspace))) return false;
    }
    return await actorMayWrite(store, actor, workspace, via);
  } catch (e) {
    console.error('workspace check failed', e);
    throw new DomainError('AUTH_UNAVAILABLE', 'the workspace check is unavailable, try again');
  }
}

/** refuse any actor who writes outside the one workspace the command acts in */
export async function assertCommandScope(store: Store, actor: Actor, cmd: Command, via: ScopeVia = {}): Promise<void> {
  // the local stack (NM_LOCAL=1) is one person on their own Mac: every workspace there is theirs
  if (OUTSIDE.has(cmd.type) || localMode()) return;
  const workspace = await commandWorkspace(store, cmd);
  if (!workspace) return; // the in-memory store, a command naming nothing it holds
  let ok: boolean;
  try { ok = await actorMayWrite(store, actor, workspace, via); } catch (e) {
    console.error('command scope: membership lookup failed', e);
    throw new DomainError('AUTH_UNAVAILABLE', 'the workspace check is unavailable, try again');
  }
  if (!ok) throw new DomainError('NOT_PERMITTED', 'not your workspace');
}
