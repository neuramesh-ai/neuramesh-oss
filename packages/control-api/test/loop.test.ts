import { designProviderQuestionBlock, type Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'worker' };
const gem: Actor = { kind: 'agent', id: 'gem', role: 'reviewer' };

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

async function createTask(extra: Record<string, unknown> = {}) {
  const res = await send(george, {
    type: 'task.create',
    workspace: 'ws_acme',
    channel: 'dev',
    project: 'marketing-site',
    title: 'fix mobile navigation',
    // a labeled task (docs/16) so routing (request_plan/request_design/offer) inherits
    // the kind via `?? task.kind`; individual tests override with `kind` in `extra`.
    kind: 'feature',
    repo: { id: 'acme/marketing-site', baseRef: 'main' },
    ...extra,
  });
  expect(res.status).toBe(200);
  const { task } = await j(res);
  return task;
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('the loop, end to end', () => {
  it('runs todo → claim → requirements → submit → review bounce → approve → accept → archive', async () => {
    const task = await createTask();
    expect(task.state).toBe('todo');
    expect(task.number).toBe(1001);
    expect(task.repo.branch).toBe('nm/1001-fix-mobile-navigation');

    expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
    expect(
      (await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['repo access', 'repro confirmed'] })).status,
    ).toBe(200);

    const submit = await send(patch, {
      type: 'task.submit',
      taskId: task.id,
      artifacts: [{ kind: 'screenshot', name: 'after.png' }, { kind: 'test_report', name: 'vitest.json' }],
      sha: '8f3c2d1',
    });
    expect(submit.status).toBe(200);
    expect((await j(submit)).task.state).toBe('in_review');

    const bounce = await send(gem, { type: 'task.request_changes', taskId: task.id, feedback: 'focus trap must release on Esc' });
    expect(bounce.status).toBe(200);

    expect(
      (await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'screenshot', name: 'after-esc.png' }], sha: 'a1b2c3d' })).status,
    ).toBe(200);

    const approve = await send(gem, { type: 'task.approve', taskId: task.id });
    expect(approve.status).toBe(200);
    expect((await j(approve)).task.state).toBe('done');

    const accept = await send(george, { type: 'task.accept', taskId: task.id });
    expect((await j(accept)).task.state).toBe('accepted');

    const archive = await send(george, { type: 'task.archive', taskId: task.id });
    const archived = await j(archive);
    expect(archived.task.state).toBe('closed');

    const detail = await app.request(`/v1/tasks/${task.id}`, {
      headers: { 'x-nm-actor': JSON.stringify(george) },
    });
    const { events } = await j(detail);
    expect(events.map((e: { type: string }) => e.type)).toEqual([
      'task.created',
      'task.claimed',
      'task.requirements_confirmed',
      'task.submitted',
      'task.review_requested',
      'task.changes_requested',
      'task.submitted',
      'task.review_requested',
      'task.approved',
      'task.accepted',
      'task.archived',
    ]);
    const ids = events.map((e: { id: string }) => e.id);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('enforcement (the server, not prompts)', () => {
  it('exactly one of ten concurrent claims wins', async () => {
    const task = await createTask();
    const claimers = Array.from({ length: 10 }, (_, i) =>
      send({ kind: 'agent', id: `agent-${i}`, role: 'worker' }, { type: 'task.claim', taskId: task.id }),
    );
    const results = await Promise.all(claimers);
    const codes = results.map((r) => r.status);
    expect(codes.filter((s) => s === 200)).toHaveLength(1);
    expect(codes.filter((s) => s === 409)).toHaveLength(9);
  });

  it('rejects submit without requirements confirmation, evidence, or push', async () => {
    const task = await createTask();
    await send(patch, { type: 'task.claim', taskId: task.id });

    const early = await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'diff', name: 'x.patch' }], sha: 'abc' });
    expect(early.status).toBe(422);
    expect((await j(early)).code).toBe('REQUIREMENTS_NOT_CONFIRMED');

    await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['ok'] });

    const noEvidence = await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [], sha: 'abc' });
    expect((await j(noEvidence)).code).toBe('EVIDENCE_REQUIRED');

    const noPush = await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'diff', name: 'x.patch' }] });
    expect((await j(noPush)).code).toBe('PUSH_REQUIRED');
  });

  it('repo-less tasks submit with artifacts alone', async () => {
    const task = await createTask({ title: 'draft launch tweet', repo: undefined });
    await send(patch, { type: 'task.claim', taskId: task.id });
    await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['brief read'] });
    const submit = await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'doc', name: 'tweet.md' }] });
    expect(submit.status).toBe(200);
  });

  it('blocks self-review, non-reviewer approval, and agent acceptance', async () => {
    const task = await createTask();
    await send(patch, { type: 'task.claim', taskId: task.id });
    await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['ok'] });
    await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'diff', name: 'd.patch' }], sha: 'abc' });

    expect((await j(await send(patch, { type: 'task.approve', taskId: task.id }))).code).toBe('SELF_REVIEW_BLOCKED');
    expect((await j(await send({ kind: 'agent', id: 'scout', role: 'worker' }, { type: 'task.approve', taskId: task.id }))).code).toBe('NOT_PERMITTED');

    await send(gem, { type: 'task.approve', taskId: task.id });
    expect((await j(await send(rex, { type: 'task.accept', taskId: task.id }))).code).toBe('HUMAN_ONLY');
    expect((await send(george, { type: 'task.accept', taskId: task.id })).status).toBe(200);
  });

  it('registers a repo (idempotent), letting humans + orchestrator but not workers, github only', async () => {
    const ok = await send(george, { type: 'repo.link', workspace: 'ws_acme', channel: 'dev', url: 'https://github.com/galonge/nmesh-static' });
    expect(ok.status).toBe(200);
    expect((await j(ok)).inserted).toBe(true);
    // idempotent: re-linking the same repo (even with .git) updates, never duplicates
    const again = await send(george, { type: 'repo.link', workspace: 'ws_acme', url: 'https://github.com/galonge/nmesh-static.git' });
    expect((await j(again)).inserted).toBe(false);
    // the orchestrator may register too (it does this during requirements)
    expect((await send(rex, { type: 'repo.link', workspace: 'ws_acme', url: 'https://github.com/galonge/other' })).status).toBe(200);
    // workers may not
    expect((await send(patch, { type: 'repo.link', workspace: 'ws_acme', url: 'https://github.com/galonge/x' })).status).toBe(403);
    // public GitHub only — a non-github URL is rejected, not silently stored
    expect((await send(george, { type: 'repo.link', workspace: 'ws_acme', url: 'https://gitlab.com/a/b' })).status).toBe(422);
    // an <org>/<repo> shorthand is accepted (assumed github) so the orchestrator can attach loosely-named repos
    expect((await send(george, { type: 'repo.link', workspace: 'ws_acme', url: 'galonge/shorthand' })).status).toBe(200);
  });

  it('enforces Free plan limits server-side (3-project cap, one seat) and lifts them on Pro', async () => {
    // Free: the first 3 projects are allowed; the 4th is refused with PLAN_LIMIT (402) — enforced
    // by the server, not just the UI, so a direct API call can't exceed it either.
    expect((await send(george, { type: 'project.create', workspace: 'ws_free', name: 'One' })).status).toBe(200);
    expect((await send(george, { type: 'project.create', workspace: 'ws_free', name: 'Two' })).status).toBe(200);
    expect((await send(george, { type: 'project.create', workspace: 'ws_free', name: 'Three' })).status).toBe(200);
    const capped = await send(george, { type: 'project.create', workspace: 'ws_free', name: 'Four' });
    expect(capped.status).toBe(402);
    expect((await j(capped)).code).toBe('PLAN_LIMIT');
    // Free is ONE person (George, 2026-09-03). This fixture's workspace has no member rows,
    // so the single seat is open to one invitation — and the count includes PENDING invitations,
    // which is what refuses the second: FREE_SEAT_CAP is the owner's seat, and there is one.
    expect((await send(george, { type: 'workspace.invite', workspace: 'ws_free', email: 'one@acme.com', memberRole: 'member' })).status).toBe(200);
    const overCap = await send(george, { type: 'workspace.invite', workspace: 'ws_free', email: 'two@acme.com', memberRole: 'member' });
    expect(overCap.status).toBe(402);
    const refusal = await j(overCap); // one read: a Response body is consumed once
    expect(refusal.code).toBe('PLAN_LIMIT');
    expect(refusal.error).toMatch(/Upgrade to Pro/);
    expect(await store.pendingInvites('ws_free')).toHaveLength(1);
    // upgrading to Pro lifts both gates immediately (the 4th project and the second seat succeed)
    await store.setWorkspacePlan('ws_free', { plan: 'cloud' });
    expect((await send(george, { type: 'project.create', workspace: 'ws_free', name: 'Four' })).status).toBe(200);
    expect((await send(george, { type: 'workspace.invite', workspace: 'ws_free', email: 'two@acme.com', memberRole: 'member' })).status).toBe(200);
  });

  it('Free is single-machine: a second machine is refused (MACHINE_LIMIT) until transferred; Cloud is unlimited', async () => {
    expect((await send(george, { type: 'machine.register', workspace: 'ws_m', name: 'laptop' })).status).toBe(200);
    const second = await send(george, { type: 'machine.register', workspace: 'ws_m', name: 'desktop' });
    expect(second.status).toBe(402);
    expect((await j(second)).code).toBe('MACHINE_LIMIT');
    // transfer re-points the workspace to the new machine (the other is no longer primary)
    expect((await send(george, { type: 'machine.register', workspace: 'ws_m', name: 'desktop', transfer: true })).status).toBe(200);
    // re-registering an already-known machine (the boot heartbeat) is always fine
    expect((await send(george, { type: 'machine.register', workspace: 'ws_m', name: 'laptop' })).status).toBe(200);
    // Cloud lifts the limit — both machines register
    await store.setWorkspacePlan('ws_cloud', { plan: 'cloud' });
    expect((await send(george, { type: 'machine.register', workspace: 'ws_cloud', name: 'a' })).status).toBe(200);
    expect((await send(george, { type: 'machine.register', workspace: 'ws_cloud', name: 'b' })).status).toBe(200);
  });

  it('manages projects: create (ws-unique slug, channels optional), update, channel.assign, archive — humans + orchestrator, not workers', async () => {
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' }); // exercises project mechanics, not the Free 3-project cap (covered above)
    // a human creates an initiative (channels are optional — moved in later)
    const a = await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Landing Page' });
    expect(a.status).toBe(200);
    const created = await j(a);
    expect(created.slug).toBe('landing-page');
    const pid = created.projectId;
    // workspace-unique slug: a second project of the same name gets a -2 suffix
    expect((await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Landing Page' }))).slug).toBe('landing-page-2');
    // the human may set the slug explicitly at creation (it's create-only)
    expect((await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Q3 Launch', slug: 'q3' }))).slug).toBe('q3');
    // the orchestrator may create too — but never silently: since 2026-08-18 an agent create
    // requires its confirmation card on file first (guards.ts requireConfirmCard)
    await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(rex) },
      body: JSON.stringify({ workspace: 'ws_acme', channel: 'dev', body: '```nmq\n{"question":"Start a new project \\"Docs\\"?","options":[{"label":"Create project"},{"label":"Not now"}]}\n```' }),
    });
    expect((await send(rex, { type: 'project.create', workspace: 'ws_acme', name: 'Docs' })).status).toBe(200);
    // …and WITHOUT a card on file, the same create is refused — the silent path is closed
    expect((await j(await send(rex, { type: 'project.create', workspace: 'ws_acme', name: 'Skunkworks' }))).code).toBe('CONFIRM_CARD_REQUIRED');
    // workers may not manage projects
    expect((await send(patch, { type: 'project.create', workspace: 'ws_acme', name: 'Nope' })).status).toBe(403);
    // identity: website + a detected logo (compact data: URL) ride create and update;
    // '' clears, junk shapes are rejected at the schema (never a raw string in the column)
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const withId = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Flowe AI', website: 'https://flowe.ai', logoUrl: logo }));
    expect(withId.projectId).toBeTruthy();
    expect((await send(george, { type: 'project.update', project: withId.projectId, website: 'https://flowe.ai/app', logoUrl: '' })).status).toBe(200); // clear the logo
    expect((await send(george, { type: 'project.update', project: withId.projectId, logoUrl: 'not-a-url' })).status).toBe(400);
    expect((await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Bad', website: 'ftp://x' })).status).toBe(400);
    // rename, move a channel into the project (1:N), and archive/unarchive
    expect((await send(george, { type: 'project.update', project: pid, name: 'Landing' })).status).toBe(200);
    expect((await send(george, { type: 'channel.assign', channel: 'chan-x', project: pid })).status).toBe(200);
    expect((await send(patch, { type: 'channel.assign', channel: 'chan-x', project: pid })).status).toBe(403);
    expect((await send(patch, { type: 'project.archive', project: pid })).status).toBe(403);
    expect((await send(george, { type: 'project.archive', project: pid })).status).toBe(200);
    expect((await send(george, { type: 'project.unarchive', project: pid })).status).toBe(200);
  });

  it('registers an agent with a runtime (A2A multi-runtime); defaults to claude-code', async () => {
    // explicit non-claude runtime is accepted
    const codex = await send(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'cx', role: 'developer', runtime: 'codex', channels: ['dev'] });
    expect(codex.status).toBe(200);
    expect((await j(codex)).agentId).toBeTruthy();
    // omitting runtime defaults to claude-code (the schema default — behavior-preserving)
    const dflt = await send(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'cl', role: 'developer', channels: ['dev'] });
    expect(dflt.status).toBe(200);
    // an unknown runtime is rejected (enum-gated, not silently stored)
    const bad = await send(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'bad', role: 'developer', runtime: 'llama', channels: ['dev'] });
    expect(bad.status).toBe(400);
  });

  it('serves an A2A 1.0 agent card publicly (discovery)', async () => {
    const reg = await send(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'cardbot', role: 'developer', runtime: 'gemini', channels: ['dev'] });
    const { agentId } = await j(reg);
    // public — NO x-nm-actor header (discovery is outside the /v1 auth scope)
    const res = await app.request(`/a2a/agents/${agentId}/card.json`);
    expect(res.status).toBe(200);
    const card = await j(res);
    expect(card.name).toBe('cardbot');
    expect(card.skills.length).toBeGreaterThan(0);
    expect(card.capabilities.streaming).toBe(true);
    expect(card['x-neuramesh'].runtime).toBe('gemini');
    expect(card.extensions).toContain('https://neuramesh.app/a2a/ext/review/v1');
    // the well-known path resolves the same card via ?agent=
    expect((await j(await app.request(`/.well-known/a2a/agent-card.json?agent=${agentId}`))).name).toBe('cardbot');
    // unknown agent → 404; bare well-known → the NeuraMesh discovery descriptor
    expect((await app.request('/a2a/agents/nope/card.json')).status).toBe(404);
    expect((await j(await app.request('/.well-known/a2a/agent-card.json'))).name).toBe('NeuraMesh');
  });

  it('connects an external A2A agent (auth-gated + card-validated)', async () => {
    // workers may not connect external agents
    expect((await send(patch, { type: 'agent.connect_remote', workspace: 'ws_acme', channels: ['dev'], cardUrl: 'http://127.0.0.1:1/c' })).status).toBe(403);
    // an unreachable / non-card URL is rejected (could not fetch a valid card)
    expect((await send(george, { type: 'agent.connect_remote', workspace: 'ws_acme', channels: ['dev'], cardUrl: 'http://127.0.0.1:1/nope' })).status).toBe(422);
  });

  it('sets/edits the Definition of Done (human/orchestrator/architect; not workers; frozen once terminal)', async () => {
    const arc: Actor = { kind: 'agent', id: 'arc', role: 'architect' };
    // carried at creation
    const created = await createTask({ definitionOfDone: 'PR opened against main, CI green, merged on accept' });
    expect(created.definitionOfDone).toBe('PR opened against main, CI green, merged on accept');

    // a human may edit it while the task is in flight
    const edit = await send(george, { type: 'task.set_definition_of_done', taskId: created.id, dod: 'PR green + screenshot evidence' });
    expect(edit.status).toBe(200);
    expect((await j(edit)).task.definitionOfDone).toBe('PR green + screenshot evidence');
    // the orchestrator and the architect may set it too (the architect derives it from its plan)
    expect((await send(rex, { type: 'task.set_definition_of_done', taskId: created.id, dod: 'orchestrator bar' })).status).toBe(200);
    expect((await send(arc, { type: 'task.set_definition_of_done', taskId: created.id, dod: 'architect bar' })).status).toBe(200);
    // a worker may NOT
    expect((await send(patch, { type: 'task.set_definition_of_done', taskId: created.id, dod: 'sneaky' })).status).toBe(403);

    // drive the task to accepted, then the contract is frozen (can't edit after acceptance)
    await send(patch, { type: 'task.claim', taskId: created.id });
    await send(patch, { type: 'task.confirm_requirements', taskId: created.id, checklist: ['ok'] });
    await send(patch, { type: 'task.submit', taskId: created.id, artifacts: [{ kind: 'diff', name: 'd.patch' }], sha: 'abc' });
    await send(gem, { type: 'task.approve', taskId: created.id });
    await send(george, { type: 'task.accept', taskId: created.id });
    const frozen = await send(george, { type: 'task.set_definition_of_done', taskId: created.id, dod: 'too late' });
    expect(frozen.status).toBe(409);
    expect((await j(frozen)).code).toBe('ILLEGAL_TRANSITION');
  });

  it('maps a Clerk user to a stable internal uuid (idempotent per clerk id)', async () => {
    const store = new MemoryStore();
    const a1 = await store.resolveClerkUser('user_aaa', 'a@x.dev');
    expect(a1.created).toBe(true);
    const a2 = await store.resolveClerkUser('user_aaa', 'a@x.dev');
    expect(a2.created).toBe(false);
    expect(a2.id).toBe(a1.id); // same clerk id -> same internal uuid
    const b = await store.resolveClerkUser('user_bbb', 'b@x.dev');
    expect(b.id).not.toBe(a1.id); // distinct clerk id -> distinct uuid
  });

  it('lets a human/orchestrator STOP an in_progress task (cancel halts a running agent); the assignee cannot self-stop', async () => {
    const task = await createTask();
    await send(patch, { type: 'task.claim', taskId: task.id }); // -> in_progress, patch is assignee
    // the assigned worker can't self-stop (use block to pause) — keeps the halt deliberate
    expect((await send(patch, { type: 'task.cancel', taskId: task.id })).status).toBe(403);
    // the orchestrator may stop on the human's behalf
    const orchStop = await createTask({ title: 'second stoppable' });
    await send(patch, { type: 'task.claim', taskId: orchStop.id });
    expect((await j(await send(rex, { type: 'task.cancel', taskId: orchStop.id }))).task.state).toBe('closed');
    // and the human stops the first one outright — previously ILLEGAL from in_progress
    const stop = await send(george, { type: 'task.cancel', taskId: task.id });
    expect(stop.status).toBe(200);
    expect((await j(stop)).task.state).toBe('closed');
  });

  it('carries the PR pointer on submit (repo-backed work opens a pull request)', async () => {
    const task = await createTask();
    await send(patch, { type: 'task.claim', taskId: task.id });
    await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['ok'] });
    const submit = await send(patch, {
      type: 'task.submit',
      taskId: task.id,
      artifacts: [{ kind: 'diff', name: 'x.patch' }],
      sha: 'abc1234',
      prUrl: 'https://github.com/acme/marketing-site/pull/42',
      prNumber: 42,
    });
    expect(submit.status).toBe(200);
    const out = (await j(submit)).task;
    expect(out.prNumber).toBe(42);
    expect(out.prUrl).toBe('https://github.com/acme/marketing-site/pull/42');
    expect(out.submittedSha).toBe('abc1234');
  });

  it('rejects illegal jumps and unauthorized creators', async () => {
    const task = await createTask();
    const jump = await send(george, { type: 'task.accept', taskId: task.id });
    expect(jump.status).toBe(409);

    const workerCreate = await send(patch, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'sneaky' });
    expect(workerCreate.status).toBe(403);

    const anon = await app.request('/v1/commands', { method: 'POST', body: '{}' });
    expect(anon.status).toBe(401);
  });

  it('member.update_profile: a member edits their own display name; agents are rejected', async () => {
    const ok = await send(george, { type: 'member.update_profile', workspace: 'ws_acme', displayName: 'George Alonge' });
    expect(ok.status).toBe(200);
    expect((await j(ok)).ok).toBe(true);
    // the write is actor-scoped + human-only — an agent can't edit a human's profile
    const denied = await send(rex, { type: 'member.update_profile', workspace: 'ws_acme', displayName: 'rex was here' });
    expect(denied.status).toBe(403);
    expect((await j(denied)).code).toBe('NOT_PERMITTED');
  });

  it('block from any working stage — unblock returns to the stage it left, never blindly to in_progress', async () => {
    const atlas: Actor = { kind: 'agent', id: 'atlas', role: 'architect' };
    const iris: Actor = { kind: 'agent', id: 'iris', role: 'designer' };

    // planning: the architect hits a wall (plan generation failed) → blocked; unblock re-plans
    const t1 = await createTask({ title: 'blocked while planning' });
    await send(rex, { type: 'task.request_plan', taskId: t1.id, architect: 'atlas' });
    const b1 = await send(atlas, { type: 'task.block', taskId: t1.id, reason: 'plan generation failed' });
    expect(b1.status).toBe(200);
    const b1t = (await j(b1)).task;
    expect(b1t.state).toBe('blocked');
    expect(b1t.blockedFrom).toBe('planning');
    const u1t = (await j(await send(george, { type: 'task.unblock', taskId: t1.id }))).task;
    expect(u1t.state).toBe('planning'); // NOT in_progress — the architect watch re-fires
    expect(u1t.blockedFrom).toBeNull();

    // designing: same story for the designer
    const t2 = await createTask({ title: 'blocked while designing' });
    await send(rex, { type: 'task.request_design', taskId: t2.id, designer: 'iris' });
    expect((await j(await send(iris, { type: 'task.block', taskId: t2.id, reason: 'mockup generation failed' }))).task.blockedFrom).toBe('designing');
    expect((await j(await send(rex, { type: 'task.unblock', taskId: t2.id }))).task.state).toBe('designing');

    // in_review: the reviewer's evidence gate blocks; unblock resumes REVIEW, not the build
    const t3 = await createTask({ title: 'blocked during review' });
    await send(patch, { type: 'task.claim', taskId: t3.id });
    await send(patch, { type: 'task.confirm_requirements', taskId: t3.id, checklist: ['ok'] });
    await send(patch, { type: 'task.submit', taskId: t3.id, artifacts: [{ kind: 'diff', name: 'd.patch' }], sha: 'abc' });
    const b3 = await send(gem, { type: 'task.block', taskId: t3.id, reason: 'DoD requires screenshots; none attached after a bounce' });
    expect(b3.status).toBe(200);
    expect((await j(b3)).task.blockedFrom).toBe('in_review');
    expect((await j(await send(george, { type: 'task.unblock', taskId: t3.id }))).task.state).toBe('in_review');

    // regression: the classic in_progress block/unblock round-trip is unchanged
    const t4 = await createTask({ title: 'classic block' });
    await send(patch, { type: 'task.claim', taskId: t4.id });
    expect((await j(await send(patch, { type: 'task.block', taskId: t4.id, reason: 'input required' }))).task.blockedFrom).toBe('in_progress');
    expect((await j(await send(patch, { type: 'task.unblock', taskId: t4.id }))).task.state).toBe('in_progress');

    // and a worker still can't block someone else's planning-stage task
    const t5 = await createTask({ title: 'not yours to block' });
    await send(rex, { type: 'task.request_plan', taskId: t5.id, architect: 'atlas' });
    expect((await send(patch, { type: 'task.block', taskId: t5.id, reason: 'nope' })).status).toBe(403);
  });

  it('runs the design stage: request → propose (designer-only) → revise → re-propose → HUMAN approve → planning, latest round promoted', async () => {
    const iris: Actor = { kind: 'agent', id: 'iris', role: 'designer' };
    const atlas: Actor = { kind: 'agent', id: 'atlas', role: 'architect' };
    const task = await createTask({ title: 'landing page hero refresh' });

    // a worker can't route work into design; the orchestrator can, assigning the channel designer
    expect((await send(patch, { type: 'task.request_design', taskId: task.id, designer: 'iris' })).status).toBe(403);
    const routed = await send(rex, { type: 'task.request_design', taskId: task.id, designer: 'iris', provider: 'claude-design' });
    expect(routed.status).toBe(200);
    expect((await j(routed)).task.state).toBe('designing');
    const routedDetail = await j(await app.request(`/v1/tasks/${task.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(routedDetail.task.assignee).toMatchObject({ id: 'iris' });
    expect(routedDetail.events.find((e: { type: string }) => e.type === 'task.design_requested')?.payload).toMatchObject({ provider: 'claude-design' });

    // only the designer proposes; a proposal without mockups doesn't parse
    expect((await send(patch, { type: 'task.propose_design', taskId: task.id, round: 1, mockups: [{ name: 'hero', html: '<html/>' }] })).status).toBe(403);
    expect((await send(iris, { type: 'task.propose_design', taskId: task.id, round: 1, mockups: [] })).status).toBe(400);
    const proposed = await send(iris, {
      type: 'task.propose_design', taskId: task.id, round: 1, summary: 'two hero directions',
      mockups: [{ name: 'Hero A', html: '<html>a</html>' }, { name: 'Hero B', html: '<html>b</html>' }],
    });
    expect(proposed.status).toBe(200);
    const proposedTask = (await j(proposed)).task;
    expect(proposedTask.state).toBe('design_review');
    expect(proposedTask.artifactCount).toBe(2);

    // the gate: no agent — not even the orchestrator — approves a design
    expect((await j(await send(rex, { type: 'task.approve_design', taskId: task.id }))).code).toBe('HUMAN_ONLY');
    expect((await j(await send(iris, { type: 'task.approve_design', taskId: task.id }))).code).toBe('HUMAN_ONLY');

    // the human asks for changes; the designer re-proposes a second round
    expect((await j(await send(george, { type: 'task.revise_design', taskId: task.id, feedback: 'warmer palette, sticky header' }))).task.state).toBe('designing');
    expect((await send(iris, { type: 'task.propose_design', taskId: task.id, round: 2, mockups: [{ name: 'Hero warm', html: '<html>w</html>' }] })).status).toBe(200);

    // human approval releases it to planning, clears the assignee for the architect watch,
    // and promotes ONLY the approved (latest) round into the channel library
    const approved = await send(george, { type: 'task.approve_design', taskId: task.id });
    expect(approved.status).toBe(200);
    const approvedTask = (await j(approved)).task;
    expect(approvedTask.state).toBe('planning');
    expect(approvedTask.assignee).toBeNull();
    const arts = await store.listArtifacts(task.id);
    expect(arts.map((a) => [a.kind, a.name, !!a.promoted])).toEqual([
      ['design', 'design-mockup-v1-hero-a.html', false],
      ['design', 'design-mockup-v1-hero-b.html', false],
      ['design', 'design-mockup-v2-hero-warm.html', true],
    ]);

    const { events } = await j(await app.request(`/v1/tasks/${task.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(events.map((e: { type: string }) => e.type)).toEqual([
      'task.created',
      'task.design_requested',
      'task.design_proposed',
      'task.design_revising',
      'task.design_proposed',
      'task.design_approved',
    ]);
    // mockup HTML never rides events — payloads carry names only
    const proposedEvt = events.find((e: { type: string }) => e.type === 'task.design_proposed');
    expect(JSON.stringify(proposedEvt.payload)).not.toContain('<html>');

    // #1034: the plan version must count PLANS, not the task's artifacts. This task carries
    // three approved mockups, so the old `artifactCount`-based name made the FIRST plan
    // "implementation-plan-v4.md" while the daemon announced v1 — a thread link pointing at
    // a file that never existed. The first plan on a design-gated task is v1.
    expect((await send(atlas, { type: 'task.propose_plan', taskId: task.id, plan: '# Plan\n\n## Definition of Done\n- ships' })).status).toBe(200);
    const afterPlan = await store.listArtifacts(task.id);
    expect(afterPlan.filter((a) => a.name.startsWith('implementation-plan')).map((a) => a.name)).toEqual(['implementation-plan-v1.md']);

    // a revise round increments by one, and the response carries the assigned name so the
    // daemon announces THAT string instead of deriving a second one
    expect((await send(george, { type: 'task.revise_plan', taskId: task.id, feedback: 'tighten the rollout' })).status).toBe(200);
    const replanned = await send(atlas, { type: 'task.propose_plan', taskId: task.id, plan: '# Plan v2' });
    expect(replanned.status).toBe(200);
    expect((await j(replanned)).artifacts.map((a: { name: string }) => a.name)).toEqual(['implementation-plan-v2.md']);

    // and nothing is buildable from an unapproved design: a fresh design task can't be claimed
    const t2 = await createTask({ title: 'unapproved design cannot start' });
    await send(rex, { type: 'task.request_design', taskId: t2.id, designer: 'iris' });
    expect((await send(patch, { type: 'task.claim', taskId: t2.id })).status).toBe(409);
  });

  it('pauses an unselected design route until a human chooses the canvas', async () => {
    const task = await createTask({ title: 'choose a design canvas' });
    const routed = await send(rex, { type: 'task.request_design', taskId: task.id, designer: 'iris' });
    expect(routed.status).toBe(200);

    let detail = await j(await app.request(`/v1/tasks/${task.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(detail.events.find((e: { type: string }) => e.type === 'task.design_requested')?.payload.provider).toBeUndefined();
    expect((await send(rex, { type: 'task.select_design_provider', taskId: task.id, provider: 'iris' })).status).toBe(403);

    const asked = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: 'iris', role: 'designer' }) },
      body: JSON.stringify({
        workspace: 'ws_acme',
        channel: 'dev',
        taskId: task.id,
        body: `Choose the design canvas.\n\n${designProviderQuestionBlock()}`,
      }),
    });
    expect(asked.status).toBe(200);
    const decision = (await store.listDecisions('ws_acme')).find((d) => d.taskId === task.id && d.status === 'open');
    expect(decision).toMatchObject({
      question: 'Where should Iris draft this?',
      allowOther: false,
      options: expect.arrayContaining([
        expect.objectContaining({ label: 'Draft here with Iris', provider: 'iris', icon: 'iris' }),
        expect.objectContaining({ label: 'Use Claude Design', provider: 'claude-design', icon: 'claude-design' }),
      ]),
    });

    // Validation happens before the exactly-once decision flip: a bad label
    // leaves the card open so the human can still choose a real canvas.
    const invalid = await send(george, { type: 'decision.answer', decisionId: decision!.id, answer: 'Somewhere else' });
    expect(invalid.status).toBe(422);
    expect((await store.listDecisions('ws_acme')).find((d) => d.id === decision!.id)?.status).toBe('open');

    // Answering the synced decision — from the thread, Mission Control,
    // or a notification — selects the provider too.
    const selected = await send(george, { type: 'decision.answer', decisionId: decision!.id, answer: 'Use Claude Design' });
    expect(selected.status).toBe(200);
    expect((await store.listDecisions('ws_acme')).find((d) => d.id === decision!.id)).toMatchObject({ status: 'answered', answer: 'Use Claude Design' });
    detail = await j(await app.request(`/v1/tasks/${task.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(detail.task.state).toBe('designing');
    expect(detail.events.find((e: { type: string }) => e.type === 'task.design_provider_selected')?.payload).toMatchObject({ provider: 'claude-design' });

    // Mobile/older clients only post the rendered answer line. The message
    // endpoint resolves that open decision through the same atomic command path.
    const mobileTask = await createTask({ title: 'choose a canvas from mobile' });
    await send(rex, { type: 'task.request_design', taskId: mobileTask.id, designer: 'iris' });
    await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: 'iris', role: 'designer' }) },
      body: JSON.stringify({ workspace: 'ws_acme', channel: 'dev', taskId: mobileTask.id, body: designProviderQuestionBlock() }),
    });
    const mobileReply = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
      body: JSON.stringify({ workspace: 'ws_acme', channel: 'dev', taskId: mobileTask.id, body: '**Where should Iris draft this?** → Draft here with Iris' }),
    });
    expect(mobileReply.status).toBe(200);
    const mobileDetail = await j(await app.request(`/v1/tasks/${mobileTask.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(mobileDetail.events.find((e: { type: string }) => e.type === 'task.design_provider_selected')?.payload).toMatchObject({ provider: 'iris' });
  });

  it('channel.add_agent / remove_agent: humans + orchestrator manage membership; workers cannot', async () => {
    const add = (actor: Actor, agent: string) =>
      send(actor, { type: 'channel.add_agent', workspace: 'ws_acme', channel: 'dev', agent });
    // a human (the live-panel "+") adds an agent to a channel
    const ok = await add(george, 'patch');
    expect(ok.status).toBe(200);
    expect((await j(ok)).ok).toBe(true);
    // the orchestrator (the "add @agent?" card) may too
    expect((await add(rex, 'gem')).status).toBe(200);
    // a worker cannot bring agents into channels
    const denied = await add(patch, 'scout');
    expect(denied.status).toBe(403);
    expect((await j(denied)).code).toBe('NOT_PERMITTED');
    // remove is likewise gated
    expect((await send(george, { type: 'channel.remove_agent', workspace: 'ws_acme', channel: 'dev', agent: 'patch' })).status).toBe(200);
    expect((await send(patch, { type: 'channel.remove_agent', workspace: 'ws_acme', channel: 'dev', agent: 'gem' })).status).toBe(403);
  });

  it('backlog: any teammate parks an idea; only humans/orchestrator promote; agents can never work it (docs/15)', async () => {
    // a worker parks an idea — the one creation path open to every actor
    const parked = await send(patch, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'idea: dark-mode onboarding tour', backlog: true });
    expect(parked.status).toBe(200);
    const item = (await j(parked)).task;
    expect(item.state).toBe('backlog');
    expect(item.creator).toMatchObject({ kind: 'agent', id: 'patch' });

    // …but a worker still can't create live todo work
    expect((await send(patch, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'sneaky live task' })).status).toBe(403);
    // …and a backlog item can't be born offered
    expect((await send(patch, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'idea', backlog: true, offerTo: 'patch' })).status).toBe(422);

    // parked items are unreachable by the work loop: no offer, no claim, no agent promotion
    expect((await send(rex, { type: 'task.offer', taskId: item.id, offerTo: 'patch' })).status).toBe(409);
    expect((await send(patch, { type: 'task.claim', taskId: item.id })).status).toBe(409);
    const agentPromote = await send(patch, { type: 'task.promote', taskId: item.id });
    expect(agentPromote.status).toBe(403);
    expect((await j(agentPromote)).code).toBe('NOT_PERMITTED');

    // the orchestrator (or a human) promotes; from todo the normal loop applies
    const promoted = await send(rex, { type: 'task.promote', taskId: item.id });
    expect(promoted.status).toBe(200);
    expect((await j(promoted)).task.state).toBe('todo');
    expect((await send(patch, { type: 'task.claim', taskId: item.id })).status).toBe(200);

    const { events } = await j(await app.request(`/v1/tasks/${item.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(events.map((e: { type: string }) => e.type)).toEqual(['task.created', 'task.promoted', 'task.claimed']);
  });

  it('backlog details are editable pre-work by humans/orchestrator, frozen once staged', async () => {
    const item = (await j(await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'rough idea', backlog: true }))).task;

    // the human refines the parked idea (title and/or description)
    const edited = await send(george, { type: 'task.update_details', taskId: item.id, title: 'Onboarding tour v2', description: 'Guided 4-step tour.\n\nMore context in the thread.' });
    expect(edited.status).toBe(200);
    expect((await j(edited)).task).toMatchObject({ title: 'Onboarding tour v2', description: 'Guided 4-step tour.\n\nMore context in the thread.' });

    // the orchestrator may relay edits from chat; workers may not; empty edits are rejected
    expect((await send(rex, { type: 'task.update_details', taskId: item.id, description: 'Rex adds detail from the channel ask.' })).status).toBe(200);
    expect((await send(patch, { type: 'task.update_details', taskId: item.id, title: 'worker rewrite' })).status).toBe(403);
    expect((await send(george, { type: 'task.update_details', taskId: item.id })).status).toBe(422);

    // still editable in todo (pre-work) — frozen from designing onward
    await send(george, { type: 'task.promote', taskId: item.id });
    expect((await send(george, { type: 'task.update_details', taskId: item.id, title: 'still editable in todo' })).status).toBe(200);
    await send(rex, { type: 'task.request_design', taskId: item.id, designer: 'iris', kind: 'feature' });
    const frozen = await send(george, { type: 'task.update_details', taskId: item.id, title: 'too late' });
    expect(frozen.status).toBe(409);
    expect((await j(frozen)).code).toBe('ILLEGAL_TRANSITION');
  });
});
