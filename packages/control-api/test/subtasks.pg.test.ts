// Subtasks (docs/24) against the REAL schema — migration 0071's parent_task_id,
// the new finish trigger pairs, artifact attachment to the PARENT, and the
// SUBTASKS_PENDING gate. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: '30000000-0000-0000-0000-000000000003', role: 'worker' };
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

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('subtasks on postgres (real schema + triggers)', () => {
  it('rides the parent: create → claim → finish with artifacts landing on the parent row', async () => {
    const { task: parent } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', project: 'dev', title: 'subtask pg parent', kind: 'feature' }));
    const sub = (await j(await send(bosun, { type: 'task.create', workspace: WS, channel: 'dev', title: 'readiness pass pg', parent: parent.id }))).task;
    expect(sub.parentTaskId).toBe(parent.id);

    // the fk + partial index exist and the row is queryable by parent
    const [cnt] = await sql!`select count(*) as n from tasks where parent_task_id = ${parent.id}`;
    expect(Number(cnt!['n'])).toBe(1);

    expect((await send(patch, { type: 'task.claim', taskId: sub.id })).status).toBe(200);
    // the finish pair (in_progress -> done) passes the trigger for the subtask row
    const fin = await send(patch, { type: 'task.finish_subtask', taskId: sub.id, artifacts: [{ kind: 'doc', name: 'pg-pass.md', content: '# ok' }] });
    expect(fin.status).toBe(200);
    const [art] = await sql!`select task_id from artifacts where name = 'pg-pass.md'`;
    expect(art!['task_id']).toBe(parent.id);
  });

  it('a subtask lands in its PARENT\'S channel even when another project shares the slug (round 3, found live)', async () => {
    // every project seeds the same starter slugs, and Task.channel is a SLUG — so the old
    // slug resolution filed a subtask (and its deliverables) into the first same-slug room
    // in the workspace. The parent row's channel_id is the only truth that cannot collide.
    const suffix = crypto.randomUUID().slice(0, 8);
    const proj = await j(await send(george, { type: 'project.create', workspace: WS, name: `slugtwin-${suffix}` }));
    const chan = await j(await send(george, { type: 'channel.create', workspace: WS, project: proj.projectId, slug: `dev-${suffix}` }));
    // a decoy room with the SAME slug in the DEFAULT project — the old bare-slug lookup
    // ordered by is_default desc, so this room deterministically won the resolution
    const [defProj] = await sql!`select id from projects where workspace_id = ${WS}::uuid and is_default limit 1`;
    await send(george, { type: 'channel.create', workspace: WS, project: defProj!['id'] as string, slug: `dev-${suffix}` });
    const { task: parent } = await j(await send(george, { type: 'task.create', workspace: WS, channel: chan.channelId, project: proj.projectId, title: `slugtwin parent ${suffix}`, kind: 'research' }));
    const sub = (await j(await send(rex, { type: 'task.create', workspace: WS, channel: `dev-${suffix}`, title: `slugtwin child ${suffix}`, parent: parent.id }))).task;
    const [prow] = await sql!`select channel_id from tasks where id = ${parent.id}`;
    const [srow] = await sql!`select channel_id from tasks where id = ${sub.id}`;
    expect(srow!['channel_id']).toBe(prow!['channel_id']);
  });

  it('SUBTASKS_PENDING blocks the parent accept until the boss check-off clears it', async () => {
    const { task: parent } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', project: 'dev', title: 'subtask pg gate', kind: 'feature' }));
    expect((await send(patch, { type: 'task.claim', taskId: parent.id })).status).toBe(200);
    expect((await send(patch, { type: 'task.confirm_requirements', taskId: parent.id, checklist: ['scope'] })).status).toBe(200);
    const sub = (await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'gate holder', parent: parent.id }))).task;

    const submit = await send(patch, { type: 'task.submit', taskId: parent.id, artifacts: [{ kind: 'doc', name: 'r.md', content: 'x' }] });
    expect(submit.status).toBe(422);
    expect((await j(submit)).code).toBe('SUBTASKS_PENDING');

    // human check-off straight from todo — the trigger's (todo, done) pair
    expect((await send(george, { type: 'task.finish_subtask', taskId: sub.id })).status).toBe(200);
    expect((await send(patch, { type: 'task.submit', taskId: parent.id, artifacts: [{ kind: 'doc', name: 'r.md', content: 'x' }] })).status).toBe(200);
  });

  it('the shadow-task bounce fires on the real store lookup', async () => {
    const { task: parent } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', project: 'dev', title: 'subtask pg shadow', kind: 'feature' }));
    // the bounce is judged for AGENTS, before the plan-first floor — its error carries the fix
    const shadow = await send(rex, { type: 'task.create', workspace: WS, channel: 'dev', project: 'dev', kind: 'chore', title: `readiness pass for #${parent.number}`, plan: { legs: ['build'], subtasks: [], approach: 'stub approach — plan-first fixtures (docs/41)' } });
    expect(shadow.status).toBe(409);
    expect((await j(shadow)).code).toBe('MAKE_IT_A_SUBTASK');
  });
});
