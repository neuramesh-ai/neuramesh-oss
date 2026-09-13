import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

// The ship stage (docs/23), end to end over HTTP: reviewer-approved, PR-backed
// work is claimed by the channel shipper, a readiness plan is proposed, a HUMAN
// approves it, owners tick their items, and the shipper's merge (execute_ship)
// is structurally refused until the list clears. The direct human accept stays
// legal from every ship state — the gate is a paved road, never a cage.

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'worker' };
const gem: Actor = { kind: 'agent', id: 'gem', role: 'reviewer' };
const bosun: Actor = { kind: 'agent', id: 'bosun', role: 'shipper' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

const PLAN_ITEMS = [
  { id: 'ci', title: 'CI green on PR #158', owner: 'shipper', auto: 'ci', state: 'done' },
  { id: 'env', title: 'Add NM_UPDATE_FEED to Vercel prod env', owner: 'human' },
  { id: 'merge-verify', title: 'Verify prod serves the new bundle', owner: 'shipper' },
];

async function taskThroughReview(extra: Record<string, unknown> = {}) {
  const res = await send(george, {
    type: 'task.create',
    workspace: 'ws_acme',
    channel: 'dev',
    project: 'marketing-site',
    title: 'add auto-update card',
    kind: 'feature',
    repo: { id: 'acme/marketing-site', baseRef: 'main' },
    ...extra,
  });
  expect(res.status).toBe(200);
  const { task } = await j(res);
  expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
  expect((await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['repo access'] })).status).toBe(200);
  expect(
    (
      await send(patch, {
        type: 'task.submit',
        taskId: task.id,
        artifacts: [{ kind: 'screenshot', name: 'after.png' }],
        sha: '8f3c2d1',
        prUrl: 'https://github.com/acme/marketing-site/pull/158',
        prNumber: 158,
      })
    ).status,
  ).toBe(200);
  expect((await send(gem, { type: 'task.approve', taskId: task.id })).status).toBe(200);
  return task as { id: string; number: number };
}

async function proposePlan(taskId: string, round = 1) {
  return send(bosun, {
    type: 'task.propose_ship_plan',
    taskId,
    report: '# Release plan\nSmall change; one env var; rollback = redeploy previous build.',
    risk: 'medium',
    summary: 'desktop card + one env var',
    round,
    items: PLAN_ITEMS,
  });
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('the ship gate, end to end', () => {
  it('the shipper\'s shipping beats: a post-transition settle is refused, acceptance settles it (#1018)', async () => {
    // the exact screenshot shape: bosun declares its shipping set, "Propose the release
    // plan" goes active, propose_ship_plan transitions shipping → ship_review — and the
    // gate (no BEAT_PHASE_ROLES entry for the human's ship_review) refuses a late settle.
    // The write stays refused BY DESIGN; what must never happen again is the beat
    // surviving acceptance still pulsing — execute_ship reaching accepted settles it.
    const task = await taskThroughReview();
    expect((await send(bosun, { type: 'task.claim_ship', taskId: task.id })).status).toBe(200);
    expect((await send(bosun, { type: 'beats.declare', taskId: task.id, phase: 'shipping', items: ['Study the diff, PR deploy notes and CI', 'Scan for migrations · env vars · sync rules', 'Draft rollout order and rollback', 'Propose the release plan'] })).status).toBe(200);
    for (const seq of [0, 1, 2]) await send(bosun, { type: 'beats.advance', taskId: task.id, seq, status: 'done' });
    await send(bosun, { type: 'beats.advance', taskId: task.id, seq: 3, status: 'active' });
    expect((await proposePlan(task.id)).status).toBe(200); // → ship_review
    // the late settle the old flow attempted — refused, and that's correct
    expect((await send(bosun, { type: 'beats.advance', taskId: task.id, seq: 3, status: 'done' })).status).toBe(403);
    expect((await send(george, { type: 'task.approve_ship_plan', taskId: task.id })).status).toBe(200);
    expect((await send(george, { type: 'task.check_ship_item', taskId: task.id, itemId: 'env', state: 'done' })).status).toBe(200);
    expect((await send(bosun, { type: 'task.check_ship_item', taskId: task.id, itemId: 'merge-verify', state: 'done' })).status).toBe(200);
    // execute_ship now lands in verifying (docs/23 v2) — and that is already
    // "all agent work ended", so the backstop settles the pulsing beat HERE,
    // not only at acceptance (a verifying task must never pulse).
    expect((await j(await send(bosun, { type: 'task.execute_ship', taskId: task.id }))).task.state).toBe('verifying');
    const beats = await store.listBeats(task.id);
    expect(beats.map((b) => b.status)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('runs done → claim_ship → propose → human approve → ticks → execute_ship → verifying → confirm_release → accepted', async () => {
    const task = await taskThroughReview();

    const claim = await send(bosun, { type: 'task.claim_ship', taskId: task.id });
    expect(claim.status).toBe(200);
    expect((await j(claim)).task.state).toBe('shipping');

    const propose = await proposePlan(task.id);
    expect(propose.status).toBe(200);
    const proposed = (await j(propose)).task;
    expect(proposed.state).toBe('ship_review');
    expect(proposed.shipPlan.status).toBe('draft');
    expect(proposed.shipPlan.items).toHaveLength(3);
    // the host-verified CI item arrived pre-checked, stamped to the shipper
    expect(proposed.shipPlan.items[0].state).toBe('done');
    expect(proposed.shipPlan.items[0].checkedBy).toEqual({ kind: 'agent', id: 'bosun' });

    // executing early is impossible from ship_review (no such edge)…
    expect((await send(bosun, { type: 'task.execute_ship', taskId: task.id })).status).toBe(409);

    const approve = await send(george, { type: 'task.approve_ship_plan', taskId: task.id });
    expect(approve.status).toBe(200);
    const approved = (await j(approve)).task;
    expect(approved.state).toBe('releasing');
    expect(approved.shipPlan.status).toBe('approved');
    expect(approved.shipPlan.approvedBy).toBe('george');

    // …and refused while items are pending once releasing
    const early = await send(bosun, { type: 'task.execute_ship', taskId: task.id });
    expect(early.status).toBe(422);
    expect((await j(early)).code).toBe('SHIP_ITEMS_PENDING');

    expect((await send(george, { type: 'task.check_ship_item', taskId: task.id, itemId: 'env', state: 'done' })).status).toBe(200);
    expect((await send(bosun, { type: 'task.check_ship_item', taskId: task.id, itemId: 'merge-verify', state: 'done' })).status).toBe(200);

    const ship = await send(bosun, { type: 'task.execute_ship', taskId: task.id });
    expect(ship.status).toBe(200);
    // the merge + post-merge verification happen here — accepted is EARNED
    expect((await j(ship)).task.state).toBe('verifying');

    // only the shipper confirms; the release verdict is the host's, not a worker's
    const workerConfirm = await send(patch, { type: 'task.confirm_release', taskId: task.id });
    expect(workerConfirm.status).toBe(403);

    const confirm = await send(bosun, { type: 'task.confirm_release', taskId: task.id, note: 'main CI green (12 checks) · desktop release workflow succeeded' });
    expect(confirm.status).toBe(200);
    expect((await j(confirm)).task.state).toBe('accepted');

    const detail = await app.request(`/v1/tasks/${task.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } });
    const { events } = await j(detail);
    const types = events.map((e: { type: string }) => e.type);
    expect(types).toContain('task.ship_claimed');
    expect(types).toContain('task.ship_plan_proposed');
    expect(types).toContain('task.ship_plan_approved');
    expect(types).toContain('task.ship_item_checked');
    expect(types).toContain('task.shipped');
    expect(types[types.length - 1]).toBe('task.release_confirmed');
    // the verdict summary rides the event log — the audit trail of WHY it accepted
    const confirmed = events.find((e: { type: string }) => e.type === 'task.release_confirmed');
    expect(confirmed.payload.note).toContain('main CI green');
  });

  it('confirm_release exists only out of verifying — never a shortcut past the checklist', async () => {
    const task = await taskThroughReview();
    await send(bosun, { type: 'task.claim_ship', taskId: task.id });
    await proposePlan(task.id);
    await send(george, { type: 'task.approve_ship_plan', taskId: task.id });
    // still releasing (items pending): no verifying → accepted edge applies here
    const early = await send(bosun, { type: 'task.confirm_release', taskId: task.id });
    expect(early.status).toBe(409);
  });

  it('revise bounces the plan back to the shipper and a new round supersedes', async () => {
    const task = await taskThroughReview();
    expect((await send(bosun, { type: 'task.claim_ship', taskId: task.id })).status).toBe(200);
    expect((await proposePlan(task.id)).status).toBe(200);

    const revise = await send(george, { type: 'task.revise_ship_plan', taskId: task.id, feedback: 'add a rollback drill item' });
    expect(revise.status).toBe(200);
    expect((await j(revise)).task.state).toBe('shipping');

    const round2 = await proposePlan(task.id, 2);
    expect(round2.status).toBe(200);
    expect((await j(round2)).task.shipPlan.round).toBe(2);
  });
});

describe('ship-gate enforcement (the server, not prompts)', () => {
  it('approve_ship_plan rejects every agent — HUMAN_ONLY', async () => {
    const task = await taskThroughReview();
    await send(bosun, { type: 'task.claim_ship', taskId: task.id });
    await proposePlan(task.id);
    for (const a of [bosun, rex, patch]) {
      const res = await send(a, { type: 'task.approve_ship_plan', taskId: task.id });
      expect(res.status).toBe(403);
      expect((await j(res)).code).toBe('HUMAN_ONLY');
    }
  });

  it('an agent can NEVER tick a human item; a delegated agent ticks only its own', async () => {
    const task = await taskThroughReview();
    await send(bosun, { type: 'task.claim_ship', taskId: task.id });
    await proposePlan(task.id);
    await send(george, { type: 'task.approve_ship_plan', taskId: task.id });

    const agentTick = await send(bosun, { type: 'task.check_ship_item', taskId: task.id, itemId: 'env', state: 'done' });
    expect(agentTick.status).toBe(403);
    const workerTick = await send(patch, { type: 'task.check_ship_item', taskId: task.id, itemId: 'merge-verify', state: 'done' });
    expect(workerTick.status).toBe(403);
    // the human boss override may tick anything, and unticking re-arms the guard
    expect((await send(george, { type: 'task.check_ship_item', taskId: task.id, itemId: 'merge-verify', state: 'done' })).status).toBe(200);
    expect((await send(george, { type: 'task.check_ship_item', taskId: task.id, itemId: 'merge-verify', state: 'pending' })).status).toBe(200);
  });

  it('an added item re-arms execute_ship until it clears', async () => {
    const task = await taskThroughReview();
    await send(bosun, { type: 'task.claim_ship', taskId: task.id });
    await proposePlan(task.id);
    await send(george, { type: 'task.approve_ship_plan', taskId: task.id });
    await send(george, { type: 'task.check_ship_item', taskId: task.id, itemId: 'env', state: 'done' });
    await send(bosun, { type: 'task.check_ship_item', taskId: task.id, itemId: 'merge-verify', state: 'done' });

    const add = await send(george, { type: 'task.add_ship_item', taskId: task.id, title: 'Re-snapshot PowerSync after deploy', owner: 'human' });
    expect(add.status).toBe(200);
    const blocked = await send(bosun, { type: 'task.execute_ship', taskId: task.id });
    expect(blocked.status).toBe(422);

    const { task: t } = await j(await app.request(`/v1/tasks/${task.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    const added = t.shipPlan.items.find((i: { title: string }) => i.title.startsWith('Re-snapshot'));
    expect((await send(george, { type: 'task.check_ship_item', taskId: task.id, itemId: added.id, state: 'done' })).status).toBe(200);
    expect((await send(bosun, { type: 'task.execute_ship', taskId: task.id })).status).toBe(200);
  });

  it('claim_ship needs an open PR — a scratch task is accept-only', async () => {
    const res = await send(george, {
      type: 'task.create', workspace: 'ws_acme', channel: 'dev', project: 'marketing-site',
      title: 'summarize launch learnings', kind: 'docs',
    });
    const { task } = await j(res);
    await send(patch, { type: 'task.claim', taskId: task.id });
    await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['scope agreed'] });
    await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'doc', name: 'learnings.md' }] });
    await send(gem, { type: 'task.approve', taskId: task.id });

    const claim = await send(bosun, { type: 'task.claim_ship', taskId: task.id });
    expect(claim.status).toBe(422);
    // the classic human accept still ships it
    expect((await send(george, { type: 'task.accept', taskId: task.id })).status).toBe(200);
  });

  it('a project with the release gate OFF refuses claim_ship', async () => {
    const create = await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Gate Off', slug: 'gate-off' });
    expect(create.status).toBe(200);
    const { projectId } = await j(create);
    expect((await send(george, { type: 'project.update', project: projectId, shipGate: false })).status).toBe(200);

    const task = await taskThroughReview({ project: 'gate-off' });
    const claim = await send(bosun, { type: 'task.claim_ship', taskId: task.id });
    expect(claim.status).toBe(403);
    expect((await send(george, { type: 'task.accept', taskId: task.id })).status).toBe(200);
  });

  it('a second redraft request is legal while the shipper is still drafting', async () => {
    // the stuck-task bug: bounce a proposed plan (ship_review -> shipping), then ask
    // for MORE changes. That second request has no state change to ride on, so it
    // used to 409 ("shipping -> shipping is not a legal transition") and the task
    // parked forever. The self-loop stamps the plan instead.
    const t = await taskThroughReview({ title: 'two rounds of notes' });
    await send(bosun, { type: 'task.claim_ship', taskId: t.id });
    await proposePlan(t.id);
    const first = await j(await send(george, { type: 'task.revise_ship_plan', taskId: t.id, feedback: 'spell out the env vars' }));
    expect(first.task.state).toBe('shipping');
    const second = await send(george, { type: 'task.revise_ship_plan', taskId: t.id, feedback: 'and the post-launch validation' });
    expect(second.status).toBe(200);
    const after = await j(second);
    expect(after.task.state).toBe('shipping');
    // the counter is what re-enters the host's draft flow — it must move on EVERY
    // request, including two that land in the same millisecond
    expect(first.task.shipPlan.revisions).toBe(1);
    expect(after.task.shipPlan.revisions).toBe(2);
    expect(after.task.shipPlan.status).toBe('draft');
    // …and the orchestrator may relay the human's notes the same way
    expect((await send(rex, { type: 'task.revise_ship_plan', taskId: t.id, feedback: 'relayed' })).status).toBe(200);
  });

  it('request_changes bounces a drafting task back to the developer', async () => {
    const t = await taskThroughReview({ title: 'wrong fix entirely' });
    await send(bosun, { type: 'task.claim_ship', taskId: t.id });
    const r = await j(await send(george, { type: 'task.request_changes', taskId: t.id, feedback: 'this needs a different approach' }));
    expect(r.task.state).toBe('in_progress');
  });

  it('the human escape hatch accepts straight past the gate at every ship state', async () => {
    // from shipping — the shipper's drafting stage. This is the one that used to
    // cage the human: a quiet shipper left `shipping` with no legal move at all.
    const z = await taskThroughReview({ title: 'quiet shipper' });
    await send(bosun, { type: 'task.claim_ship', taskId: z.id });
    expect((await j(await send(george, { type: 'task.accept', taskId: z.id }))).task.state).toBe('accepted');
    // from ship_review
    const a = await taskThroughReview();
    await send(bosun, { type: 'task.claim_ship', taskId: a.id });
    await proposePlan(a.id);
    expect((await j(await send(george, { type: 'task.accept', taskId: a.id }))).task.state).toBe('accepted');
    // from releasing, with items still pending
    const b = await taskThroughReview({ title: 'second change' });
    await send(bosun, { type: 'task.claim_ship', taskId: b.id });
    await proposePlan(b.id);
    await send(george, { type: 'task.approve_ship_plan', taskId: b.id });
    expect((await j(await send(george, { type: 'task.accept', taskId: b.id }))).task.state).toBe('accepted');
    // from verifying — a red or hung post-merge verdict never cages the human
    const c = await taskThroughReview({ title: 'third change' });
    await send(bosun, { type: 'task.claim_ship', taskId: c.id });
    await proposePlan(c.id);
    await send(george, { type: 'task.approve_ship_plan', taskId: c.id });
    await send(george, { type: 'task.check_ship_item', taskId: c.id, itemId: 'env', state: 'done' });
    await send(bosun, { type: 'task.check_ship_item', taskId: c.id, itemId: 'merge-verify', state: 'done' });
    expect((await j(await send(bosun, { type: 'task.execute_ship', taskId: c.id }))).task.state).toBe('verifying');
    expect((await j(await send(george, { type: 'task.accept', taskId: c.id }))).task.state).toBe('accepted');
    // …and a failed verification bounces for a fix-forward round instead
    const d = await taskThroughReview({ title: 'fourth change' });
    await send(bosun, { type: 'task.claim_ship', taskId: d.id });
    await proposePlan(d.id);
    await send(george, { type: 'task.approve_ship_plan', taskId: d.id });
    await send(george, { type: 'task.check_ship_item', taskId: d.id, itemId: 'env', state: 'done' });
    await send(bosun, { type: 'task.check_ship_item', taskId: d.id, itemId: 'merge-verify', state: 'done' });
    await send(bosun, { type: 'task.execute_ship', taskId: d.id });
    const bounce = await send(george, { type: 'task.request_changes', taskId: d.id, feedback: 'release workflow failed at notarize — fix forward' });
    expect((await j(bounce)).task.state).toBe('in_progress');
  });

  it('exactly one of five concurrent ship claims wins', async () => {
    const task = await taskThroughReview();
    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, i) => send({ kind: 'agent', id: `shipper-${i}`, role: 'shipper' }, { type: 'task.claim_ship', taskId: task.id })),
    );
    const wins = claims.filter((r) => r.status === 200).length;
    expect(wins).toBe(1);
  });
});
