// a workspace's first project starts with the release gate off (docs/23), against the real schema.
// workspace.create births the default project, and every starter room lives in it, so a person's
// first pull request ends on their word: review passes, they say merge, and the orchestrator
// accepts. no shipper claim, no release plan. every later project keeps the column default (on),
// and a person turns the gate on for the first project in Project settings (project.update).
// run via scripts/test-pg.sh, skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: '30000000-0000-0000-0000-000000000003', role: 'worker' };
const gem: Actor = { kind: 'agent', id: '40000000-0000-0000-0000-000000000004', role: 'reviewer' };
const bosun: Actor = { kind: 'agent', id: '50000000-0000-0000-0000-000000000005', role: 'shipper' };

afterAll(async () => { await sql?.end(); await store?.close(); });

const hdr = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const send = (actor: Actor, body: unknown) => app!.request('/v1/commands', { method: 'POST', headers: hdr(actor), body: JSON.stringify(body) });

async function person(tag: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${`clerk_gate_${tag}`}, ${`gate-${tag}@sign.test`}) returning id`;
  return { kind: 'human', id: row!['id'] as string };
}

/** a new workspace through the real door, with its first project's id */
async function newWorkspace(owner: Actor, slug: string): Promise<{ ws: string; first: string }> {
  const res = await send(owner, { type: 'workspace.create', name: slug, slug });
  expect(res.status).toBe(200);
  const ws = (await j(res)).workspaceId as string;
  const [p] = await sql!`select id from projects where workspace_id = ${ws}::uuid and is_default`;
  return { ws, first: p!['id'] as string };
}

const gateOf = async (projectId: string): Promise<unknown> => (await sql!`select ship_gate from projects where id = ${projectId}::uuid`)[0]!['ship_gate'];

/** a pull request in the starter #build room: created, claimed, submitted with its PR, approved by the reviewer */
async function throughReview(owner: Actor, ws: string, tag: string): Promise<{ id: string }> {
  const [repo] = await sql!`insert into repos (workspace_id, org_name, name, clone_url)
    values (${ws}::uuid, 'acme', ${`first-pr-${tag}`}, ${`git@github.com:acme/first-pr-${tag}.git`}) returning id`;
  const created = await send(owner, { type: 'task.create', workspace: ws, channel: 'build', title: 'the first pull request', repo: { id: repo!['id'] as string, baseRef: 'main' } });
  expect(created.status).toBe(200);
  const { task } = await j(created);
  expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
  expect((await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['repo access'] })).status).toBe(200);
  const submitted = await send(patch, {
    type: 'task.submit',
    taskId: task.id,
    artifacts: [{ kind: 'diff', name: 'first.diff', content: 'diff --git a/x b/x\n+y' }],
    sha: 'abc1234',
    prUrl: `https://github.com/acme/first-pr-${tag}/pull/1`,
    prNumber: 1,
  });
  expect(submitted.status).toBe(200);
  const approved = await send(gem, { type: 'task.approve', taskId: task.id });
  expect(approved.status).toBe(200);
  expect((await j(approved)).task.state).toBe('done');
  return task as { id: string };
}

describe.skipIf(!DB)('a workspace’s first project starts with the release gate off (postgres)', () => {
  it('the first project is born with the gate off and holds every starter room, and a second project is born with it on', async () => {
    const tag = Date.now().toString(36);
    const owner = await person(tag);
    const { ws, first } = await newWorkspace(owner, `gate-${tag}`);

    const born = await sql!`select id, is_default, ship_gate from projects where workspace_id = ${ws}::uuid`;
    expect(born).toHaveLength(1);
    expect(born[0]).toMatchObject({ id: first, is_default: true, ship_gate: false });
    const rooms = await sql!`select slug from channels where workspace_id = ${ws}::uuid and project_id = ${first}::uuid order by slug`;
    expect(rooms.map((r) => r['slug'])).toEqual(['build', 'general', 'marketing', 'research']);

    const made = await send(owner, { type: 'project.create', workspace: ws, name: 'Second project' });
    expect(made.status).toBe(200);
    expect(await gateOf((await j(made)).projectId as string)).toBe(true);
  });

  it('with the gate off, the shipper cannot claim the reviewed PR, and the person’s word lets the orchestrator accept it', async () => {
    const tag = `${Date.now().toString(36)}a`;
    const owner = await person(tag);
    const { ws } = await newWorkspace(owner, `gate-accept-${tag}`);
    const task = await throughReview(owner, ws, tag);

    const claim = await send(bosun, { type: 'task.claim_ship', taskId: task.id });
    expect(claim.status).toBe(403);
    expect((await j(claim)).code).toBe('NOT_PERMITTED');

    // no word yet: the old floor holds
    const early = await send(rex, { type: 'task.accept', taskId: task.id });
    expect(early.status).toBe(403);
    expect((await j(early)).code).toBe('HUMAN_ONLY');

    // what the verdict card asks for: the person says merge in the task's thread
    const said = await app!.request('/v1/messages', { method: 'POST', headers: hdr(owner), body: JSON.stringify({ workspace: ws, channel: 'build', taskId: task.id, body: 'merge it' }) });
    expect(said.status).toBe(200);
    const accepted = await send(rex, { type: 'task.accept', taskId: task.id });
    expect(accepted.status).toBe(200);
    const out = await j(accepted);
    expect(out.task.state).toBe('accepted');
    expect(typeof out.onWord?.id).toBe('string');
  });

  it('a person turns the gate on for the first project, and the shipper then claims the reviewed PR', async () => {
    const tag = `${Date.now().toString(36)}o`;
    const owner = await person(tag);
    const { ws, first } = await newWorkspace(owner, `gate-on-${tag}`);
    expect(await gateOf(first)).toBe(false);

    expect((await send(owner, { type: 'project.update', project: first, shipGate: true })).status).toBe(200);
    expect(await gateOf(first)).toBe(true);

    const task = await throughReview(owner, ws, tag);
    const claim = await send(bosun, { type: 'task.claim_ship', taskId: task.id });
    expect(claim.status).toBe(200);
    expect((await j(claim)).task.state).toBe('shipping');
  });
});
