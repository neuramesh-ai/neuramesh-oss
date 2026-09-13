// Shared compute (0114) against the REAL schema: a workspace's agents run on MEMBERS' machines.
//
// The assertion that matters is the wake lease. Task work was already race-safe — `task.claim` is
// atomic and the host claims before spending a token — but a chat wake was deduped only at the
// reply insert (0060), which happens AFTER generation. With three member machines hosting one
// agent that is three model runs and two discarded answers. The lease moves the race in front of
// the spend, and these tests are what hold it there.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

// Resolved from the fixtures, never hardcoded: a guessed id fails an FK, which surfaces as a 500
// and an assertion about `undefined` rather than the thing under test.
let REX = '';
let rex: Actor;

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

let CH = '';
let MACHINE = '';
beforeAll(async () => {
  if (!sql) return;
  const [c] = await sql`select id from channels where workspace_id = ${WS}::uuid order by slug limit 1`;
  CH = c!['id'] as string;
  // This suite creates its OWN machine and agent rather than reading whatever another test file
  // happened to leave behind. The fixtures ship neither, and depending on a sibling's side
  // effects is precisely the coupling that once made six unrelated tests fail from one cause.
  const [m] = await sql`insert into machines (workspace_id, owner_user_id, name, platform, daemon_version, last_seen_at, runtimes)
    values (${WS}::uuid, ${george.id}::uuid, 'compute-test-host', 'darwin', '1', now(), '["claude-code"]'::jsonb)
    on conflict (workspace_id, name) do update set last_seen_at = now() returning id`;
  MACHINE = m!['id'] as string;
  const [a] = await sql`insert into agents (workspace_id, machine_id, name, role, model)
    values (${WS}::uuid, ${MACHINE}::uuid, 'compute-test-rex', 'orchestrator', 'claude-opus-4-8')
    on conflict (workspace_id, name) do update set machine_id = excluded.machine_id returning id`;
  REX = a!['id'] as string;
  rex = { kind: 'agent', id: REX, role: 'orchestrator' };
});

/** a real message row to be woken by */
async function trigger(text: string): Promise<string> {
  const [m] = await sql!`insert into messages (workspace_id, channel_id, author_kind, author_id, body)
    values (${WS}::uuid, ${CH}::uuid, 'human', ${george.id}::uuid, ${text}) returning id`;
  return m!['id'] as string;
}

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('the wake lease: one member machine generates, the rest stand down', () => {
  it('the second host to open a run for the same trigger LOSES — before it spends anything', async () => {
    const msg = await trigger('shared compute: who answers this?');

    const first = await j(await send(rex, {
      type: 'run.open', workspace: WS, channel: CH, kind: 'wake', title: 'answering', triggerMessageId: msg,
    }));
    expect(first.won).toBe(true);

    // a DIFFERENT host, same agent, same triggering message — a distinct run id, as each daemon
    // mints its own before the round trip
    const second = await j(await send(rex, {
      type: 'run.open', workspace: WS, channel: CH, kind: 'wake', title: 'answering', triggerMessageId: msg,
    }));
    expect(second.won).toBe(false);
    // and it is told WHICH run holds it, so the loser can render "bob's mac is answering"
    expect(second.runId).toBe(first.runId);

    const [n] = await sql!`select count(*) as n from runs where agent_id = ${REX}::uuid and trigger_message_id = ${msg}::uuid`;
    expect(Number(n!['n'])).toBe(1);
  });

  it('a retry by the WINNING host keeps working (same run id, still won)', async () => {
    const msg = await trigger('retry me');
    const id = crypto.randomUUID();
    const a = await j(await send(rex, { type: 'run.open', id, workspace: WS, channel: CH, kind: 'wake', title: 'x', triggerMessageId: msg }));
    const b = await j(await send(rex, { type: 'run.open', id, workspace: WS, channel: CH, kind: 'wake', title: 'x', triggerMessageId: msg }));
    expect(a.won).toBe(true);
    // the same host retrying a dropped response must NOT read as "someone else took it" — that
    // would strand the answer nobody else is going to write
    expect(b.won).toBe(true);
    expect(b.runId).toBe(id);
  });

  it('different triggers do not contend, and task runs are unaffected', async () => {
    const m1 = await trigger('one');
    const m2 = await trigger('two');
    expect((await j(await send(rex, { type: 'run.open', workspace: WS, channel: CH, kind: 'wake', title: 'a', triggerMessageId: m1 }))).won).toBe(true);
    expect((await j(await send(rex, { type: 'run.open', workspace: WS, channel: CH, kind: 'wake', title: 'b', triggerMessageId: m2 }))).won).toBe(true);
    // no trigger = a task/sweep run, deduped by its own claim; the lease must not apply
    expect((await j(await send(rex, { type: 'run.open', workspace: WS, channel: CH, kind: 'work', title: 'c' }))).won).toBe(true);
    expect((await j(await send(rex, { type: 'run.open', workspace: WS, channel: CH, kind: 'work', title: 'd' }))).won).toBe(true);
  });

  it('records WHICH machine served the run — shared compute has to be legible', async () => {
    const msg = await trigger('whose machine?');
    const machineId = MACHINE;
    const r = await j(await send(rex, {
      type: 'run.open', workspace: WS, channel: CH, kind: 'wake', title: 'answering', triggerMessageId: msg, machineId,
    }));
    const [row] = await sql!`select machine_id from runs where id = ${r.runId}::uuid`;
    expect(row!['machine_id']).toBe(machineId);
  });
});

describe.skipIf(!DB)('free is one machine PER MEMBER, not per workspace', () => {
  it("a teammate can register their OWN laptop in a free workspace the owner already hosts", async () => {
    const [w] = await sql!`insert into workspaces (name, slug, created_by, plan)
      values ('Compute Free', ${'compute-free-' + Math.floor(Math.random() * 1e6)}, ${george.id}::uuid, 'free') returning id`;
    const ws = w!['id'] as string;
    await sql!`insert into workspace_members (workspace_id, user_id, role) values (${ws}::uuid, ${george.id}::uuid, 'owner')`;

    // the owner's machine
    expect((await send(george, { type: 'machine.register', workspace: ws, name: 'george-mac', platform: 'darwin', daemonVersion: '1', runtimes: ['claude-code'] })).status).toBe(200);

    // a teammate joins and registers THEIR machine. This used to be MACHINE_LIMIT (402), which
    // made the free plan's 3 seats useless: the teammate could never host, so every request they
    // made was served by — and billed to — the owner's laptop.
    const [u] = await sql!`insert into nm_users (clerk_user_id, email) values ('clerk_compute_mate','mate@compute.dev')
      on conflict (clerk_user_id) do update set email = excluded.email returning id`;
    const mate: Actor = { kind: 'human', id: u!['id'] as string };
    await sql!`insert into workspace_members (workspace_id, user_id, role) values (${ws}::uuid, ${mate.id}::uuid, 'member')`;
    const res = await send(mate, { type: 'machine.register', workspace: ws, name: 'mate-mac', platform: 'darwin', daemonVersion: '1', runtimes: ['codex'] });
    expect(res.status).toBe(200);

    // ...but a member's SECOND machine is still capped on free
    const second = await send(mate, { type: 'machine.register', workspace: ws, name: 'mate-desktop', platform: 'darwin', daemonVersion: '1' });
    expect(second.status).toBe(402);
    expect((await j(second)).code).toBe('MACHINE_LIMIT');
  });

  it('publishes what each machine can serve, so failover can tell busy from incapable', async () => {
    const r = await j(await send(george, { type: 'machine.register', workspace: WS, name: 'cap-probe', platform: 'darwin', daemonVersion: '1', runtimes: ['claude-code', 'codex'] }));
    const [row] = await sql!`select runtimes from machines where id = ${r.machineId}::uuid`;
    expect(row!['runtimes']).toEqual(['claude-code', 'codex']);

    // a register that omits runtimes (an older desktop mid-rollout) must not BLANK them — a
    // machine that looked incapable would be skipped by every peer
    await send(george, { type: 'machine.register', workspace: WS, name: 'cap-probe', platform: 'darwin', daemonVersion: '2' });
    const [after] = await sql!`select runtimes from machines where id = ${r.machineId}::uuid`;
    expect(after!['runtimes']).toEqual(['claude-code', 'codex']);
  });
});
