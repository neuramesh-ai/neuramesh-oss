// The command scope guard fails CLOSED and covers the whole command union (R10 lane A: NM-002,
// NM-012, NM-086, NM-106, NM-107). The pg matrix (tenancy-matrix.pg.test.ts) proves the refusals end
// to end against real rows; this file pins the guard's own decisions with fake stores, including the
// failure modes a real database rarely shows on demand: a lookup that throws, a workspace with no
// members, an id that is not a uuid, rows from two workspaces in one command.
import type { Actor } from '@neuramesh/shared';
import { describe, expect, it } from 'vitest';
import { actorSecretOk, withServerRole } from '../src/bearer-auth';
import { CommandSchema, type Command } from '../src/commands';
import { DomainError } from '../src/errors';
import { requireHumanAuthority } from '../src/handler/guards';
import { assertCommandScope, commandRefs, FIELD_KIND, OUTSIDE, routeMayWrite, TYPE_FIELD_KIND } from '../src/handler/scope';
import type { Store } from '../src/store';
import { canonicalUuid, looseUuid, type ScopeRef } from '../src/store/scope-rows';

const A = 'a0000000-0000-4000-8000-00000000000a';
const B = 'b0000000-0000-4000-8000-00000000000b';
const ROW = 'c0000000-0000-4000-8000-00000000000c';
const person: Actor = { kind: 'human', id: 'u-member' };
const AGENT_A = 'a9000000-0000-4000-8000-0000000000a9';
const agent: Actor = { kind: 'agent', id: AGENT_A };

/** a strict store (it resolves rows): `rows` maps an id to its workspace */
function strict(over: Partial<{ rows: Record<string, string>; members: Record<string, string[]>; agents: Record<string, string>; scopeThrows: boolean; membersThrow: boolean }> = {}): Store {
  const { rows = {}, members = { [A]: ['u-member'] }, agents = { [AGENT_A]: A } } = over;
  return {
    scopeWorkspaces: async (refs: ScopeRef[]) => { if (over.scopeThrows) throw new Error('connection reset'); return refs.map((r) => rows[r.id] ?? null); },
    humanMemberIds: async (ws: string) => { if (over.membersThrow) throw new Error('connection reset'); return members[ws] ?? []; },
    agentWorkspace: async (id: string) => agents[id] ?? null,
    channelWorkspace: async () => { throw new Error('unused on a strict store'); },
    getTask: async () => null,
  } as unknown as Store;
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try { await p; return 'ALLOWED'; } catch (e) { return e instanceof DomainError ? e.code : `THREW ${String(e)}`; }
}

const cmd = (c: unknown): Command => c as Command;

describe('the command union is covered', () => {
  // every field a command type carries, read from the schema the server parses
  const shapes = CommandSchema.options.map((o) => ({ type: o.shape.type.value as Command['type'], keys: Object.keys(o.shape) }));
  // fields that are not rows of a workspace (people, enums, text, nested shapes commandRefs walks itself)
  const NOT_ROWS = new Set(['type', 'workspace', 'member', 'person', 'forUserId', 'createdBy', 'offerTo', 'itemId', 'approvalId', 'channels', 'newChannels', 'repo', 'codingHandoff', 'agents', 'items', 'shares']);

  it('every id-shaped field of every command maps to a row kind, or is named as not a row', () => {
    const unmapped: string[] = [];
    for (const { type, keys } of shapes) {
      for (const k of keys) {
        const idShaped = /(^id$|Id$|^(task|channel|project|agent|schedule|item|message|thread|connector|invite|machine|reminder|parent|supersededBy|originThread|pack)$)/.test(k);
        if (!idShaped || NOT_ROWS.has(k)) continue;
        const over = TYPE_FIELD_KIND[type] ?? {};
        if (!(k in over) && !(k in FIELD_KIND)) unmapped.push(`${type}.${k}`);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it('every command outside OUTSIDE names a workspace or a row (none can resolve to nothing by construction)', () => {
    const blind = shapes.filter(({ type, keys }) => !OUTSIDE.has(type) && !keys.includes('workspace')
      && !keys.some((k) => k in FIELD_KIND || k in (TYPE_FIELD_KIND[type] ?? {})) && !keys.includes('channels'));
    expect(blind.map((s) => s.type)).toEqual([]);
  });

  it('reads the nested and the type-specific ids', () => {
    expect(commandRefs(cmd({ type: 'credential.set', workspace: B, scope: 'agent', agentId: ROW }))).toEqual([{ kind: 'agent', id: ROW }]);
    expect(commandRefs(cmd({ type: 'policy.set', workspace: B, id: ROW, agentId: null }))).toEqual([{ kind: 'policy', id: ROW }]);
    expect(commandRefs(cmd({ type: 'schedule.create', channel: ROW, agent: 'rex' }))).toEqual([{ kind: 'channel', id: ROW }]);
    expect(commandRefs(cmd({ type: 'modelpack.delete', workspace: B, packId: 'custom:x' }))).toEqual([{ kind: 'modelpack', id: 'custom:x' }]);
    expect(commandRefs(cmd({ type: 'task.offer', taskId: ROW, repo: { id: 'r1' } }))).toEqual([{ kind: 'task', id: ROW }, { kind: 'repo', id: 'r1' }]);
    expect(commandRefs(cmd({ type: 'member.set_compute', workspace: B, agents: { ag: 'm1' } }))).toEqual([{ kind: 'agent', id: 'ag' }, { kind: 'machine', id: 'm1' }]);
    expect(commandRefs(cmd({ type: 'task.propose_ship_plan', taskId: ROW, items: [{ agentId: 'ag2' }] }))).toEqual([{ kind: 'task', id: ROW }, { kind: 'agent', id: 'ag2' }]);
  });
});

describe('assertCommandScope fails closed (a store that resolves rows)', () => {
  it('a member writing into their own workspace passes', async () => {
    expect(await refusal(assertCommandScope(strict({ rows: { [ROW]: A } }), person, cmd({ type: 'project.update', project: ROW })))).toBe('ALLOWED');
  });
  it('an id-only command on another workspace\'s row is refused', async () => {
    expect(await refusal(assertCommandScope(strict({ rows: { [ROW]: B } }), person, cmd({ type: 'project.delete', project: ROW })))).toBe('NOT_PERMITTED');
  });
  it('the caller\'s own workspace with a foreign child id is refused (credential.set / policy.delete)', async () => {
    const s = strict({ rows: { [ROW]: B } });
    // a row of another workspace answers as a missing one: it is not in yours
    expect(await refusal(assertCommandScope(s, person, cmd({ type: 'credential.set', workspace: A, scope: 'agent', agentId: ROW })))).toBe('NOT_FOUND');
    expect(await refusal(assertCommandScope(s, person, cmd({ type: 'policy.delete', workspace: A, policyId: ROW })))).toBe('NOT_FOUND');
  });
  it('a row lookup that throws is a 503, never a pass', async () => {
    expect(await refusal(assertCommandScope(strict({ scopeThrows: true }), person, cmd({ type: 'project.update', project: ROW })))).toBe('AUTH_UNAVAILABLE');
  });
  it('a membership lookup that throws is a 503, never a pass', async () => {
    expect(await refusal(assertCommandScope(strict({ rows: { [ROW]: A }, membersThrow: true }), person, cmd({ type: 'project.update', project: ROW })))).toBe('AUTH_UNAVAILABLE');
  });
  it('a workspace with no members is a refusal, not "the handler answers"', async () => {
    expect(await refusal(assertCommandScope(strict({ members: {} }), person, cmd({ type: 'thread.update', workspace: A, threadId: ROW })))).toBe('NOT_PERMITTED');
  });
  it('a non-uuid (or missing) id on an id-only command resolves nowhere: 404, never a pass', async () => {
    expect(await refusal(assertCommandScope(strict(), person, cmd({ type: 'schedule.delete', schedule: 'not-a-uuid' })))).toBe('NOT_FOUND');
  });
  it('a stranger is refused', async () => {
    expect(await refusal(assertCommandScope(strict({ rows: { [ROW]: A } }), { kind: 'human', id: 'u-stranger' }, cmd({ type: 'skill.update', skillId: ROW })))).toBe('NOT_PERMITTED');
  });
  it('an agent is held to the workspace its ROW lives in', async () => {
    expect(await refusal(assertCommandScope(strict({ rows: { [ROW]: A } }), agent, cmd({ type: 'run.step', runId: ROW })))).toBe('ALLOWED');
    expect(await refusal(assertCommandScope(strict({ rows: { [ROW]: B } }), agent, cmd({ type: 'run.step', runId: ROW })))).toBe('NOT_PERMITTED');
  });
  it('an agent with no row is refused on the bearer and machine lanes (the gate already refuses them there; this holds anyway)', async () => {
    const nobody: Actor = { kind: 'agent', id: 'd0000000-0000-4000-8000-00000000000d' };
    const s = strict({ rows: { [ROW]: A } });
    expect(await refusal(assertCommandScope(s, nobody, cmd({ type: 'run.step', runId: ROW }), { memberId: 'u-member' }))).toBe('NOT_PERMITTED');
    expect(await refusal(assertCommandScope(s, nobody, cmd({ type: 'run.step', runId: ROW }), { machine: { id: 'm', workspaceId: A } }))).toBe('NOT_PERMITTED');
    // the bare header lane is anyone-as-anyone by design: its row-less agents pass, its real ones are held
    expect(await refusal(assertCommandScope(s, nobody, cmd({ type: 'run.step', runId: ROW })))).toBe('ALLOWED');
  });
  it('a machine token writes only inside its own workspace, whoever it speaks as', async () => {
    const s = strict({ rows: { [ROW]: A }, members: { [A]: ['u-member'], [B]: ['u-member'] } });
    expect(await refusal(assertCommandScope(s, person, cmd({ type: 'content.delete', item: ROW }), { machine: { id: 'm', workspaceId: A } }))).toBe('ALLOWED');
    expect(await refusal(assertCommandScope(s, person, cmd({ type: 'content.delete', item: ROW }), { machine: { id: 'm', workspaceId: B } }))).toBe('NOT_PERMITTED');
  });
  it('the OUTSIDE commands do not read the stores', async () => {
    expect(await refusal(assertCommandScope(strict({ scopeThrows: true, membersThrow: true }), person, cmd({ type: 'workspace.create', name: 'x', slug: 'xx' })))).toBe('ALLOWED');
  });
});

describe('the route form (/v1/messages, /v1/artifacts, /v1/whiteboards, /v1/x/search)', () => {
  it('refuses a body whose channel lives in another workspace, and fails closed on a lookup error', async () => {
    expect(await routeMayWrite(strict({ rows: { [ROW]: B } }), person, A, [['channel', ROW]])).toBe(false);
    expect(await routeMayWrite(strict({ rows: { [ROW]: A } }), person, A, [['channel', ROW]])).toBe(true);
    // a failed lookup is a 503 the client tries again, never a 403 that makes it drop the write
    expect(await refusal(routeMayWrite(strict({ scopeThrows: true }), person, A, [['channel', ROW]]))).toBe('AUTH_UNAVAILABLE');
    expect(await refusal(routeMayWrite(strict({ membersThrow: true }), person, A, []))).toBe('AUTH_UNAVAILABLE');
  });
  it('refuses a row or a workspace in a uuid form that is not the standard one', async () => {
    const s = strict({ rows: { [ROW]: A } });
    expect(await routeMayWrite(s, person, A, [['channel', ROW.replace(/-/g, '')]])).toBe(false);
    expect(await routeMayWrite(s, person, A, [['channel', `{${ROW}}`]])).toBe(false);
    expect(await routeMayWrite(s, person, A.replace(/-/g, ''), [])).toBe(false);
    expect(await routeMayWrite(s, person, A, [['channel', ROW.toUpperCase()]])).toBe(true);
  });
});

describe('one spelling for a row (the uuid forms that PostgreSQL reads)', () => {
  it('canonicalUuid reads each form the database reads, and nothing else', () => {
    for (const form of [ROW, ROW.toUpperCase(), ROW.replace(/-/g, ''), `{${ROW}}`, ROW.replace(/-/g, '').match(/.{4}/g)!.join('-'), ` ${ROW} `]) expect(canonicalUuid(form)).toBe(ROW);
    for (const not of ['', 'rex', 'custom:' + ROW, ROW.slice(1), ROW + '0', 'g'.repeat(32)]) expect(canonicalUuid(not)).toBeNull();
    expect(looseUuid(ROW)).toBe(false);
    expect(looseUuid(ROW.toUpperCase())).toBe(false);
    expect(looseUuid(ROW.replace(/-/g, ''))).toBe(true);
    expect(looseUuid('rex')).toBe(false);
  });
  it('a command that names a row in a different form is refused before any lookup', async () => {
    // B's own workspace, and A's row with no hyphens: the lookup said "no such row" and the command passed
    const s = strict({ rows: { [ROW]: B }, members: { [A]: ['u-member'] } });
    for (const form of [ROW.replace(/-/g, ''), `{${ROW}}`]) {
      expect(await refusal(assertCommandScope(s, person, cmd({ type: 'repo.link', workspace: A, project: form, url: 'https://github.com/a/b' })))).toBe('INVALID_INPUT');
      expect(await refusal(assertCommandScope(s, person, cmd({ type: 'project.update', project: form })))).toBe('INVALID_INPUT');
    }
    expect(await refusal(assertCommandScope(s, person, cmd({ type: 'thread.update', workspace: A.replace(/-/g, ''), threadId: ROW })))).toBe('INVALID_INPUT');
  });
  it('reads the ids the first table missed', () => {
    expect(commandRefs(cmd({ type: 'marketing.setup', channel: ROW, releases: { repoId: 'r9' } }))).toEqual([{ kind: 'channel', id: ROW }, { kind: 'repo', id: 'r9' }]);
    expect(commandRefs(cmd({ type: 'setup.step', taskId: ROW, value: { repoId: 'r9' } }))).toEqual([{ kind: 'task', id: ROW }, { kind: 'repo', id: 'r9' }]);
    expect(commandRefs(cmd({ type: 'workspace.update', workspace: A, activeModelPack: 'custom:p' }))).toEqual([{ kind: 'modelpack', id: 'custom:p' }]);
    expect(commandRefs(cmd({ type: 'project.update', project: ROW, modelPack: 'custom:p' }))).toEqual([{ kind: 'project', id: ROW }, { kind: 'modelpack', id: 'custom:p' }]);
    expect(commandRefs(cmd({ type: 'project.update', project: ROW, modelPack: '' }))).toEqual([{ kind: 'project', id: ROW }]);
  });
});

describe('the in-memory store keeps its legacy reading (no row resolver: phantom workspaces)', () => {
  const lenient = { humanMemberIds: async () => [], agentWorkspace: async () => null, channelWorkspace: async () => ({ workspace: 'ws' }), getTask: async () => null } as unknown as Store;
  it('a phantom workspace with no members passes, as it always did', async () => {
    expect(await refusal(assertCommandScope(lenient, person, cmd({ type: 'thread.update', workspace: 'ws_acme', threadId: ROW })))).toBe('ALLOWED');
  });
});

describe('the role is the row\'s (NM-106)', () => {
  const claim: Actor = { kind: 'agent', id: 'w1', role: 'orchestrator' };
  it('a worker claiming orchestrator is demoted to its row\'s role', async () => {
    expect(await withServerRole({ agentHome: async () => ({ workspace: A, role: 'developer' }) }, claim)).toEqual({ kind: 'agent', id: 'w1', role: 'developer' });
  });
  it('no row keeps NO role, and a lookup error is a 503, never a silent demotion', async () => {
    expect(await withServerRole({ agentHome: async () => null }, claim)).toEqual({ kind: 'agent', id: 'w1' });
    expect(await refusal(withServerRole({ agentHome: async () => { throw new Error('down'); } }, claim))).toBe('AUTH_UNAVAILABLE');
  });
  it('on the bare header lane a claim with no row keeps its role; one with a row still takes the row\'s', async () => {
    expect(await withServerRole({ agentHome: async () => null }, claim, true)).toBe(claim);
    expect(await withServerRole({ agentHome: async () => ({ workspace: A, role: 'reviewer' }) }, claim, true)).toEqual({ kind: 'agent', id: 'w1', role: 'reviewer' });
    expect(await refusal(withServerRole({ agentHome: async () => { throw new Error('down'); } }, claim, true))).toBe('AUTH_UNAVAILABLE');
  });
  it('humans and stores without agent rows are untouched', async () => {
    expect(await withServerRole({ agentHome: async () => null }, person)).toBe(person);
    expect(await withServerRole({}, claim)).toBe(claim);
  });
});

describe('the bare-header secret (NM-107)', () => {
  it('an empty secret closes the lane in a production image, unless it says so on purpose', () => {
    expect(actorSecretOk(undefined, '', { NODE_ENV: 'production' })).toBe(false);
    expect(actorSecretOk(undefined, undefined, { NODE_ENV: 'production', NM_ACTOR_HEADER_INSECURE: '1' })).toBe(true);
    expect(actorSecretOk(undefined, undefined, { NODE_ENV: 'test' })).toBe(true);
    expect(actorSecretOk('s3cret', 's3cret', { NODE_ENV: 'production' })).toBe(true);
    expect(actorSecretOk('wrong!', 's3cret', { NODE_ENV: 'production' })).toBe(false);
  });
});

describe('the machine lane cannot administer the account (NM-086)', () => {
  for (const type of ['workspace.invite', 'workspace.delete', 'account.delete', 'workspace.remove_member', 'credential.set', 'modelpack.save', 'connector.disconnect', 'project.delete']) {
    it(`${type} is HUMAN_ONLY on the machine lane`, () => {
      expect(() => requireHumanAuthority({ kind: 'human', id: 'owner' }, { type })).toThrow(/signed-in person/);
    });
  }
  it('daemon work still passes', () => {
    for (const type of ['task.submit', 'run.open', 'workspace.update', 'agent.set_status', 'memory.record_lesson']) expect(() => requireHumanAuthority({ kind: 'human', id: 'owner' }, { type })).not.toThrow();
  });
});
