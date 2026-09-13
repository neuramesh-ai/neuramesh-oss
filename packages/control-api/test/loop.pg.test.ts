// The enforced loop against the REAL schema (migration 0001 + DB triggers).
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
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

afterAll(async () => {
  await store?.close();
});

describe.skipIf(!DB)('the loop on postgres (real schema + triggers)', () => {
  it('runs the full loop with DB-owned versioning', async () => {
    const create = await send(george, {
      type: 'task.create',
      workspace: WS,
      channel: 'dev',
      project: 'dev',
      title: 'fix mobile navigation',
      repo: { id: REPO, baseRef: 'main' },
    });
    expect(create.status).toBe(200);
    const { task } = await j(create);
    expect(task.number).toBeGreaterThanOrEqual(1001);
    expect(task.repo.branch).toContain('fix-mobile-navigation');

    expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
    expect(
      (await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['repo access'] })).status,
    ).toBe(200);

    const noPush = await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'diff', name: 'd.patch' }] });
    expect((await j(noPush)).code).toBe('PUSH_REQUIRED');

    const submit = await send(patch, {
      type: 'task.submit',
      taskId: task.id,
      artifacts: [{ kind: 'diff', name: 'nav.diff', content: 'diff --git a/nav.ts b/nav.ts\n+fixed' }],
      sha: '8f3c2d1',
    });
    expect((await j(submit)).task.state).toBe('in_review');

    expect((await j(await send(patch, { type: 'task.approve', taskId: task.id }))).code).toBe('SELF_REVIEW_BLOCKED');
    expect((await j(await send(gem, { type: 'task.approve', taskId: task.id }))).task.state).toBe('done');
    expect((await j(await send(rex, { type: 'task.accept', taskId: task.id }))).code).toBe('HUMAN_ONLY');
    expect((await j(await send(george, { type: 'task.accept', taskId: task.id }))).task.state).toBe('accepted');
    expect((await j(await send(george, { type: 'task.archive', taskId: task.id }))).task.state).toBe('closed');

    const detail = await app!.request(`/v1/tasks/${task.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } });
    const { task: final, events, artifacts } = await j(detail);
    expect(final.version).toBeGreaterThanOrEqual(6); // DB trigger owns version
    // artifact content round-trips as a row; the events log stays metadata-only
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].content).toContain('diff --git');
    expect(JSON.stringify(events)).not.toContain('diff --git');

    // library curation: workers can't promote; humans and orchestrators can
    expect((await send(patch, { type: 'artifact.promote', artifactId: artifacts[0].id })).status).toBe(403);
    expect((await send(george, { type: 'artifact.promote', artifactId: artifacts[0].id })).status).toBe(200);
    expect((await send(rex, { type: 'artifact.promote', artifactId: artifacts[0].id })).status).toBe(200);
    expect(events.map((e: { type: string }) => e.type)).toEqual([
      'task.created',
      'task.claimed',
      'task.requirements_confirmed',
      'task.submitted',
      'task.review_requested',
      'task.approved',
      'task.accepted',
      'task.archived',
    ]);

    // lifecycle stamps: the schema trigger (0050/0051) writes them on every transition —
    // they are the synced projection Mission Control's counts chart (docs/12 §4)
    const sql = postgres(DB!);
    try {
      const [stamps] = await sql`select claimed_at, submitted_at, approved_at, accepted_at, closed_at from tasks where id = ${task.id}`;
      expect(stamps!['claimed_at']).not.toBeNull();
      expect(stamps!['submitted_at']).not.toBeNull();
      expect(stamps!['approved_at']).not.toBeNull();
      expect(stamps!['accepted_at']).not.toBeNull();
      expect(stamps!['closed_at']).not.toBeNull();
      expect(new Date(stamps!['accepted_at'] as string).getTime()).toBeLessThanOrEqual(new Date(stamps!['closed_at'] as string).getTime());
    } finally {
      await sql.end();
    }
  });

  it('serializes concurrent claims via row locks — one winner', async () => {
    const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'race me' }));
    const claims = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        send({ kind: 'agent', id: `90000000-0000-0000-0000-00000000000${i}`, role: 'worker' }, { type: 'task.claim', taskId: task.id }),
      ),
    );
    const codes = claims.map((r) => r.status);
    expect(codes.filter((s) => s === 200)).toHaveLength(1);
    expect(codes.filter((s) => s === 409)).toHaveLength(9);
  });

  it('registers machines idempotently and heartbeats', async () => {
    const r1 = await j(await send(george, { type: 'machine.register', workspace: WS, name: 'georges-test-mbp', platform: 'darwin', daemonVersion: '0.1.0' }));
    const r2 = await j(await send(george, { type: 'machine.register', workspace: WS, name: 'georges-test-mbp', platform: 'darwin', daemonVersion: '0.1.1' }));
    expect(r1.machineId).toBe(r2.machineId);
    expect((await send(george, { type: 'machine.heartbeat', machineId: r1.machineId })).status).toBe(200);
    expect((await send(patch, { type: 'machine.register', workspace: WS, name: 'agent-cannot', platform: 'darwin', daemonVersion: '0' })).status).toBe(403);

    const a1 = await j(await send(george, { type: 'agent.register', workspace: WS, machineId: r1.machineId, name: 'echo', channels: ['dev'] }));
    const a2 = await j(await send(george, { type: 'agent.register', workspace: WS, machineId: r1.machineId, name: 'echo', channels: ['dev', 'general'] }));
    expect(a1.agentId).toBe(a2.agentId);
    expect((await send(george, { type: 'agent.register', workspace: WS, machineId: r1.machineId, name: 'ghost', channels: ['nope'] })).status).toBe(404);

    // credentials: agent > workspace precedence, masked listing, human-only
    expect((await send(george, { type: 'credential.set', workspace: WS, scope: 'workspace', token: 'sk-ant-workspace-1234' })).status).toBe(200);
    const hdr = { headers: { 'x-nm-actor': JSON.stringify(george) } };
    const rw = await j(await app!.request(`/v1/credentials/resolve?workspace=${WS}&agentId=${a1.agentId}`, hdr));
    expect(rw.source).toBe('workspace');
    expect((await send(george, { type: 'credential.set', workspace: WS, scope: 'agent', agentId: a1.agentId, token: 'sk-ant-agent-5678' })).status).toBe(200);
    const ra = await j(await app!.request(`/v1/credentials/resolve?workspace=${WS}&agentId=${a1.agentId}`, hdr));
    expect(ra.source).toBe('agent');
    expect(ra.token.endsWith('5678')).toBe(true);
    const list = await j(await app!.request(`/v1/credentials?workspace=${WS}`, hdr));
    expect(list.credentials.every((c: any) => c.last4 && !('token' in c))).toBe(true);
    expect((await send(patch, { type: 'credential.set', workspace: WS, scope: 'workspace', token: 'sk-ant-bad-00000' })).status).toBe(403);
  });

  it('offers validate channel registration', async () => {
    const ok = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'offered work', kind: 'feature', offerTo: 'echo' }));
    expect(ok.task.offeredAgentId).toBeTruthy();
    // gem is registered to #dev only (fixtures) — offering in #general must fail
    expect((await send(george, { type: 'task.create', workspace: WS, channel: 'general', title: 'bad offer', kind: 'feature', offerTo: 'gem' })).status).toBe(404);
    expect((await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'ghost offer', kind: 'feature', offerTo: 'nobody' })).status).toBe(404);
  });

  it('offers an existing todo task (intake: resolve in thread, then offer)', async () => {
    const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'intake: dark mode toggle', kind: 'feature' }));
    expect(task.offeredAgentId).toBeNull();

    // workers may not offer; humans and orchestrators may
    expect((await send(patch, { type: 'task.offer', taskId: task.id, offerTo: 'echo' })).status).toBe(403);
    expect((await send(rex, { type: 'task.offer', taskId: task.id, offerTo: 'nobody' })).status).toBe(404);
    // resolution may bind the repo the thread settled on — branch derived like
    // create — and carries the resolved checklist: requirements are confirmed
    // by the orchestrator who gathered them, never self-confirmed by the worker
    const offered = await j(await send(rex, {
      type: 'task.offer',
      taskId: task.id,
      offerTo: 'echo',
      repo: { id: REPO, baseRef: 'main' },
      checklist: ['toggle persists per-user', 'both themes verified'],
    }));
    expect(offered.offeredAgentId).toBeTruthy();
    const detail = await j(await app!.request(`/v1/tasks/${task.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(detail.task.repo.id).toBe(REPO);
    expect(detail.task.repo.branch).toContain('intake-dark-mode-toggle');
    expect(detail.task.requirementsConfirmed).toBe(true);
    expect(detail.task.requirements).toContain('both themes verified');

    // once claimed, re-offering is illegal — and submit needs NO separate
    // confirm step (the offer already resolved requirements)
    expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
    expect((await send(rex, { type: 'task.offer', taskId: task.id, offerTo: 'echo' })).status).toBe(409);
    const directSubmit = await send(patch, {
      type: 'task.submit',
      taskId: task.id,
      artifacts: [{ kind: 'diff', name: 'toggle.diff', content: 'diff --git a/t b/t\n+x' }],
      sha: 'abc1234',
    });
    expect((await j(directSubmit)).task.state).toBe('in_review');
  });

  it('humans close unaccepted work outright; agents cannot; accepted stays archival', async () => {
    const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'kill me from review' }));
    expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
    expect((await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['x'] })).status).toBe(200);
    expect((await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'doc', name: 'r.md', content: 'x' }] })).status).toBe(200);
    // in_review: a worker may not cancel; the human may — sanctioned board delete
    expect((await send(patch, { type: 'task.cancel', taskId: task.id })).status).toBe(403);
    expect((await j(await send(george, { type: 'task.cancel', taskId: task.id }))).task.state).toBe('closed');

    // done -> closed also human-legal; accepted stays archive-only
    const t2 = (await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'decline after approve' }))).task;
    await send(patch, { type: 'task.claim', taskId: t2.id });
    await send(patch, { type: 'task.confirm_requirements', taskId: t2.id, checklist: ['x'] });
    await send(patch, { type: 'task.submit', taskId: t2.id, artifacts: [{ kind: 'doc', name: 'r.md', content: 'x' }] });
    await send(gem, { type: 'task.approve', taskId: t2.id });
    expect((await j(await send(george, { type: 'task.cancel', taskId: t2.id }))).task.state).toBe('closed');
  });

  it('agent skills: authored by humans/orchestrator, channel + global scope, dedup, deprecate', async () => {
    const sql = postgres(DB!);
    try {
      // worker can't author; orchestrator + human can
      expect((await send(patch, { type: 'skill.create', workspace: WS, channel: 'dev', name: 'render-html', description: 'screenshot HTML deliverables fast', body: '# render-html\nUse the screenshot tool.' })).status).toBe(403);
      const made = await j(await send(rex, { type: 'skill.create', workspace: WS, channel: 'dev', name: 'render-html', description: 'screenshot HTML deliverables fast', body: '# render-html\nUse the screenshot tool.' }));
      expect(made.skillId).toBeTruthy();

      // duplicate active name in the same scope → 409
      expect((await send(george, { type: 'skill.create', workspace: WS, channel: 'dev', name: 'render-html', description: 'dup', body: 'x' })).status).toBe(409);

      // global scope (no channel) is allowed and is a different namespace
      const glob = await j(await send(george, { type: 'skill.create', workspace: WS, name: 'commit-style', description: 'house commit format', scope: 'global', body: '# commit-style\nConventional commits.' }));
      expect(glob.skillId).toBeTruthy();

      const [row] = await sql`select channel_id, scope, status, version from skills where id = ${made.skillId}`;
      expect(row!['scope']).toBe('channel');
      expect(row!['channel_id']).toBeTruthy();
      const [g] = await sql`select channel_id from skills where id = ${glob.skillId}`;
      expect(g!['channel_id']).toBeNull();

      // update bumps version; deprecate frees the name for a new active skill
      await send(rex, { type: 'skill.update', skillId: made.skillId, body: '# render-html\nUpdated.' });
      const [v] = await sql`select version from skills where id = ${made.skillId}`;
      expect(Number(v!['version'])).toBe(2);
      expect((await j(await send(george, { type: 'skill.deprecate', skillId: made.skillId }))).skillId).toBe(made.skillId);
      // name reusable after deprecation
      expect((await send(rex, { type: 'skill.create', workspace: WS, channel: 'dev', name: 'render-html', description: 'v2', body: 'y' })).status).toBe(200);

      // self-learning: a WORKER may propose a draft (not active); orchestrator promotes
      const prop = await j(await send(patch, { type: 'skill.propose', workspace: WS, channel: 'dev', name: 'deploy-preview', description: 'spin a preview', body: '# deploy-preview\nSteps.' }));
      expect(prop.skillId).toBeTruthy();
      const [d] = await sql`select status from skills where id = ${prop.skillId}`;
      expect(d!['status']).toBe('draft');
      // a re-propose of the same name+scope dedups onto the draft, bumps version
      const prop2 = await j(await send(patch, { type: 'skill.propose', workspace: WS, channel: 'dev', name: 'deploy-preview', description: 'spin a preview (v2)', body: '# deploy-preview\nBetter steps.' }));
      expect(prop2.updated).toBe(true);
      expect(prop2.skillId).toBe(prop.skillId);
      // workers can't promote; orchestrator can
      expect((await send(patch, { type: 'skill.promote', skillId: prop.skillId })).status).toBe(403);
      const promoted = await j(await send(rex, { type: 'skill.promote', skillId: prop.skillId }));
      expect(promoted.superseded).toBeNull();
      const [a] = await sql`select status from skills where id = ${prop.skillId}`;
      expect(a!['status']).toBe('active');

      // promote a draft whose name collides with an active skill → supersession
      const colProp = await j(await send(patch, { type: 'skill.propose', workspace: WS, channel: 'dev', name: 'deploy-preview', description: 'rev', body: '# v3' }));
      const colPromote = await j(await send(george, { type: 'skill.promote', skillId: colProp.skillId }));
      expect(colPromote.superseded).toBe(prop.skillId);
      const [old] = await sql`select status, superseded_by from skills where id = ${prop.skillId}`;
      expect(old!['status']).toBe('deprecated');
      expect(old!['superseded_by']).toBe(colProp.skillId);
      const [v3] = await sql`select version from skills where id = ${colProp.skillId}`;
      expect(Number(v3!['version'])).toBeGreaterThanOrEqual(2);
    } finally {
      await sql.end();
    }
  });

  it('every published table carries a single-column id (PowerSync row identity)', async () => {
    // Composite-PK tables replicate with row_id='' and collapse to one row on
    // clients — silently. The publication is the contract; enforce id on it.
    const sql = postgres(DB!);
    try {
      const published = await sql`select tablename from pg_publication_tables where pubname = 'powersync'`;
      expect(published.length).toBeGreaterThanOrEqual(8);
      expect(published.map((row) => row['tablename'])).toContain('project_repos');
      const missing = await sql`
        select pt.tablename from pg_publication_tables pt
        where pt.pubname = 'powersync' and not exists (
          select 1 from information_schema.columns c
          where c.table_schema = pt.schemaname and c.table_name = pt.tablename and c.column_name = 'id')`;
      expect(missing.map((r) => r['tablename'])).toEqual([]);
    } finally {
      await sql.end();
    }
  });

  it('invites members: owner-gated, human-only, pending until the invitee accepts', async () => {
    await store!.setWorkspacePlan(WS, { plan: 'cloud' }); // this covers invite mechanics, not the seat cap
    const inv = await j(await send(george, { type: 'workspace.invite', workspace: WS, email: 'newbie@acme.dev' }));
    expect(inv.inviteId).toBeTruthy();

    // THE CHANGE (docs/27 §1d): an invite does NOT create a member. The old flow made a
    // Supabase auth user in a Clerk world, so the invitee later resolved to a different
    // nm_users id with no membership. Nobody joins until they authenticate.
    const pending = await store!.pendingInvites(WS);
    expect(pending.map((p) => p.email)).toContain('newbie@acme.dev');
    const sql = postgres(DB!);
    const members = await sql`select 1 from workspace_members wm join nm_users u on u.id = wm.user_id
      where wm.workspace_id = ${WS}::uuid and u.email = 'newbie@acme.dev'`;
    expect(members).toHaveLength(0);

    // resending rotates the token on the SAME row, so it can never fork into two claimable links
    const again = await j(await send(george, { type: 'workspace.invite', workspace: WS, email: 'newbie@acme.dev' }));
    expect(again.inviteId).toBe(inv.inviteId);
    expect(await store!.pendingInvites(WS)).toHaveLength(pending.length);

    // ACCEPTING is what creates the membership (0113) — signing in only surfaces the invitation.
    const claimantId = (await sql`insert into nm_users (clerk_user_id, email) values ('clerk_newbie', 'newbie@acme.dev') returning id`)[0]!['id'] as string;
    await sql.end();
    const waiting = await store!.pendingInvitesForEmail('NEWBIE@acme.dev'); // case-insensitive
    expect(waiting.map((i) => i.workspaceId)).toContain(WS);
    expect(await store!.pendingInvites(WS)).toHaveLength(pending.length); // still pending: reading joins nobody
    await store!.acceptInvite(waiting[0]!.inviteId, claimantId, 'newbie@acme.dev');
    expect(await store!.pendingInvites(WS)).toHaveLength(pending.length - 1);
    // and it cannot be accepted twice
    await expect(store!.acceptInvite(waiting[0]!.inviteId, claimantId, 'newbie@acme.dev')).rejects.toThrow();

    expect((await send(rex, { type: 'workspace.invite', workspace: WS, email: 'bot@acme.dev' })).status).toBe(403);
  });

  it('memory blocks: orchestrator/human upsert, workers blocked', async () => {
    const r1 = await j(await send(rex, { type: 'memory.refresh_block', workspace: WS, channel: 'dev', content: 'dev is busy', basisCount: 4 }));
    expect(r1.blockId).toBeTruthy();
    const r2 = await j(await send(george, { type: 'memory.refresh_block', workspace: WS, channel: 'dev', content: 'dev is calmer now', basisCount: 9 }));
    expect(r2.blockId).toBe(r1.blockId); // upsert, not duplicate
    expect((await send(patch, { type: 'memory.refresh_block', workspace: WS, channel: 'dev', content: 'nope', basisCount: 1 })).status).toBe(403);
  });

  it('recall finds channel history and respects workspace scope', async () => {
    await app!.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
      body: JSON.stringify({ workspace: WS, channel: 'dev', body: 'we decided to adopt the worktree push-before-review flow' }),
    });
    const r = await j(await app!.request('/v1/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
      body: JSON.stringify({ workspace: WS, query: 'push-before-review worktree', k: 5 }),
    }));
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
    expect(r.hits[0].body).toContain('push-before-review');
    const other = await j(await app!.request('/v1/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
      body: JSON.stringify({ workspace: 'f0000000-0000-0000-0000-00000000000f', query: 'push-before-review', k: 5 }),
    }));
    expect(other.hits).toHaveLength(0);
  });

  it('facts reconcile with bitemporal supersession', async () => {
    const a1 = await j(await send(rex, { type: 'memory.upsert_fact', workspace: WS, channel: 'dev', content: 'the team decided to use REST for the public api' }));
    expect(a1.decision).toBe('add');
    const a2 = await j(await send(rex, { type: 'memory.upsert_fact', workspace: WS, channel: 'dev', content: 'the team decided to use GraphQL for the public api' }));
    expect(a2.decision).toBe('update');
    const a3 = await j(await send(rex, { type: 'memory.upsert_fact', workspace: WS, channel: 'dev', content: 'the team decided to use GraphQL for the public api' }));
    expect(a3.decision).toBe('noop');
    expect(a3.factId).toBe(a2.factId);
    expect((await send(patch, { type: 'memory.upsert_fact', workspace: WS, channel: 'dev', content: 'workers cannot write facts' })).status).toBe(403);

    // the superseded fact stays queryable both ways (Graphiti pattern)
    const sql = postgres(DB!);
    try {
      const [old] = await sql`select valid_until, superseded_by from facts where id = ${a1.factId}`;
      expect(old!['valid_until']).not.toBeNull();
      expect(old!['superseded_by']).toBe(a2.factId);
    } finally {
      await sql.end();
    }

    // recall surfaces only the VALID fact, tagged as a fact
    const r = await j(await app!.request('/v1/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
      body: JSON.stringify({ workspace: WS, query: 'public api', k: 5 }),
    }));
    const facts = r.hits.filter((h: any) => h.kind === 'fact');
    expect(facts.length).toBe(1);
    expect(facts[0].body).toContain('GraphQL');
  });

  it('lessons: any teammate records, kind-scoped reconcile, provenance in channel memory', async () => {
    // a plain fact with overlapping wording, written first — the kind-isolation probe
    const probe = await j(await send(rex, { type: 'memory.upsert_fact', workspace: WS, channel: 'dev', content: 'mock evidence HTML files are review evidence for tasks' }));
    expect(probe.decision).toBe('add');

    // a task for provenance (a lesson usually comes out of a review round on one)
    const create = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'polish the sign-in evidence flow' }));
    const task = create.task as { id: string; number: number };

    // the corrected WORKER records the lesson — allowed, unlike plain facts (403 above)
    const l1 = await j(await send(patch, {
      type: 'memory.record_lesson', workspace: WS, channel: 'dev',
      content: 'mock evidence HTML files are review evidence for tasks — never commit them', taskId: task.id,
    }));
    expect(l1.decision).toBe('add'); // kind-scoped: did NOT supersede the similar plain fact

    // the overlapping plain fact is untouched (a lesson never invalidates a decision-fact)
    const sql2 = postgres(DB!);
    try {
      const [pf] = await sql2`select valid_until, kind from facts where id = ${probe.factId}`;
      expect(pf!['valid_until']).toBeNull();
      expect(pf!['kind']).toBe('fact');
    } finally {
      await sql2.end();
    }

    // exact repeat (any teammate) → noop; near rephrasing → bitemporal supersession
    const l2 = await j(await send(gem, {
      type: 'memory.record_lesson', workspace: WS, channel: 'dev',
      content: 'mock evidence HTML files are review evidence for tasks — never commit them',
    }));
    expect(l2.decision).toBe('noop');
    expect(l2.factId).toBe(l1.factId);
    const l3 = await j(await send(patch, {
      type: 'memory.record_lesson', workspace: WS, channel: 'dev',
      content: 'mock evidence HTML files are review evidence for tasks — never commit them; attach renders as artifacts', taskId: task.id,
    }));
    expect(l3.decision).toBe('update');

    // channel memory surfaces the lesson kind + task provenance for the Memory view
    const mem = await j(await app!.request(`/v1/memory?workspace=${WS}&channel=dev`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    const lesson = mem.facts.find((f: any) => f.id === l3.factId);
    expect(lesson).toBeTruthy();
    expect(lesson.kind).toBe('lesson');
    expect(lesson.taskNumber).toBe(task.number);
    expect(lesson.validUntil).toBeNull();

    // provenance must be real: an unknown task id is a clean 404, not a 500
    expect((await send(patch, {
      type: 'memory.record_lesson', workspace: WS, channel: 'dev',
      content: 'a lesson pointing at a task that does not exist', taskId: '00000000-0000-0000-0000-0000000000ff',
    })).status).toBe(404);
  });

  it('lesson curation: retire is human/orchestrator-only, bitemporal, and a correction supersedes', async () => {
    const create = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'harden the retry loop' }));
    const task = create.task as { id: string };
    const l1 = await j(await send(patch, {
      type: 'memory.record_lesson', workspace: WS, channel: 'dev',
      content: 'exponential backoff caps at five retries — burst loops melt the rate limiter', taskId: task.id,
    }));
    expect(l1.decision).toBe('add');

    // authz is structural: the teammates who may WRITE lessons cannot retire one
    expect((await send(patch, { type: 'memory.retire_fact', factId: l1.factId })).status).toBe(403);
    expect((await send(gem, { type: 'memory.retire_fact', factId: l1.factId })).status).toBe(403);

    // the human retires it: valid_until closes, the row + provenance stay, no successor
    const r1 = await j(await send(george, { type: 'memory.retire_fact', factId: l1.factId }));
    expect(r1.retired).toBe(true);
    const sql = postgres(DB!);
    try {
      const [row] = await sql`select valid_until, superseded_by, task_id from facts where id = ${l1.factId}`;
      expect(row!['valid_until']).not.toBeNull();
      expect(row!['superseded_by']).toBeNull(); // retired, not superseded — no successor
      expect(row!['task_id']).toBe(task.id); // bitemporal history keeps provenance
    } finally {
      await sql.end();
    }

    // idempotent: a second retire (orchestrator this time — also allowed) is a clean noop
    const r2 = await j(await send(rex, { type: 'memory.retire_fact', factId: l1.factId }));
    expect(r2.retired).toBe(false);
    // the Memory view shows it retired; prompt injection filters on validUntil
    const mem = await j(await app!.request(`/v1/memory?workspace=${WS}&channel=dev`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(mem.facts.find((f: any) => f.id === l1.factId).validUntil).not.toBeNull();
    // unknown fact → 404, not a 500
    expect((await send(george, { type: 'memory.retire_fact', factId: '00000000-0000-0000-0000-0000000000fe' })).status).toBe(404);

    // correct-this-lesson, rewrite path: the correction shares too few words for the
    // reconcile to catch (<0.6 overlap), so the UI retires the old lesson naming the
    // successor — the supersession chain holds exactly as if the reconcile had hit
    const l2 = await j(await send(patch, {
      type: 'memory.record_lesson', workspace: WS, channel: 'dev',
      content: 'integration specs stub the wall clock — timer-based waits flake under parallel CI',
    }));
    const fix = await j(await send(george, {
      type: 'memory.record_lesson', workspace: WS, channel: 'dev',
      content: 'use fake timers in every async test; real sleeps are nondeterministic on loaded runners',
    }));
    expect(fix.decision).toBe('add'); // full rewrite — the overlap check did not supersede
    const r3 = await j(await send(george, { type: 'memory.retire_fact', factId: l2.factId, supersededBy: fix.factId }));
    expect(r3.retired).toBe(true);
    const sql2 = postgres(DB!);
    try {
      const [row] = await sql2`select valid_until, superseded_by from facts where id = ${l2.factId}`;
      expect(row!['valid_until']).not.toBeNull();
      expect(row!['superseded_by']).toBe(fix.factId);
    } finally {
      await sql2.end();
    }

    // a successor that does not exist is a clean 404 (FK-safe) and the target stays valid
    const l3 = await j(await send(patch, {
      type: 'memory.record_lesson', workspace: WS, channel: 'dev',
      content: 'artifact names get slugified before they render in the cockpit file tree',
    }));
    expect((await send(george, { type: 'memory.retire_fact', factId: l3.factId, supersededBy: '00000000-0000-0000-0000-0000000000fd' })).status).toBe(404);
    const mem2 = await j(await app!.request(`/v1/memory?workspace=${WS}&channel=dev`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(mem2.facts.find((f: any) => f.id === l3.factId).validUntil).toBeNull();
  });

  it('workspace.create: owner membership + general channel + default project', async () => {
    const r = await j(await send(george, { type: 'workspace.create', name: 'Beta Co', slug: 'beta-co' }));
    expect(r.workspaceId).toBeTruthy();
    expect(r.channelId).toBeTruthy();
    const mine = await j(await app!.request('/v1/workspaces', { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    const beta = mine.workspaces.find((w: any) => w.slug === 'beta-co');
    expect(beta.role).toBe('owner');
    expect((await send(george, { type: 'workspace.create', name: 'Beta Again', slug: 'beta-co' })).status).toBe(409);
    expect((await send(rex, { type: 'workspace.create', name: 'Bot Co', slug: 'bot-co' })).status).toBe(403);
    // the new workspace is immediately usable across all four default channels
    // (#build is the engineering room since the channel-kinds work — né #dev)
    for (const ch of ['general', 'build', 'research', 'marketing']) {
      const t = await send(george, { type: 'task.create', workspace: r.workspaceId, channel: ch, title: `hello ${ch}` });
      expect(t.status).toBe(200);
    }
  });

  it('projects own channels (1:N): one default per workspace, create, channel.assign, default-archive guard, task derives project', async () => {
    const ws = (await j(await send(george, { type: 'workspace.create', name: 'Proj Co', slug: 'proj-co' }))).workspaceId;
    const sql = postgres(DB!);
    // exactly ONE default project per workspace, and every starter channel belongs to it
    const defs = await sql`select id from projects where workspace_id = ${ws}::uuid and is_default = true`;
    expect(defs.length).toBe(1);
    const defId = defs[0]!['id'] as string;
    const starter = await sql`select count(*)::int as n from channels where workspace_id = ${ws}::uuid and project_id = ${defId}::uuid`;
    expect(starter[0]!['n']).toBe(4); // general/build/research/marketing all in the default project
    // a task's project is its channel's project (derived, 1:N)
    await send(george, { type: 'task.create', workspace: ws, channel: 'build', title: 'in default' });
    const [t1] = await sql`select project_id from tasks where workspace_id = ${ws}::uuid and title = 'in default'`;
    expect(t1!['project_id']).toBe(defId);
    // create a project (channels optional — moved in next); ws-unique slug
    const created = await j(await send(george, { type: 'project.create', workspace: ws, name: 'Landing Page', description: 'the site', website: 'https://landing.dev', logoUrl: 'data:image/png;base64,iVBORw0KGgo=' }));
    expect(created.slug).toBe('landing-page');
    const pid = created.projectId;
    expect((await j(await send(george, { type: 'project.create', workspace: ws, name: 'Landing Page' }))).slug).toBe('landing-page-2');
    // identity round-trip: create stored both; a name-only update keeps them; '' clears the
    // logo but not the website (per-column patch — the case/nullif SQL under test)
    let [idrow] = await sql`select website, logo_url from projects where id = ${pid}::uuid`;
    expect(idrow!['website']).toBe('https://landing.dev');
    expect(idrow!['logo_url']).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect((await send(george, { type: 'project.update', project: pid, name: 'Landing' })).status).toBe(200);
    expect((await send(george, { type: 'project.update', project: pid, logoUrl: '' })).status).toBe(200);
    [idrow] = await sql`select name, website, logo_url from projects where id = ${pid}::uuid`;
    expect(idrow!['name']).toBe('Landing');
    expect(idrow!['website']).toBe('https://landing.dev'); // untouched by the other patches
    expect(idrow!['logo_url']).toBeNull(); // cleared
    // move #marketing into the new project (1:N); a new task there now derives the project
    expect((await send(george, { type: 'channel.assign', channel: (await sql`select id from channels where workspace_id=${ws}::uuid and slug='marketing'`)[0]!['id'], project: pid })).status).toBe(200);
    const [mk] = await sql`select project_id from channels where workspace_id = ${ws}::uuid and slug = 'marketing'`;
    expect(mk!['project_id']).toBe(pid);
    await send(george, { type: 'task.create', workspace: ws, channel: 'marketing', title: 'hero copy' });
    const [t2] = await sql`select project_id from tasks where workspace_id = ${ws}::uuid and title = 'hero copy'`;
    expect(t2!['project_id']).toBe(pid); // derived from the channel's (new) project
    // the workspace default project cannot be archived
    expect((await j(await send(george, { type: 'project.archive', project: defId }))).code).toBe('NOT_PERMITTED');
    // archiving keeps the project's channels (slugs are unique per project, so returning
    // them to the default would collide on slug); workers can't manage projects
    expect((await send(patch, { type: 'project.archive', project: pid })).status).toBe(403);
    expect((await send(george, { type: 'project.archive', project: pid })).status).toBe(200);
    const [mk2] = await sql`select project_id from channels where workspace_id = ${ws}::uuid and slug = 'marketing'`;
    expect(mk2!['project_id']).toBe(pid); // channels stay with the archived project
    await sql.end();
  });

  it('account deletion: sole-member workspace purge, then the account', async () => {
    // a throwaway user with their own workspace. Post-0032 the user FKs point at nm_users
    // (a Clerk user has no auth.users row), so seed both — the email lookup reads auth.users,
    // workspace_members.user_id references nm_users.
    const sql = postgres(DB!);
    const tmpId = (await sql`insert into auth.users (email) values ('leaver@acme.dev') returning id`)[0]!['id'] as string;
    await sql`insert into nm_users (id, clerk_user_id, email) values (${tmpId}, ${tmpId}::text, 'leaver@acme.dev')`;
    await sql.end();
    const leaver: Actor = { kind: 'human', id: tmpId };
    const made = await j(await send(leaver, { type: 'workspace.create', name: 'Solo Co', slug: 'solo-co' }));

    // account blocked while the workspace exists
    expect((await send(leaver, { type: 'account.delete' })).status).toBe(409);
    // non-owner cannot delete it; owner of a multi-member workspace cannot either.
    // The second member of WS is created HERE rather than inherited from the invite test:
    // invites are pending until claimed now, and depending on another test's side effect for
    // this precondition is what let the 409 silently become a 200 that wiped the shared
    // workspace out from under every test after it.
    const sqlM = postgres(DB!);
    await sqlM`insert into workspace_members (workspace_id, user_id, role)
      values (${WS}::uuid, ${tmpId}::uuid, 'member') on conflict do nothing`;
    await sqlM.end();
    expect((await send(george, { type: 'workspace.delete', workspace: made.workspaceId })).status).toBe(404);
    expect((await send(george, { type: 'workspace.delete', workspace: WS })).status).toBe(409);
    const sqlU = postgres(DB!);
    await sqlU`delete from workspace_members where workspace_id = ${WS}::uuid and user_id = ${tmpId}::uuid`;
    await sqlU.end();

    // sole member deletes their workspace (events purge under the GUC) …
    expect((await send(leaver, { type: 'workspace.delete', workspace: made.workspaceId })).status).toBe(200);
    // … and only then the account
    expect((await j(await send(leaver, { type: 'account.delete' }))).ok).toBe(true);
    // the audit log is still append-only outside the sanctioned path
    const sql2 = postgres(DB!);
    await expect(sql2`delete from events where workspace_id = ${WS}::uuid`).rejects.toThrow(/append-only/);
    await sql2.end();
  });

  it('posts channel and thread messages', async () => {
    const res = await app!.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
      body: JSON.stringify({ workspace: WS, channel: 'dev', body: 'hello from the real stack' }),
    });
    expect(res.status).toBe(200);
    const { message, event } = await j(res);
    expect(message.id).toBeTruthy();
    expect(event.type).toBe('message.posted');
  });

  it('blocked_from on the real schema: stamp on block, return on unblock, trigger accepts the new pairs', async () => {
    const iris: Actor = { kind: 'agent', id: '50000000-0000-0000-0000-000000000005', role: 'designer' };
    const create = await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'blocked mid-design (pg)', kind: 'feature' });
    const { task } = await j(create);
    await send(rex, { type: 'task.request_design', taskId: task.id, designer: iris.id });
    expect((await send(iris, { type: 'task.block', taskId: task.id, reason: 'agy login expired' })).status).toBe(200);

    const sql = postgres(DB!);
    try {
      const [row] = await sql`select state, blocked_from from tasks where id = ${task.id}`;
      expect(row!['state']).toBe('blocked');
      expect(row!['blocked_from']).toBe('designing');
      // the guard trigger still rejects a raw ILLEGAL jump out of blocked
      // (blocked -> in_review is legal now — it's the unblock return edge)
      await expect(sql`update tasks set state = 'done' where id = ${task.id}`).rejects.toThrow(/illegal task transition/);
    } finally {
      await sql.end();
    }

    const un = await send(george, { type: 'task.unblock', taskId: task.id });
    expect(un.status).toBe(200);
    const unT = (await j(un)).task;
    expect(unT.state).toBe('designing'); // resumes ITS stage — the designer watch re-fires
    expect(unT.blockedFrom).toBeNull();
  });

  it('design stage on the real schema: trigger pairs, design artifacts, human-only approve, latest-round promotion', async () => {
    const iris: Actor = { kind: 'agent', id: '50000000-0000-0000-0000-000000000005', role: 'designer' };
    const create = await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'settings page redesign', kind: 'feature' });
    expect(create.status).toBe(200);
    const { task } = await j(create);

    // route into design (assigns the designer); the DB trigger accepts the 0052 pair
    const routed = await send(rex, { type: 'task.request_design', taskId: task.id, designer: iris.id });
    expect(routed.status).toBe(200);
    expect((await j(routed)).task.state).toBe('designing');

    // designer-only proposal lands 'design'-kind artifact rows with inline content
    expect((await send(patch, { type: 'task.propose_design', taskId: task.id, round: 1, mockups: [{ name: 'x', html: '<html/>' }] })).status).toBe(403);
    const p1 = await send(iris, {
      type: 'task.propose_design', taskId: task.id, round: 1,
      mockups: [{ name: 'Settings light', html: '<html>light</html>' }, { name: 'Settings dense', html: '<html>dense</html>' }],
    });
    expect(p1.status).toBe(200);
    expect((await j(p1)).task.state).toBe('design_review');

    // no agent approves a design — not the orchestrator, not the designer
    expect((await j(await send(rex, { type: 'task.approve_design', taskId: task.id }))).code).toBe('HUMAN_ONLY');
    // revise (trigger pair design_review -> designing), then a second round
    expect((await send(george, { type: 'task.revise_design', taskId: task.id, feedback: 'denser header, keep the light one' })).status).toBe(200);
    expect((await send(iris, { type: 'task.propose_design', taskId: task.id, round: 2, mockups: [{ name: 'Settings final', html: '<html>final</html>' }] })).status).toBe(200);

    // the human gate: approve releases it to planning and promotes ONLY round 2
    const approved = await send(george, { type: 'task.approve_design', taskId: task.id });
    expect(approved.status).toBe(200);
    const approvedTask = (await j(approved)).task;
    expect(approvedTask.state).toBe('planning');
    expect(approvedTask.assignee).toBeNull();

    const sql = postgres(DB!);
    try {
      const rows = await sql`select kind, name, promoted, inline_content from artifacts where task_id = ${task.id} order by name`;
      expect(rows.map((r) => [r['kind'], r['name'], r['promoted']])).toEqual([
        ['design', 'design-mockup-v1-settings-dense.html', false],
        ['design', 'design-mockup-v1-settings-light.html', false],
        ['design', 'design-mockup-v2-settings-final.html', true],
      ]);
      expect(rows[2]!['inline_content']).toBe('<html>final</html>');
      // and the guard trigger rejects an illegal design jump outright
      await expect(sql`update tasks set state = 'design_review' where id = ${task.id}`).rejects.toThrow(/illegal task transition/);
    } finally {
      await sql.end();
    }
  });

  it('backlog on the real schema: any-agent create, no offer/claim, trigger pairs, details persist (docs/15)', async () => {
    // a worker parks an idea straight onto the real schema — the one open creation path
    const create = await send(patch, { type: 'task.create', workspace: WS, channel: 'dev', title: 'idea: usage analytics spike (pg)', backlog: true });
    expect(create.status).toBe(200);
    const { task } = await j(create);
    expect(task.state).toBe('backlog');

    // …but a worker still can't create live todo work
    expect((await send(patch, { type: 'task.create', workspace: WS, channel: 'dev', title: 'sneaky live task (pg)' })).status).toBe(403);

    // parked items are unreachable by the loop on the real store
    expect((await send(rex, { type: 'task.offer', taskId: task.id, offerTo: 'patch' })).status).toBe(409);
    expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(409);
    expect((await send(patch, { type: 'task.promote', taskId: task.id })).status).toBe(403);

    // the scratch-board edit persists to the real row
    expect((await send(george, { type: 'task.update_details', taskId: task.id, title: 'Usage analytics spike', description: 'Instrument the top 5 flows first.' })).status).toBe(200);

    const sql = postgres(DB!);
    try {
      const [row] = await sql`select state, title, description from tasks where id = ${task.id}`;
      expect(row!['state']).toBe('backlog');
      expect(row!['title']).toBe('Usage analytics spike');
      expect(row!['description']).toBe('Instrument the top 5 flows first.');
      // the DB trigger rejects raw illegal jumps out of backlog (defense-in-depth
      // behind the server) — work can never start from a parked idea
      await expect(sql`update tasks set state = 'in_progress' where id = ${task.id}`).rejects.toThrow(/illegal task transition/);
      await expect(sql`update tasks set state = 'designing' where id = ${task.id}`).rejects.toThrow(/illegal task transition/);
    } finally {
      await sql.end();
    }

    // a human promotes on the real trigger pair; the normal loop applies from todo
    const promoted = await send(george, { type: 'task.promote', taskId: task.id });
    expect(promoted.status).toBe(200);
    expect((await j(promoted)).task.state).toBe('todo');
    expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
  });
});
