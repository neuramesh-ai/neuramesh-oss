// Model config packs against the REAL schema (migration 0047 + the allow-list + provenance flag).
// Run via scripts/test-pg.sh / ci-db-bootstrap.sh — skipped without DATABASE_URL.
import { PACKS, runtimeForModel, type Actor, type AgentRole } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

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

let ws = '';
let agentId = '';

beforeAll(async () => {
  if (!DB) return;
  // an ISOLATED workspace so we never race loop.pg.test.ts on the shared DB
  expect((await send(george, { type: 'workspace.create', name: 'Packs Test', slug: 'packs-test' })).status).toBe(200);
  ws = (await sql!`select id from workspaces where slug = 'packs-test'`)[0]!['id'] as string;
  expect((await send(george, { type: 'machine.register', workspace: ws, name: 'pack-mac' })).status).toBe(200);
  const machineId = (await sql!`select id from machines where workspace_id = ${ws}::uuid and name = 'pack-mac'`)[0]!['id'] as string;
  expect((await send(george, { type: 'agent.register', workspace: ws, machineId, name: 'tmpdev', role: 'developer', model: 'claude-opus-4-8', runtime: 'claude-code', channels: ['build'] })).status).toBe(200);
  agentId = (await sql!`select id from agents where workspace_id = ${ws}::uuid and name = 'tmpdev'`)[0]!['id'] as string;
});

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

const packCol = async () => (await sql!`select active_model_pack from workspaces where id = ${ws}::uuid`)[0]!['active_model_pack'] as string;
const agentRow = async () => (await sql!`select model, model_source from agents where id = ${agentId}::uuid`)[0]!;

describe.skipIf(!DB)('model config packs (real schema)', () => {
  it('a new workspace defaults to the "custom" sentinel (no pack managing); a new agent is model_source=pack', async () => {
    expect(await packCol()).toBe('custom');
    expect((await agentRow())['model_source']).toBe('pack');
  });

  it('workspace.update {activeModelPack} persists and round-trips via listWorkspaces', async () => {
    expect((await send(george, { type: 'workspace.update', workspace: ws, activeModelPack: 'claude-core' })).status).toBe(200);
    expect(await packCol()).toBe('claude-core');
    const mine = (await store!.listWorkspaces(george.id)).find((w) => w.id === ws);
    expect(mine?.activeModelPack).toBe('claude-core');
  });

  it('sending only autoFailover does NOT clobber active_model_pack (per-column coalesce)', async () => {
    expect((await send(george, { type: 'workspace.update', workspace: ws, autoFailover: true })).status).toBe(200);
    expect(await packCol()).toBe('claude-core'); // untouched
    expect((await sql!`select auto_failover from workspaces where id = ${ws}::uuid`)[0]!['auto_failover']).toBe(true);
  });

  it('rejects an unknown model pack id', async () => {
    expect((await send(george, { type: 'workspace.update', workspace: ws, activeModelPack: 'not-a-pack' })).status).toBe(400);
  });

  it('the orchestrator may move the pack POINTER (human-confirmed failover) but not policy', async () => {
    // the capacity-failover executor re-seats every agent as the orchestrator, then moves
    // this pointer. It used to 403 and be swallowed, leaving the workspace disagreeing
    // with its own seats — so the next pack apply silently reverted the switch.
    const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
    expect((await send(rex, { type: 'workspace.update', workspace: ws, activeModelPack: 'openai-core' })).status).toBe(200);
    expect(await packCol()).toBe('openai-core');
    // policy toggles stay human-only — an agent must never flip auto-failover on itself
    expect((await send(rex, { type: 'workspace.update', workspace: ws, autoFailover: true })).status).toBe(403);
    // …not even alongside a legitimate pack move
    expect((await send(rex, { type: 'workspace.update', workspace: ws, activeModelPack: 'claude-core', autoFailover: false })).status).toBe(403);
    expect(await packCol()).toBe('openai-core'); // the refused command changed nothing
    // a worker agent has no business here at all
    expect((await send({ kind: 'agent', id: 'patch', role: 'developer' } as Actor, { type: 'workspace.update', workspace: ws, activeModelPack: 'claude-core' })).status).toBe(403);
    await send(george, { type: 'workspace.update', workspace: ws, activeModelPack: 'claude-core' }); // restore for later cases
  });

  it('a human brain edit stamps model_source=manual; an explicit pack source flips it back', async () => {
    expect((await send(george, { type: 'agent.update', agent: agentId, model: 'claude-sonnet-4-6' })).status).toBe(200);
    let r = await agentRow();
    expect(r['model']).toBe('claude-sonnet-4-6');
    expect(r['model_source']).toBe('manual'); // a deliberate human pin — pack-apply must skip it

    expect((await send(george, { type: 'agent.update', agent: agentId, model: 'claude-opus-4-8', modelSource: 'pack' })).status).toBe(200);
    r = await agentRow();
    expect(r['model']).toBe('claude-opus-4-8');
    expect(r['model_source']).toBe('pack');
  });

  it('rejects an unknown model id at the boundary (allow-list), but accepts a legacy id', async () => {
    // the id the user originally referenced — never existed
    expect((await send(george, { type: 'agent.update', agent: agentId, model: 'gemini-3.1-pro' })).status).toBe(400);
    // a retired-but-routable id stays editable so existing agents aren't bricked
    expect((await send(george, { type: 'agent.update', agent: agentId, model: 'gemini-2.5-pro' })).status).toBe(200);
  });

  it('enabledProviders reports CONFIGURED providers — incl. a tokenless subscription, excl. unset', async () => {
    expect((await send(george, { type: 'credential.set', workspace: ws, provider: 'anthropic', scope: 'workspace', authMode: 'subscription' })).status).toBe(200);
    expect((await send(george, { type: 'credential.set', workspace: ws, provider: 'openai', scope: 'workspace', authMode: 'apikey', token: 'sk-test-token-123' })).status).toBe(200);
    const enabled = await store!.enabledProviders(ws);
    expect(enabled.has('anthropic')).toBe(true); // presence-of-row, NOT presence-of-token
    expect(enabled.has('openai')).toBe(true);
    expect(enabled.has('gemini')).toBe(false); // never configured
  });

  it('applying a pack re-materializes pack-managed agents but LEAVES MANUAL PINS untouched (override-safe)', async () => {
    // tmpdev is model_source='manual' (gemini-2.5-pro) from the prior edits. Add a fresh pack agent.
    const machineId = (await sql!`select id from machines where workspace_id = ${ws}::uuid and name = 'pack-mac'`)[0]!['id'] as string;
    expect((await send(george, { type: 'agent.register', workspace: ws, machineId, name: 'packdev', role: 'developer', model: 'claude-opus-4-8', runtime: 'claude-code', channels: ['build'] })).status).toBe(200);

    // the EXACT targeting nm:apply-pack uses: pack-managed, non-remote
    const targets = await sql!`select id, role from agents where workspace_id = ${ws}::uuid and model_source = 'pack' and coalesce(kind, 'local') != 'remote'`;
    const ids = targets.map((t) => t['id'] as string);
    const packdevId = (await sql!`select id from agents where workspace_id = ${ws}::uuid and name = 'packdev'`)[0]!['id'] as string;
    expect(ids).toContain(packdevId);
    expect(ids).not.toContain(agentId); // the manual pin (tmpdev) is excluded

    // apply gemini-core to the targets (mirrors the IPC), then persist the pack id LAST
    for (const t of targets) {
      const model = PACKS['gemini-core']!.roles[t['role'] as AgentRole];
      expect((await send(george, { type: 'agent.update', agent: t['id'] as string, model, runtime: runtimeForModel(model), modelSource: 'pack' })).status).toBe(200);
    }
    expect((await send(george, { type: 'workspace.update', workspace: ws, activeModelPack: 'gemini-core' })).status).toBe(200);

    const pd = (await sql!`select model, model_source from agents where id = ${packdevId}::uuid`)[0]!;
    // assert against the live catalog, not a literal — pack seats are benchmark-driven and move
    // (the 2026-07-02 seat update turned the old hard-coded 'gemini-3.5-flash' into a CI break)
    expect(pd['model']).toBe(PACKS['gemini-core']!.roles.developer);
    expect(pd['model_source']).toBe('pack');
    const td = (await sql!`select model, model_source from agents where id = ${agentId}::uuid`)[0]!;
    expect(td['model_source']).toBe('manual');
    expect(td['model']).toBe('gemini-2.5-pro'); // UNTOUCHED by the pack apply
    expect(await packCol()).toBe('gemini-core');
  });
});

// Custom brains (user-authored packs, migration 0065): CRUD via commands, activation via
// workspace.update, and the no-dangling-active-id invariant. Sequential within the describe.
describe.skipIf(!DB)('custom brains (user-authored packs)', () => {
  const roles = {
    orchestrator: 'claude-sonnet-4-6', architect: 'claude-opus-4-8',
    developer: 'claude-haiku-4-5', worker: 'claude-haiku-4-5',
    reviewer: 'gemini-3.5-flash', designer: 'claude-sonnet-5', shipper: 'claude-sonnet-5',
    sales: 'gemini-3.1-flash-lite', curator: 'gemini-3.1-flash-lite', marketer: 'claude-sonnet-5',
  };
  let packId = '';

  it('a human saves a custom brain; the id is custom:-prefixed and GET /v1/model-packs lists it', async () => {
    const r = await send(george, { type: 'modelpack.save', workspace: ws, name: 'Weekend budget', roles });
    expect(r.status).toBe(200);
    packId = (await j(r)).packId as string;
    expect(packId.startsWith('custom:')).toBe(true);
    const res = await app!.request(`/v1/model-packs?workspace=${ws}`, { headers: { 'x-nm-actor': JSON.stringify(george) } });
    expect(res.status).toBe(200);
    const { packs } = await j(res);
    const mine = packs.find((p: { id: string }) => p.id === packId);
    expect(mine?.name).toBe('Weekend budget');
    expect(mine?.roles?.designer).toBe('claude-sonnet-5'); // designer is a first-class seat
  });

  it('agents cannot manage brains — human-only, like every workspace setting', async () => {
    const orch: Actor = { kind: 'agent', id: agentId, role: 'orchestrator' };
    expect((await send(orch, { type: 'modelpack.save', workspace: ws, name: 'sneaky', roles })).status).toBe(403);
    expect((await send(orch, { type: 'modelpack.delete', workspace: ws, packId })).status).toBe(403);
  });

  it('duplicate names are a clean conflict (case-insensitive), not a mystery twin', async () => {
    expect((await send(george, { type: 'modelpack.save', workspace: ws, name: 'weekend BUDGET', roles })).status).toBe(409);
  });

  it('rejects an incomplete, split-alias, or unroutable roles map at the boundary', async () => {
    const { worker: _w, ...holey } = roles as Record<string, string>;
    expect((await send(george, { type: 'modelpack.save', workspace: ws, name: 'holey', roles: holey })).status).toBe(400);
    expect((await send(george, { type: 'modelpack.save', workspace: ws, name: 'split', roles: { ...roles, worker: 'claude-opus-4-8' } })).status).toBe(400); // worker must alias developer
    expect((await send(george, { type: 'modelpack.save', workspace: ws, name: 'typo', roles: { ...roles, developer: 'gpt-9', worker: 'gpt-9' } })).status).toBe(400); // allow-list holds for custom brains too
  });

  it('activating a custom brain persists; an unknown custom id cannot persist', async () => {
    expect((await send(george, { type: 'workspace.update', workspace: ws, activeModelPack: 'custom:00000000-0000-0000-0000-000000000000' })).status).toBe(422);
    expect((await send(george, { type: 'workspace.update', workspace: ws, activeModelPack: packId })).status).toBe(200);
    expect(await packCol()).toBe(packId);
    const mine = (await store!.listWorkspaces(george.id)).find((w) => w.id === ws);
    expect(mine?.activeModelPack).toBe(packId);
  });

  it('editing by packId updates in place — same id, new name + seats', async () => {
    const r = await send(george, { type: 'modelpack.save', workspace: ws, packId, name: 'Weekend budget v2', roles: { ...roles, designer: 'claude-opus-4-8' } });
    expect(r.status).toBe(200);
    expect((await j(r)).packId).toBe(packId);
    const packs = await store!.listModelPacks(ws);
    expect(packs.find((p) => p.id === packId)?.name).toBe('Weekend budget v2');
    expect(packs.find((p) => p.id === packId)?.roles['designer']).toBe('claude-opus-4-8');
  });

  it('deleting the ACTIVE brain resets the workspace to the sentinel — never a dangling id', async () => {
    expect(await packCol()).toBe(packId);
    expect((await send(george, { type: 'modelpack.delete', workspace: ws, packId })).status).toBe(200);
    expect(await packCol()).toBe('custom');
    expect(await store!.listModelPacks(ws)).toEqual([]);
    expect((await send(george, { type: 'modelpack.delete', workspace: ws, packId })).status).toBe(404); // gone is gone
  });
});
