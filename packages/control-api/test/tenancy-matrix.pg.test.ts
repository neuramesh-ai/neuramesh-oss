// CROSS-TENANT COMMAND MATRIX (R10 lane A: NM-002, NM-004, NM-012, NM-043, NM-086, NM-106).
//
// Two real workspaces. Workspace A is the victim: it holds one row of every kind a command can name
// by id (project, channel, agent, schedule, skill, skill pack, content item, artifact, whiteboard,
// connector, fact, message, decision, policy, run, thread, custom brain, invite, machine, task,
// code session). Workspace B is the attacker, and it attacks on every lane it legitimately holds:
//
//   · B's owner, a signed-in person (the actor header lane the suite runs, NM_ALLOW_ACTOR_HEADER=1)
//   · B's machine token (nmm_), acting as B's owner, as a daemon does with no header
//   · B's agent claim (the header lane), claiming the orchestrator role
//   · B's machine token carrying B's agent as the author
//
// Every id-bearing command aimed at A's rows must be REFUSED, and A must not change: each case
// reseeds a fresh A, fingerprints every row of A (and the cross-workspace rows an attack would
// plant, e.g. a credential on A's agent filed under B), sends the command, and compares.
//
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { hashMachineToken } from '../src/machine-auth';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;

interface Tenant {
  ws: string; owner: string; project: string; channel: string; agent: string; machine: string; token: string;
}
interface Victim extends Tenant {
  schedule: string; skill: string; pack: string; item: string; artifact: string; board: string; connector: string;
  fact: string; message: string; decision: string; policy: string; run: string; thread: string; cmpack: string;
  invite: string; task: string; codeSession: string; credential: string;
}

const tag = () => randomBytes(4).toString('hex');

async function tenant(name: string): Promise<Tenant> {
  const t = tag();
  const [u] = await sql!`insert into nm_users (clerk_user_id, email) values (${`user_${name}_${t}`}, ${`${name}-${t}@tenancy.test`}) returning id`;
  const owner = u!['id'] as string;
  const [w] = await sql!`insert into workspaces (name, slug, created_by, plan) values (${`${name} ${t}`}, ${`${name}-${t}`}, ${owner}::uuid, 'cloud') returning id`;
  const ws = w!['id'] as string;
  await sql!`insert into workspace_members (workspace_id, user_id, role) values (${ws}::uuid, ${owner}::uuid, 'owner')`;
  const [p] = await sql!`insert into projects (workspace_id, name, slug) values (${ws}::uuid, 'Work', ${`work-${t}`}) returning id`;
  const project = p!['id'] as string;
  const [c] = await sql!`insert into channels (workspace_id, project_id, slug) values (${ws}::uuid, ${project}::uuid, ${`room-${t}`}) returning id`;
  const channel = c!['id'] as string;
  const token = `nmm_${randomBytes(24).toString('hex')}`;
  const [m] = await sql!`insert into machines (workspace_id, owner_user_id, name, kind, token_hash)
    values (${ws}::uuid, ${owner}::uuid, ${`box-${t}`}, 'member', ${hashMachineToken(token)}) returning id`;
  const machine = m!['id'] as string;
  const [a] = await sql!`insert into agents (workspace_id, machine_id, name, role, model)
    values (${ws}::uuid, ${machine}::uuid, ${`rex-${t}`}, 'orchestrator', 'claude-opus-4-8') returning id`;
  const agent = a!['id'] as string;
  await sql!`insert into agent_channels (agent_id, channel_id) values (${agent}::uuid, ${channel}::uuid) on conflict do nothing`;
  return { ws, owner, project, channel, agent, machine, token };
}

/** a fresh victim workspace holding one row of every id-addressable kind */
async function victim(): Promise<Victim> {
  const base = await tenant('victim');
  const { ws, owner, channel, project, agent } = base;
  const one = async (q: Promise<postgres.RowList<postgres.Row[]>>) => (await q)[0]!['id'] as string;
  const message = await one(sql!`insert into messages (workspace_id, channel_id, author_kind, author_id, body)
    values (${ws}::uuid, ${channel}::uuid, 'agent', ${agent}::uuid, ${'```nmq\n{"question":"Ship it?","options":["Yes","No"]}\n```'}) returning id`);
  const thread = await one(sql!`insert into threads (workspace_id, channel_id, project_id, title, created_by, kind, mode)
    values (${ws}::uuid, ${channel}::uuid, ${project}::uuid, 'Victim thread', ${`human:${owner}`}, 'chat', 'chat') returning id`);
  const task = await one(sql!`insert into tasks (workspace_id, channel_id, project_id, number, title, description, state, kind, creator_kind, creator_id)
    values (${ws}::uuid, ${channel}::uuid, ${project}::uuid, ${1000 + Math.floor(Math.random() * 1e6)}, 'Victim task', '', 'todo', 'feature', 'human', ${owner}::uuid) returning id`);
  return {
    ...base, message, thread, task,
    schedule: await one(sql!`insert into schedules (workspace_id, channel_id, title, cadence, at_time, tz, next_run_at, created_by_kind, created_by)
      values (${ws}::uuid, ${channel}::uuid, 'Victim routine', 'daily', '09:00', 'UTC', now() + interval '1 day', 'human', ${owner}::uuid) returning id`),
    skill: await one(sql!`insert into skills (workspace_id, channel_id, name, description, body, status, author_kind, author_id)
      values (${ws}::uuid, ${channel}::uuid, ${`victim-skill-${tag()}`}, 'd', 'b', 'active', 'human', ${owner}::uuid) returning id`),
    pack: await one(sql!`insert into skill_packs (workspace_id, channel_id, name, status) values (${ws}::uuid, ${channel}::uuid, ${`victim-pack-${tag()}`}, 'ready') returning id`),
    item: await one(sql!`insert into content_items (workspace_id, channel_id, body, status) values (${ws}::uuid, ${channel}::uuid, 'Victim draft', 'draft') returning id`),
    artifact: await one(sql!`insert into artifacts (workspace_id, channel_id, kind, name, inline_content, created_by_kind, created_by)
      values (${ws}::uuid, ${channel}::uuid, 'doc', 'victim.md', 'secret', 'human', ${owner}::uuid) returning id`),
    board: await one(sql!`insert into whiteboards (workspace_id, channel_id, title, rev, created_by_kind, created_by)
      values (${ws}::uuid, ${channel}::uuid, 'Victim board', 1, 'human', ${owner}::uuid) returning id`),
    connector: await one(sql!`insert into connectors (workspace_id, channel_id, provider, handle, status) values (${ws}::uuid, ${channel}::uuid, 'x', 'victim', 'connected') returning id`),
    fact: await one(sql!`insert into facts (workspace_id, channel_id, content) values (${ws}::uuid, ${channel}::uuid, 'The victim launch date is secret.') returning id`),
    decision: await one(sql!`insert into decisions (workspace_id, channel_id, message_id, asker_kind, asker_id, question, options)
      values (${ws}::uuid, ${channel}::uuid, ${message}::uuid, 'agent', ${agent}::uuid, 'Ship it?', ${sql!.json(['Yes', 'No'])}) returning id`),
    policy: await one(sql!`insert into policies (workspace_id, scope, capability, selector, verdict, locked, created_by_kind, created_by_id)
      values (${ws}::uuid, 'workspace', 'shell.exec', ${sql!.json({ kind: 'shellClass', value: 'destructive' })}, 'deny', true, 'human', ${owner}::uuid) returning id`),
    run: await one(sql!`insert into runs (workspace_id, channel_id, thread_id, agent_id, kind, title) values (${ws}::uuid, ${channel}::uuid, ${thread}::uuid, ${agent}::uuid, 'wake', 'Victim run') returning id`),
    cmpack: (await sql!`insert into custom_model_packs (id, workspace_id, name, roles) values (${`custom:${randomUUID()}`}, ${ws}::uuid, 'Victim brain', ${sql!.json({})}) returning id`)[0]!['id'] as string,
    invite: await one(sql!`insert into workspace_invites (workspace_id, email, token_hash, invited_by) values (${ws}::uuid, ${`invitee-${tag()}@tenancy.test`}, ${tag()}, ${owner}::uuid) returning id`),
    codeSession: await one(sql!`insert into code_sessions (id, workspace_id, created_by) values (${randomUUID()}::uuid, ${ws}::uuid, ${owner}::uuid) returning id`),
    credential: await one(sql!`insert into provider_credentials (workspace_id, agent_id, provider, scope, token, set_by)
      values (${ws}::uuid, ${agent}::uuid, 'anthropic', 'agent', 'sk-victim-key-0001', ${owner}::uuid) returning id`),
  };
}

const WS_TABLES = ['projects', 'channels', 'agents', 'machines', 'schedules', 'skills', 'skill_packs', 'content_items', 'artifacts', 'whiteboards',
  'connectors', 'facts', 'messages', 'decisions', 'policies', 'runs', 'threads', 'custom_model_packs', 'workspace_invites', 'code_sessions',
  'tasks', 'provider_credentials', 'workspace_members', 'memory_blocks', 'repos'];

/** every row of A, plus the rows an attack would plant elsewhere that still name A's ids */
async function fingerprint(v: Victim): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of WS_TABLES) {
    const [r] = await sql!`select coalesce(md5(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text)), '') as h from ${sql!(t)} x where workspace_id = ${v.ws}::uuid`;
    out[t] = r!['h'] as string;
  }
  const [cred] = await sql!`select count(*)::int as n from provider_credentials where agent_id = ${v.agent}::uuid and workspace_id <> ${v.ws}::uuid`;
  out['foreign-credentials-on-victim-agent'] = String(cred!['n']);
  const [ac] = await sql!`select coalesce(md5(string_agg(agent_id::text || channel_id::text, '|' order by agent_id::text || channel_id::text)), '') as h
    from agent_channels where channel_id = ${v.channel}::uuid or agent_id = ${v.agent}::uuid`;
  out['agent_channels'] = ac!['h'] as string;
  return out;
}

type Lane = { name: string; headers: (b: Tenant) => Record<string, string> };
const LANES: Lane[] = [
  { name: 'B human', headers: (b) => ({ 'x-nm-actor': JSON.stringify({ kind: 'human', id: b.owner } satisfies Actor) }) },
  { name: 'B machine token', headers: (b) => ({ authorization: `Bearer ${b.token}` }) },
  { name: 'B agent claim', headers: (b) => ({ 'x-nm-actor': JSON.stringify({ kind: 'agent', id: b.agent, role: 'orchestrator' } satisfies Actor) }) },
  { name: 'B machine + B agent', headers: (b) => ({ authorization: `Bearer ${b.token}`, 'x-nm-actor': JSON.stringify({ kind: 'agent', id: b.agent, role: 'orchestrator' } satisfies Actor) }) },
];

/** every id-bearing command, aimed at A's rows (B's own workspace where the command names one) */
const MATRIX: Array<[string, (a: Victim, b: Tenant) => Record<string, unknown>]> = [
  ['project.update', (a) => ({ type: 'project.update', project: a.project, name: 'pwned' })],
  ['project.archive', (a) => ({ type: 'project.archive', project: a.project })],
  ['project.delete', (a) => ({ type: 'project.delete', project: a.project })],
  ['channel.rename', (a) => ({ type: 'channel.rename', channel: a.channel, topic: 'pwned' })],
  ['channel.set_thread_mode', (a) => ({ type: 'channel.set_thread_mode', channel: a.channel, mode: 'off' })],
  ['channel.set_kind', (a) => ({ type: 'channel.set_kind', channel: a.channel, kind: 'marketing' })],
  ['channel.delete', (a) => ({ type: 'channel.delete', channel: a.channel })],
  ['channel.assign', (a, b) => ({ type: 'channel.assign', channel: a.channel, project: b.project })],
  ['channel.create (B ws, A project)', (a, b) => ({ type: 'channel.create', workspace: b.ws, project: a.project, slug: 'pwned' })],
  ['channel.add_agent (B ws, A channel)', (a, b) => ({ type: 'channel.add_agent', workspace: b.ws, channel: a.channel, agent: b.agent })],
  ['agent.update', (a) => ({ type: 'agent.update', agent: a.agent, description: 'pwned' })],
  ['agent.retire', (a) => ({ type: 'agent.retire', agent: a.agent })],
  ['agent.set_status', (a) => ({ type: 'agent.set_status', agentId: a.agent, status: 'offline' })],
  ['member.set_agent_model (B ws, A agent)', (a, b) => ({ type: 'member.set_agent_model', workspace: b.ws, agent: a.agent, model: null })],
  ['schedule.set_status', (a) => ({ type: 'schedule.set_status', schedule: a.schedule, status: 'paused' })],
  ['schedule.update', (a) => ({ type: 'schedule.update', schedule: a.schedule, title: 'pwned', prompt: 'pwned', cadence: 'daily', atTime: '10:00', tz: 'UTC' })],
  ['schedule.delete', (a) => ({ type: 'schedule.delete', schedule: a.schedule })],
  ['schedule.run_now', (a) => ({ type: 'schedule.run_now', schedule: a.schedule })],
  ['schedule.claim_run', (a) => ({ type: 'schedule.claim_run', schedule: a.schedule, runCount: 0, nextRunAt: null })],
  ['schedule.mark_result', (a) => ({ type: 'schedule.mark_result', schedule: a.schedule, error: 'pwned' })],
  ['schedule.create (A channel)', (a) => ({ type: 'schedule.create', channel: a.channel, title: 'pwned', prompt: 'pwned', cadence: 'daily', atTime: '09:00', tz: 'UTC' })],
  ['skill.update', (a) => ({ type: 'skill.update', skillId: a.skill, description: 'pwned' })],
  ['skill.set_enabled', (a) => ({ type: 'skill.set_enabled', skillId: a.skill, enabled: false })],
  ['skill.deprecate', (a) => ({ type: 'skill.deprecate', skillId: a.skill })],
  ['skill.promote', (a) => ({ type: 'skill.promote', skillId: a.skill })],
  ['skillpack.update', (a) => ({ type: 'skillpack.update', packId: a.pack, description: 'pwned' })],
  ['skillpack.set_enabled', (a) => ({ type: 'skillpack.set_enabled', packId: a.pack, enabled: false })],
  ['skillpack.remove', (a) => ({ type: 'skillpack.remove', packId: a.pack })],
  ['skillpack.commit', (a) => ({ type: 'skillpack.commit', packId: a.pack, skills: [{ name: 'pwned', body: 'pwned' }] })],
  ['content.update', (a) => ({ type: 'content.update', item: a.item, body: 'pwned' })],
  ['content.revise', (a) => ({ type: 'content.revise', item: a.item, body: 'pwned' })],
  ['content.delete', (a) => ({ type: 'content.delete', item: a.item })],
  ['content.approve', (a) => ({ type: 'content.approve', item: a.item })],
  ['content.unschedule', (a) => ({ type: 'content.unschedule', item: a.item })],
  ['content.create (A channel)', (a) => ({ type: 'content.create', channel: a.channel, body: 'pwned' })],
  ['artifact.delete', (a) => ({ type: 'artifact.delete', artifactId: a.artifact })],
  ['artifact.promote', (a) => ({ type: 'artifact.promote', artifactId: a.artifact })],
  ['artifact.create (A channel)', (a) => ({ type: 'artifact.create', channel: a.channel, name: 'pwned.md', inlineContent: 'pwned' })],
  ['whiteboard.update', (a) => ({ type: 'whiteboard.update', whiteboardId: a.board, baseRev: 1, title: 'pwned' })],
  ['whiteboard.create (A channel)', (a) => ({ type: 'whiteboard.create', channel: a.channel, title: 'pwned', mermaid: 'graph TD; a-->b' })],
  ['connector.disconnect', (a) => ({ type: 'connector.disconnect', connector: a.connector })],
  ['memory.retire_fact', (a) => ({ type: 'memory.retire_fact', factId: a.fact })],
  ['memory.upsert_fact (B ws, A channel)', (a, b) => ({ type: 'memory.upsert_fact', workspace: b.ws, channel: a.channel, content: 'pwned fact from another tenant' })],
  ['message.pin', (a) => ({ type: 'message.pin', message: a.message, pinned: true })],
  ['message.revise_card', (a) => ({ type: 'message.revise_card', message: a.message, body: '```nmq\n{"question":"pwned?","options":["Yes"]}\n```' })],
  ['reply.clear', (a) => ({ type: 'reply.clear', message: a.message })],
  ['decision.answer', (a) => ({ type: 'decision.answer', decisionId: a.decision, answer: 'Yes' })],
  ['decision.dismiss', (a) => ({ type: 'decision.dismiss', decisionId: a.decision })],
  ['policy.delete (B ws, A policy)', (a, b) => ({ type: 'policy.delete', workspace: b.ws, policyId: a.policy })],
  ['policy.set (B ws, A policy id)', (a, b) => ({ type: 'policy.set', workspace: b.ws, id: a.policy, scope: 'workspace', capability: 'shell.exec', selector: { kind: 'any' }, verdict: 'allow' })],
  ['credential.set (B ws, A agent)', (a, b) => ({ type: 'credential.set', workspace: b.ws, provider: 'anthropic', scope: 'agent', agentId: a.agent, token: 'sk-attacker-key-0001', authMode: 'apikey' })],
  ['modelpack.delete (B ws, A pack)', (a, b) => ({ type: 'modelpack.delete', workspace: b.ws, packId: a.cmpack })],
  ['workspace.revoke_invite (B ws, A invite)', (a, b) => ({ type: 'workspace.revoke_invite', workspace: b.ws, invite: a.invite })],
  ['task.cancel', (a) => ({ type: 'task.cancel', taskId: a.task })],
  ['task.create (B ws, A channel)', (a, b) => ({ type: 'task.create', workspace: b.ws, channel: a.channel, title: 'pwned task' })],
  ['thread.update (B ws, A thread)', (a, b) => ({ type: 'thread.update', workspace: b.ws, threadId: a.thread, title: 'pwned' })],
  ['thread.move (B ws, A thread)', (a, b) => ({ type: 'thread.move', workspace: b.ws, threadId: a.thread, channel: b.channel, reason: 'pwned' })],
  ['run.step', (a) => ({ type: 'run.step', runId: a.run, step: 'pwned' })],
  ['run.settle', (a) => ({ type: 'run.settle', runId: a.run, state: 'done' })],
  ['machine.heartbeat (A machine)', (a) => ({ type: 'machine.heartbeat', machineId: a.machine })],
  ['code_session.close (B ws, A session)', (a, b) => ({ type: 'code_session.close', workspace: b.ws, codeSessionId: a.codeSession })],
  ['repo.link (B ws, A project)', (a, b) => ({ type: 'repo.link', workspace: b.ws, project: a.project, url: 'https://github.com/acme/pwned' })],
  ['marketing.set_integration (A channel)', (a) => ({ type: 'marketing.set_integration', channel: a.channel, provider: 'x', enabled: true })],
];

let attacker: Tenant;
beforeAll(async () => { if (DB) attacker = await tenant('attacker'); });
afterAll(async () => { await sql?.end(); await store?.close(); });

describe.skipIf(!DB)('tenant isolation: every id-bearing command against another workspace is refused, and nothing changes', () => {
  for (const lane of LANES) {
    describe(lane.name, () => {
      for (const [name, build] of MATRIX) {
        it(name, async () => {
          const a = await victim();
          const before = await fingerprint(a);
          const res = await app!.request('/v1/commands', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...lane.headers(attacker) },
            body: JSON.stringify(build(a, attacker)),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          // a shape error would make the case vacuous: the command must reach the server's checks
          expect(body.error, JSON.stringify(body)).not.toBe('invalid command');
          expect(res.status, `${name} as ${lane.name} answered ${res.status} ${JSON.stringify(body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
          // a refusal is a verdict, never a crash: a 5xx here would pass "nothing changed" by accident
          expect(res.status, `${name} as ${lane.name} answered ${res.status} ${JSON.stringify(body).slice(0, 200)}`).toBeLessThan(500);
          expect(await fingerprint(a)).toEqual(before);
        });
      }
    });
  }

  // the positive control: the matrix's own lanes still work inside B (a refusal everywhere would
  // pass the matrix and break the product)
  it('B acts in its own workspace on every lane', async () => {
    for (const lane of LANES) {
      const res = await app!.request('/v1/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...lane.headers(attacker) },
        body: JSON.stringify({ type: 'memory.record_lesson', workspace: attacker.ws, channel: attacker.channel, content: `lesson from ${lane.name}: keep it tidy` }),
      });
      expect(res.status, `${lane.name}: ${await res.clone().text()}`).toBe(200);
    }
  });
});

// THE SAME ROW IN A DIFFERENT UUID FORM. PostgreSQL reads a uuid with no hyphens, in braces, or with a
// hyphen after any group of four digits. the guard read only the standard form, took every other form
// for "no such row", and so a command that also named a row of the caller's own workspace passed, and
// the store then wrote the foreign row. every command of the matrix runs again with A's ids rewritten.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMS: Array<[string, (id: string) => string]> = [
  ['no hyphens', (id) => id.replace(/-/g, '')],
  ['braces', (id) => `{${id}}`],
  ['a hyphen after each four digits', (id) => id.replace(/-/g, '').match(/.{4}/g)!.join('-')],
  ['upper case', (id) => id.toUpperCase()],
];
const inForm = <T extends object>(row: T, form: (id: string) => string): T =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && UUID_RE.test(v) ? form(v) : v])) as T;

describe.skipIf(!DB)('tenant isolation: a foreign row in a different uuid form is refused, and nothing changes', () => {
  for (const [formName, form] of FORMS) {
    describe(formName, () => {
      for (const [name, build] of MATRIX) {
        it(name, async () => {
          const a = await victim();
          const before = await fingerprint(a);
          const res = await app!.request('/v1/commands', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...LANES[0]!.headers(attacker) },
            body: JSON.stringify(build(inForm(a, form), attacker)),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          expect(res.status, `${name} (${formName}) answered ${res.status} ${JSON.stringify(body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
          expect(res.status, `${name} (${formName}) answered ${res.status} ${JSON.stringify(body).slice(0, 200)}`).toBeLessThan(500);
          expect(await fingerprint(a)).toEqual(before);
        });
      }
    });
  }

  // the cases a review named: each one also names a row of the caller's own workspace
  it('a draft cannot land in a foreign room that is named with no hyphens', async () => {
    const a = await victim();
    const [mine] = await sql!`insert into threads (workspace_id, channel_id, project_id, title, created_by, kind, mode)
      values (${attacker.ws}::uuid, ${attacker.channel}::uuid, ${attacker.project}::uuid, 'Own thread', ${`human:${attacker.owner}`}, 'chat', 'chat') returning id`;
    const before = await fingerprint(a);
    const res = await app!.request('/v1/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...LANES[0]!.headers(attacker) },
      body: JSON.stringify({ type: 'content.create', channel: a.channel.replace(/-/g, ''), thread: mine!['id'], body: 'pwned draft' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await fingerprint(a)).toEqual(before);
  });
});
