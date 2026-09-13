// The ship gate (docs/23) against the REAL schema — migration 0070's enum values,
// the nm_task_state_guard pairs, tasks.ship_plan jsonb round-tripping, ship-plan
// artifact promotion, and projects.ship_gate (default ON, backfilled onto rows
// that predate the flag). Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const REPO = 'b0000000-0000-0000-0000-000000000001';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: '30000000-0000-0000-0000-000000000003', role: 'worker' };
const gem: Actor = { kind: 'agent', id: '40000000-0000-0000-0000-000000000004', role: 'reviewer' };
const bosun: Actor = { kind: 'agent', id: '50000000-0000-0000-0000-000000000005', role: 'shipper' };

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

async function throughReview(title: string, project = 'dev') {
  const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', project, title, repo: { id: REPO, baseRef: 'main' } }));
  expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
  expect((await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['repo access'] })).status).toBe(200);
  expect(
    (
      await send(patch, {
        type: 'task.submit',
        taskId: task.id,
        artifacts: [{ kind: 'diff', name: 'ship.diff', content: 'diff --git a/x b/x\n+y' }],
        sha: 'abc1234',
        prUrl: 'https://github.com/acme/marketing-site/pull/42',
        prNumber: 42,
      })
    ).status,
  ).toBe(200);
  expect((await send(gem, { type: 'task.approve', taskId: task.id })).status).toBe(200);
  return task as { id: string; number: number };
}

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('the ship gate on postgres (real schema + triggers)', () => {
  it('runs the gate end to end: claim_ship → propose → human approve → ticks → execute_ship', async () => {
    const task = await throughReview('ship the auto-update card');

    expect((await j(await send(bosun, { type: 'task.claim_ship', taskId: task.id }))).task.state).toBe('shipping');
    const propose = await send(bosun, {
      type: 'task.propose_ship_plan',
      taskId: task.id,
      report: '# Release plan\nRollback: redeploy previous build.',
      risk: 'medium',
      summary: 'one env var + sync rules',
      round: 1,
      items: [
        { id: 'ci', title: 'CI green on PR #42', owner: 'shipper', auto: 'ci', state: 'done' },
        { id: 'env', title: 'Set NM_UPDATE_FEED in Vercel prod', owner: 'human' },
      ],
    });
    expect(propose.status).toBe(200);
    const proposed = (await j(propose)).task;
    expect(proposed.state).toBe('ship_review');
    expect(proposed.shipPlan.items).toHaveLength(2);

    // HUMAN_ONLY: every agent bounces off the plan approval
    expect((await j(await send(bosun, { type: 'task.approve_ship_plan', taskId: task.id }))).code).toBe('HUMAN_ONLY');
    expect((await j(await send(rex, { type: 'task.approve_ship_plan', taskId: task.id }))).code).toBe('HUMAN_ONLY');
    const approved = (await j(await send(george, { type: 'task.approve_ship_plan', taskId: task.id }))).task;
    expect(approved.state).toBe('releasing');
    expect(approved.shipPlan.status).toBe('approved');

    // the approved plan artifact joined the channel library atomically
    const [art] = await sql!`select promoted from artifacts where task_id = ${task.id} and kind = 'ship' and name = 'ship-plan-v1.md'`;
    expect(art!['promoted']).toBe(true);

    // an agent can NEVER tick the human item; execute is refused while it's pending
    expect((await send(bosun, { type: 'task.check_ship_item', taskId: task.id, itemId: 'env', state: 'done' })).status).toBe(403);
    const early = await send(bosun, { type: 'task.execute_ship', taskId: task.id });
    expect(early.status).toBe(422);
    expect((await j(early)).code).toBe('SHIP_ITEMS_PENDING');

    expect((await send(george, { type: 'task.check_ship_item', taskId: task.id, itemId: 'env', state: 'done' })).status).toBe(200);
    const shipped = (await j(await send(bosun, { type: 'task.execute_ship', taskId: task.id }))).task;
    // docs/23 v2: the merge + post-merge verification live in verifying —
    // accepted arrives only with the host's confirm_release
    expect(shipped.state).toBe('verifying');
    const confirmed = (await j(await send(bosun, { type: 'task.confirm_release', taskId: task.id, note: 'post-merge checks green' }))).task;
    expect(confirmed.state).toBe('accepted');

    // the jsonb round-trips with the audit fields the ticks stamped
    const [row] = await sql!`select ship_plan from tasks where id = ${task.id}`;
    const plan = row!['ship_plan'] as { items: Array<{ id: string; checkedBy: { kind: string } | null }> };
    expect(plan.items.find((i) => i.id === 'env')!.checkedBy).toEqual({ kind: 'human', id: george.id });
  });

  it('the DB trigger rejects a gate-skipping raw write (done → releasing / done → verifying)', async () => {
    const task = await throughReview('trigger defense-in-depth');
    await expect(sql!`update tasks set state = 'releasing' where id = ${task.id}`).rejects.toThrow(/illegal task transition/);
    // verifying is only reachable from releasing — never straight from done
    await expect(sql!`update tasks set state = 'verifying' where id = ${task.id}`).rejects.toThrow(/illegal task transition/);
    // while the legal pairs pass at the trigger level
    await sql!`update tasks set state = 'shipping' where id = ${task.id}`;
    const [r] = await sql!`select state from tasks where id = ${task.id}`;
    expect(r!['state']).toBe('shipping');
  });

  it('ship_gate defaults ON for pre-flag projects and OFF refuses claim_ship', async () => {
    // the fixture-era rows were consolidated by the projects migrations into one
    // default project that predates 0070 — the column default backfilled it to true
    const [proj] = await sql!`select p.id, p.ship_gate from projects p join channels c on c.project_id = p.id
      where c.workspace_id = ${WS} and c.slug = 'dev'`;
    expect(proj!['ship_gate']).toBe(true);

    // flip the gate off on the channel's own project (a task's project is its
    // channel's project, derived) — claim_ship must bounce; restore it after.
    expect((await send(george, { type: 'project.update', project: proj!['id'] as string, shipGate: false })).status).toBe(200);
    try {
      const task = await throughReview('gate-off task');
      const claim = await send(bosun, { type: 'task.claim_ship', taskId: task.id });
      expect(claim.status).toBe(403);
      // the classic human accept still ships it
      expect((await j(await send(george, { type: 'task.accept', taskId: task.id }))).task.state).toBe('accepted');
    } finally {
      await send(george, { type: 'project.update', project: proj!['id'] as string, shipGate: true });
    }
  });
});
