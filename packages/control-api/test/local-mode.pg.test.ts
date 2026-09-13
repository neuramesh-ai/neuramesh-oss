// The local stack against the REAL schema (0138; source-release round U2, review F1 §5):
//   · the boot seed is idempotent — twice is one user — and a new hash rotates the old one out
//   · an `nmm_` machine token calling task.approve_plan gets HUMAN_ONLY; the `nmh_` bearer approves
//   · the one-machine-per-member cap (MACHINE_LIMIT, pgstore.registerMachine) lifts under NM_LOCAL=1
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import { readdirSync } from 'node:fs';
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { LOCAL_USER, mintLocalToken, seedLocalUser } from '../src/local-auth';
import { mintMachineToken } from '../src/machine-auth';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const send = (headers: Record<string, string>, body: unknown) =>
  app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const asHeader = (actor: Actor) => ({ 'x-nm-actor': JSON.stringify(actor) });
const asBearer = (token: string) => ({ authorization: `Bearer ${token}` });
const verdict = async (r: Response): Promise<string> => `${r.status}${r.status === 200 ? '' : ` ${((await j(r)).code as string) ?? ''}`}`;

let arch: Actor;
let machineToken = '';
beforeAll(async () => {
  if (!sql) return;
  // own machine (with a machine token) + own architect, never a sibling file's leftovers. kind
  // 'member': a laptop row (kind 'local', what machine.register writes) holds no token and never
  // authenticates through the machine lane — machineByTokenHash excludes it by construction.
  const { token, hash } = mintMachineToken();
  machineToken = token;
  const [m] = await sql`insert into machines (workspace_id, owner_user_id, name, platform, daemon_version, last_seen_at, runtimes, token_hash, kind)
    values (${WS}::uuid, ${george.id}::uuid, 'local-mode-host', 'linux', '1', now(), '["claude-code"]'::jsonb, ${hash}, 'member')
    on conflict (workspace_id, name) do update set last_seen_at = now(), token_hash = excluded.token_hash, kind = 'member' returning id`;
  const [a] = await sql`insert into agents (workspace_id, machine_id, name, role, model)
    values (${WS}::uuid, ${m!['id']}::uuid, 'local-mode-arch', 'architect', 'claude-opus-4-8')
    on conflict (workspace_id, name) do update set machine_id = excluded.machine_id returning id`;
  arch = { kind: 'agent', id: a!['id'] as string, role: 'architect' };
  const [ch] = await sql`select id from channels where workspace_id = ${WS}::uuid and slug = 'dev'`;
  await sql`insert into agent_channels (agent_id, channel_id) values (${arch.id}::uuid, ${ch!['id']}::uuid) on conflict do nothing`;
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('the local stack on postgres (real schema)', () => {
  it('0138 landed: nm_users.local_token_hash exists and is unique among non-null values', async () => {
    const [col] = await sql!`select 1 from information_schema.columns where table_name = 'nm_users' and column_name = 'local_token_hash'`;
    expect(col).toBeTruthy();
    const [idx] = await sql!`select indexdef from pg_indexes where tablename = 'nm_users' and indexname = 'nm_users_local_token_hash_key'`;
    expect(String(idx?.['indexdef'])).toMatch(/UNIQUE/);
  });

  it('boots twice, seeds one user; a new hash rotates the old one out', async () => {
    vi.stubEnv('NM_LOCAL', '1');
    const a = mintLocalToken();
    const first = await seedLocalUser(store!, a.hash);
    const again = await seedLocalUser(store!, a.hash);
    expect(again.id).toBe(first.id);
    const [count] = await sql!`select count(*)::int as n from nm_users where clerk_user_id = ${LOCAL_USER.clerkUserId}`;
    expect(Number(count!['n'])).toBe(1);
    expect(await store!.userIdForLocalTokenHash(a.hash)).toBe(first.id);

    const b = mintLocalToken();
    expect((await seedLocalUser(store!, b.hash)).id).toBe(first.id);
    expect(await store!.userIdForLocalTokenHash(a.hash)).toBeNull();
    expect(await store!.userIdForLocalTokenHash(b.hash)).toBe(first.id);
    // the bearer reaches the /v1 gate as that human
    const me = await j(await app!.request('/v1/me', { headers: asBearer(b.token) }));
    expect(me.actor).toEqual({ kind: 'human', id: first.id });
  });

  it('an nmm_ token calling task.approve_plan gets HUMAN_ONLY; the nmh_ bearer approves it', async () => {
    vi.stubEnv('NM_LOCAL', '1');
    const local = mintLocalToken();
    await seedLocalUser(store!, local.hash);
    // a unit in plan_review, born the ordinary way
    const created = await send(asHeader(george), { type: 'task.create', workspace: WS, channel: 'dev', title: 'local mode: who may approve', kind: 'feature' });
    expect(await verdict(created)).toBe('200');
    const { task } = await j(created);
    expect(await verdict(await send(asHeader(rex), { type: 'task.request_plan', taskId: task.id }))).toBe('200');
    expect(await verdict(await send(asHeader(arch), { type: 'task.propose_plan', taskId: task.id, plan: '# Implementation plan\n\n## Approach\nDo the thing.\n\n## Definition of Done\n- the thing works' }))).toBe('200');

    // the daemon's agent lane — the machine token naming the agent that did the work — is an
    // AGENT at the gate, and the gate is human-only
    const withAgentClaim = await send({ ...asBearer(machineToken), ...asHeader(arch) }, { type: 'task.approve_plan', taskId: task.id });
    expect(await verdict(withAgentClaim)).toBe('403 HUMAN_ONLY');
    // a machine token claiming to be a human who is NOT its owner is refused outright
    expect((await send({ ...asBearer(machineToken), ...asHeader({ kind: 'human', id: '00000000-0000-0000-0000-000000000002' }) }, { type: 'task.approve_plan', taskId: task.id })).status).toBe(401);
    // the bare header with the lane closed: nothing
    vi.stubEnv('NM_ALLOW_ACTOR_HEADER', '0');
    expect(await verdict(await send(asHeader(george), { type: 'task.approve_plan', taskId: task.id }))).toBe('401 AUTH_REQUIRED');
    // ABSENT a header the machine acts as its OWNER — machine-auth.ts's standing contract for the
    // cloud daemon's owner-lane calls, unchanged by this round and recorded here as what it is
    const asOwner = await send(asBearer(machineToken), { type: 'task.approve_plan', taskId: task.id });
    expect(asOwner.status).toBe(200);
  });

  it('the nmh_ bearer is a human at the plan gate, and an agent claim through it is not', async () => {
    vi.stubEnv('NM_LOCAL', '1');
    const local = mintLocalToken();
    await seedLocalUser(store!, local.hash);
    const created = await send(asHeader(george), { type: 'task.create', workspace: WS, channel: 'dev', title: 'local mode: the human bearer approves', kind: 'feature' });
    const { task } = await j(created);
    expect(await verdict(await send(asHeader(rex), { type: 'task.request_plan', taskId: task.id }))).toBe('200');
    expect(await verdict(await send(asHeader(arch), { type: 'task.propose_plan', taskId: task.id, plan: '# Implementation plan\n\n## Approach\nDo it.\n\n## Definition of Done\n- done' }))).toBe('200');
    // the bearer naming the architect as author is refused at the gate: the local user is not a
    // member of this fixture workspace, so the claim is illegitimate — refused, never re-attributed
    expect((await send({ ...asBearer(local.token), ...asHeader(arch) }, { type: 'task.approve_plan', taskId: task.id })).status).toBe(403);
    const approved = await send(asBearer(local.token), { type: 'task.approve_plan', taskId: task.id });
    expect(await verdict(approved)).toBe('200');
    const [row] = await sql!`select plan_approved_at, state from tasks where id = ${task.id}::uuid`;
    expect(row!['plan_approved_at']).toBeTruthy();
  });

  it('MACHINE_LIMIT (one machine per member on Free) lifts under NM_LOCAL=1', async () => {
    // a workspace of this file's own, pinned to Free: six sibling suites move the fixture
    // workspace to the cloud plan, and they run in any order
    const [ws] = await sql!`insert into workspaces (name, slug, created_by, plan) values ('Local mode', 'local-mode-free', ${george.id}::uuid, 'free')
      on conflict (slug) do update set plan = 'free' returning id`;
    const mine = ws!['id'] as string;
    await sql!`insert into workspace_members (workspace_id, user_id, role) values (${mine}::uuid, ${george.id}::uuid, 'owner') on conflict do nothing`;
    const register = (name: string) => send(asHeader(george), { type: 'machine.register', workspace: mine, name, platform: 'darwin', daemonVersion: '1' });
    // fresh names every run: the smoke's pg-lane database persists across runs, and re-registering
    // a name george already holds is the heartbeat path, which the cap rightly lets through
    const run = Date.now().toString(36);
    // the first fresh name registers — or trips the cap, when an earlier run left a machine behind
    expect(['200', '402 MACHINE_LIMIT']).toContain(await verdict(await register(`local-mode-laptop-${run}-a`)));
    expect(await verdict(await register(`local-mode-laptop-${run}-b`))).toBe('402 MACHINE_LIMIT');
    vi.stubEnv('NM_LOCAL', '1');
    expect(await verdict(await register(`local-mode-laptop-${run}-b`))).toBe('200');
  });

  it('schemaVersion reads the runner\'s table: null where the lane applied SQL by hand, the last migration where migrate.mjs ran', async () => {
    // scripts/test-pg.sh never creates schema_migrations; the local-stack smoke's pg-lane stack
    // (migrated by the image's runner) does — both are honest answers, and nm-config reports them
    const last = readdirSync(new URL('../../../supabase/migrations', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().at(-1)!;
    expect([null, last]).toContain(await store!.schemaVersion());
  });
});
