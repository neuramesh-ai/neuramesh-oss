// agent.retire against the REAL schema (migration 0054): human-only, refused while
// the agent holds open work, idempotent, unpublishes the A2A card, drops the agent
// from offer resolution + the retro's active roster — while every event/task
// attribution row survives (docs/13 derived history). Register-same-name rehires.
// Runs in its OWN workspace so other pg suites can't collide. Run via scripts/test-pg.sh.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

const card = (agentId: string) => app!.request(`/a2a/agents/${agentId}/card.json`);

// an agent-issued hire needs its confirmation card on file first (guards.ts requireConfirmCard,
// 2026-08-18) — the fixture posts one naming the agent, exactly as executeHire's real flow does
const hireCard = (actor: Actor, workspace: string, channel: string, name: string) =>
  app!.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify({ workspace, channel, body: '```nmq\n' + JSON.stringify({ question: `Hire @${name} into #general?`, options: [{ label: `Hire @${name}` }, { label: 'Not now' }] }) + '\n```' }),
  });

afterAll(async () => {
  await store?.close();
});

describe.skipIf(!DB)('agent.retire (soft, human-only, real schema)', () => {
  it('retires only when idle, keeps history, unpublishes the card, and rehires on re-register', async () => {
    const ws = await j(await send(george, { type: 'workspace.create', name: 'Retire Lab', slug: 'retire-lab' }));
    const WS: string = ws.workspaceId;
    const mach = await j(await send(george, { type: 'machine.register', workspace: WS, name: 'retire-rig', platform: 'darwin', daemonVersion: '0.1.0' }));
    const wReg = await j(await send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'probe-worker', role: 'worker', channels: ['general'] }));
    const rReg = await j(await send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'probe-reviewer', role: 'reviewer', channels: ['general'] }));
    const patch: Actor = { kind: 'agent', id: wReg.agentId, role: 'worker' };
    const gem: Actor = { kind: 'agent', id: rReg.agentId, role: 'reviewer' };

    // retirement is a staffing decision — HUMAN-ONLY (agents can't fire each other)
    expect((await j(await send(gem, { type: 'agent.retire', agent: wReg.agentId }))).code).toBe('HUMAN_ONLY');

    // open work blocks retirement at every live stage: offered → claimed → in_review
    const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'general', title: 'last assignment', kind: 'feature', offerTo: 'probe-worker' }));
    const offered = await j(await send(george, { type: 'agent.retire', agent: wReg.agentId }));
    expect(offered.code).toBe('CONFLICT');
    expect(offered.error).toContain(`#${task.number}`);
    expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
    await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['retire fixture'] });
    await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'doc', name: 'out.md', content: '# done' }] });
    expect((await j(await send(george, { type: 'agent.retire', agent: wReg.agentId }))).code).toBe('CONFLICT');

    // done = finished work awaiting the human accept, which doesn't need the agent
    expect((await send(gem, { type: 'task.approve', taskId: task.id })).status).toBe(200);
    expect((await card(wReg.agentId)).status).toBe(200); // published while active
    const retire = await j(await send(george, { type: 'agent.retire', agent: wReg.agentId }));
    expect(retire).toMatchObject({ ok: true, agentId: wReg.agentId, alreadyRetired: false });

    // idempotent: second retire is a no-op, not a second event
    expect((await j(await send(george, { type: 'agent.retire', agent: wReg.agentId }))).alreadyRetired).toBe(true);

    const sql = postgres(DB!);
    try {
      const [row] = await sql`select retired_at, status from agents where id = ${wReg.agentId}`;
      expect(row!['retired_at']).not.toBeNull();
      expect(row!['status']).toBe('offline');
      // the append-only spine records the retirement exactly once; nothing else is deleted
      const [ev] = await sql`select count(*) as n from events where type = 'agent.retired' and target = ${'agent:' + wReg.agentId}`;
      expect(Number(ev!['n'])).toBe(1);
      const [attributed] = await sql`select count(*) as n from tasks where assignee_id = ${wReg.agentId}`;
      expect(Number(attributed!['n'])).toBe(1); // task attribution survives (docs/13 sources)
    } finally {
      await sql.end();
    }

    // A2A discovery unpublishes; offers can no longer target the retired agent
    expect((await card(wReg.agentId)).status).toBe(404);
    const { task: t2 } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'general', title: 'nobody home', kind: 'feature' }));
    const offer = await j(await send(george, { type: 'task.offer', taskId: t2.id, offerTo: 'probe-worker' }));
    expect(offer.code).toBe('NOT_PERMITTED');
    expect(offer.error).toContain('retired');

    // the retro's cards show the active roster only — but the org row still counts
    // the retiree's history (aggregated from tasks/events, not the roster)
    expect((await send(george, { type: 'task.accept', taskId: task.id })).status).toBe(200);
    const retro = await j(await app!.request(`/v1/retro?workspace=${WS}&range=week`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(retro.agents.map((a: any) => a.name)).not.toContain('probe-worker');
    expect(retro.agents.map((a: any) => a.name)).toContain('probe-reviewer');
    expect(retro.org.accepted).toBe(1);

    // rehire = register the same name: same row/identity, card republished, retro card back
    const reReg = await j(await send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'probe-worker', role: 'worker', channels: ['general'] }));
    expect(reReg.agentId).toBe(wReg.agentId);
    expect((await card(wReg.agentId)).status).toBe(200);
    const retro2 = await j(await app!.request(`/v1/retro?workspace=${WS}&range=week`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    const rehired = retro2.agents.find((a: any) => a.name === 'probe-worker');
    expect(rehired).toBeTruthy();
    expect(rehired.counts.accepted).toBe(1); // history reattached, nothing was lost
  });

  it('specialty brief (0056): persists on register, survives briefless upserts and rehire', async () => {
    const ws = await j(await send(george, { type: 'workspace.create', name: 'Brief Lab', slug: 'brief-lab' }));
    const WS: string = ws.workspaceId;
    const mach = await j(await send(george, { type: 'machine.register', workspace: WS, name: 'brief-rig', platform: 'darwin', daemonVersion: '0.1.0' }));
    const orch: Actor = { kind: 'agent', id: '50000000-0000-0000-0000-000000000005', role: 'orchestrator' };
    const brief = 'SEO/competitive analysis — report-style deliverables';

    // the hire path: the ORCHESTRATOR posts the hire card, then registers a specialist with a brief
    await hireCard(orch, WS, 'general', 'seo-analyst');
    const reg = await j(await send(orch, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'seo-analyst', role: 'worker', brief, channels: ['general'] }));
    const sql = postgres(DB!);
    try {
      const briefOf = async () => (await sql`select brief from agents where id = ${reg.agentId}`)[0]!['brief'];
      expect(await briefOf()).toBe(brief);
      // a briefless re-register (e.g. the daemon's channel re-sync) keeps the stored remit
      await send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'seo-analyst', role: 'worker', channels: ['general'] });
      expect(await briefOf()).toBe(brief);
      // retire → rehire round-trips it too (the coalesce in the upsert)
      expect((await send(george, { type: 'agent.retire', agent: reg.agentId })).status).toBe(200);
      await send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'seo-analyst', role: 'worker', channels: ['general'] });
      const [row] = await sql`select brief, retired_at from agents where id = ${reg.agentId}`;
      expect(row!['brief']).toBe(brief);
      expect(row!['retired_at']).toBeNull();
    } finally {
      await sql.end();
    }
  });

  // The two strings against the REAL column (0110). The pg path is where '' has to CLEAR:
  // coalesce(null, col) cannot tell "leave it alone" from "the human emptied the field", so
  // updateAgent uses a case expression instead — this is the test that keeps it honest.
  it('description + brief (0110): persist, coalesce on rehire, and clear on empty', async () => {
    const ws = await j(await send(george, { type: 'workspace.create', name: 'Remit Lab', slug: 'remit-lab' }));
    const WS: string = ws.workspaceId;
    const mach = await j(await send(george, { type: 'machine.register', workspace: WS, name: 'remit-rig', platform: 'darwin', daemonVersion: '0.1.0' }));
    const orch: Actor = { kind: 'agent', id: '50000000-0000-0000-0000-000000000006', role: 'orchestrator' };
    const description = 'Drafts platform-native social copy. Route posts, campaigns and messaging here.';
    const brief = 'One concrete claim per post. Never publish — every post is a draft the human approves.';

    await hireCard(orch, WS, 'general', 'quill');
    const reg = await j(await send(orch, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'quill', role: 'marketer', description, brief, channels: ['general'] }));
    const sql = postgres(DB!);
    try {
      const strings = async () => (await sql`select description, brief from agents where id = ${reg.agentId}`)[0]!;
      expect(await strings()).toMatchObject({ description, brief });

      // the card advertises the AGENT, not the role default
      expect((await j(await card(reg.agentId))).description).toBe(description);

      // a re-register that omits both keeps them (the daemon's channel re-sync)
      await send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'quill', role: 'marketer', channels: ['general'] });
      expect(await strings()).toMatchObject({ description, brief });

      // a human rewrites the instructions; the description is untouched
      expect((await send(george, { type: 'agent.update', agent: reg.agentId, brief: 'Two claims per post now.' })).status).toBe(200);
      expect(await strings()).toMatchObject({ description, brief: 'Two claims per post now.' });

      // '' clears rather than being ignored — and the card falls back to the role default
      expect((await send(george, { type: 'agent.update', agent: reg.agentId, description: '' })).status).toBe(200);
      expect((await strings())['description']).toBeNull();
      expect((await j(await card(reg.agentId))).description).toMatch(/NeuraMesh/);

      // the orchestrator can re-seat the brain but never rewrite the remit
      expect((await send(orch, { type: 'agent.update', agent: reg.agentId, model: 'claude-opus-4-8' })).status).toBe(200);
      const denied = await send(orch, { type: 'agent.update', agent: reg.agentId, description: 'mine now' });
      expect(denied.status).toBe(403);
      expect((await j(denied)).code).toBe('HUMAN_ONLY');
    } finally {
      await sql.end();
    }
  });
});
