// The plan-approval gate (docs/29 §4d) against the REAL schema — the regression this file
// exists for: task.approve_plan returned 200 while the pg store DROPPED plan_approved_at
// (the mutation UPDATE's column list predated the gate), so the human's stamp never reached
// the database, the daemon's claim watch never released the offered worker, and every plan
// stalled in plan_review forever (the smoke-gate stall, found 2026-08-11). The in-memory
// store kept the field, so only a pg test can hold this line. Run via scripts/test-pg.sh.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

// own machine + agents, never a sibling file's leftovers (the shared-compute ruling)
let arch: Actor;
let dev: Actor;
let devName = '';
beforeAll(async () => {
  if (!sql) return;
  const [m] = await sql`insert into machines (workspace_id, owner_user_id, name, platform, daemon_version, last_seen_at, runtimes)
    values (${WS}::uuid, ${george.id}::uuid, 'plan-test-host', 'darwin', '1', now(), '["claude-code"]'::jsonb)
    on conflict (workspace_id, name) do update set last_seen_at = now() returning id`;
  const mk = async (name: string, role: string): Promise<string> => {
    const [a] = await sql`insert into agents (workspace_id, machine_id, name, role, model)
      values (${WS}::uuid, ${m!['id']}::uuid, ${name}, ${role}, 'claude-opus-4-8')
      on conflict (workspace_id, name) do update set machine_id = excluded.machine_id returning id`;
    return a!['id'] as string;
  };
  arch = { kind: 'agent', id: await mk('plan-test-arch', 'architect'), role: 'architect' };
  devName = 'plan-test-dev';
  dev = { kind: 'agent', id: await mk(devName, 'developer'), role: 'developer' };
  // the ACL: an offer resolves through agent_channels, so both agents register to dev
  const [ch] = await sql`select id from channels where workspace_id = ${WS}::uuid and slug = 'dev'`;
  for (const a of [arch, dev]) {
    await sql`insert into agent_channels (agent_id, channel_id) values (${a.id}::uuid, ${ch!['id']}::uuid) on conflict do nothing`;
  }
});

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('the plan-approval gate on postgres (real schema)', () => {
  it('persists the human stamp, refuses agents, and releases the offered claim only after it', async () => {
    // each setup step asserts WITH the server's refusal text, so a failure names its cause
    const ok = async (r: Response): Promise<string> => `${r.status}${r.status === 200 ? '' : ` ${(await r.text()).slice(0, 160)}`}`;
    const created = await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'plan gate: persist the stamp', kind: 'feature' });
    expect(await ok(created)).toBe('200');
    const { task } = await j(created);
    expect(await ok(await send(rex, { type: 'task.request_plan', taskId: task.id }))).toBe('200');
    expect(await ok(await send(arch, { type: 'task.propose_plan', taskId: task.id, plan: '# Implementation plan\n\n## Approach\nDo the thing.\n\n## Definition of Done\n- the thing works' }))).toBe('200');
    expect(await ok(await send(rex, { type: 'task.offer', taskId: task.id, offerTo: devName, checklist: ['plan approved'] }))).toBe('200');

    // unapproved: the offered developer's claim is refused, naming the missing approval
    const early = await send(dev, { type: 'task.claim', taskId: task.id });
    expect(early.status).not.toBe(200);
    expect(await early.text()).toMatch(/implementation plan/i);

    // the stamp is HUMAN_ONLY — an agent (even the architect) is refused
    const agentStamp = await send(arch, { type: 'task.approve_plan', taskId: task.id });
    expect(agentStamp.status).not.toBe(200);
    expect(await agentStamp.text()).toMatch(/human/i);

    // the human approves — THE regression line: the stamp must reach the DATABASE
    expect((await send(george, { type: 'task.approve_plan', taskId: task.id })).status).toBe(200);
    const [row] = await sql!`select plan_approved_at, state from tasks where id = ${task.id}::uuid`;
    expect(row!['state']).toBe('plan_review');
    expect(row!['plan_approved_at']).not.toBeNull();

    // and only now does the offered claim go through
    const claimed = await j(await send(dev, { type: 'task.claim', taskId: task.id }));
    expect(claimed.task.state).toBe('in_progress');
  });
});
