// the activation funnel's two signals on postgres (analytics.ts): a task event carries nm_repo from
// the row the store already holds for the write, and the first write of a project's GitHub
// connector row is the github.connected event, in the event log and on the tracker. runs only
// against a real database (scripts/test-pg.sh).
import { createEvent, formatAddress, type Actor, type NMEvent } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { trackDomainEvent } from '../src/analytics';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

// the tracker is a no-op without POSTHOG_KEY, so a spy sees exactly what PostHog would receive
vi.mock('../src/analytics', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/analytics')>()), trackDomainEvent: vi.fn() }));

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const WS = 'a0000000-0000-0000-0000-00000000000a';
const REPO = 'b0000000-0000-0000-0000-000000000001'; // acme/marketing-site, from the fixtures
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const patch: Actor = { kind: 'agent', id: '30000000-0000-0000-0000-000000000003', role: 'worker' };
const gem: Actor = { kind: 'agent', id: '40000000-0000-0000-0000-000000000004', role: 'reviewer' };
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const send = (actor: Actor, body: unknown) =>
  app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
/** the facts the tracker received with each event of this type on this target */
const tracked = (type: string, target: string) =>
  vi.mocked(trackDomainEvent).mock.calls.filter(([e]) => e.type === type && e.target === target).map(([, facts]) => facts);

afterAll(async () => { await sql?.end(); await store?.close?.(); });

describe.skipIf(!DB)('the funnel on postgres', () => {
  it('an accepted task with a repository and a PR tracks nm_repo true, a pushed branch with no PR tracks false', async () => {
    const accept = async (pr: Record<string, unknown>) => {
      const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', project: 'dev', title: `funnel ${Date.now()}`, repo: { id: REPO, baseRef: 'main' } }));
      expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
      expect((await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['the nav works'] })).status).toBe(200);
      const submit = { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'diff', name: 'nav.diff', content: 'diff --git a/nav.ts b/nav.ts\n+fixed' }], sha: '8f3c2d1', ...pr };
      expect((await j(await send(patch, submit))).task.state).toBe('in_review');
      expect((await j(await send(gem, { type: 'task.approve', taskId: task.id }))).task.state).toBe('done');
      expect((await j(await send(george, { type: 'task.accept', taskId: task.id }))).task.state).toBe('accepted');
      return { submitted: tracked('task.submitted', `task:${task.number}`), accepted: tracked('task.accepted', `task:${task.number}`) };
    };
    expect(await accept({ prUrl: 'https://github.com/acme/marketing-site/pull/7', prNumber: 7 })).toEqual({ submitted: [{ repo: true }], accepted: [{ repo: true }] });
    expect(await accept({})).toEqual({ submitted: [{ repo: false }], accepted: [{ repo: false }] });
  });

  it('the first write of a project\'s GitHub row is github.connected, in the event log and on the tracker, and a second write is neither', async () => {
    // a workspace of its own: the fixture workspace's plan (and so its project cap) moves under
    // the other suites, and a connector row is one per project
    const [user] = await sql!`insert into nm_users (clerk_user_id, email) values ('clerk_funnel_github', 'owner@funnel.test')
      on conflict (clerk_user_id) do update set email = excluded.email returning id`;
    const owner: Actor = { kind: 'human', id: user!['id'] as string };
    const made = await j(await send(owner, { type: 'workspace.create', name: 'Funnel', slug: `funnel-${Date.now().toString(36)}` }));
    const input = { workspace: made.workspaceId as string, channelId: made.channelId as string, provider: 'github', handle: 'acme/marketing-site', connectedBy: owner.id, scopes: 'metadata:read' };
    const make = (ws: string, id: string): NMEvent => createEvent({
      type: 'github.connected', source: formatAddress({ kind: 'human', id: owner.id }),
      target: formatAddress({ kind: 'resource', type: 'connector', id }), workspace: ws, payload: { connector: id, handle: input.handle },
    });
    const { id } = await store!.upsertConnector(input, make);
    expect((await store!.upsertConnector(input, make)).id).toBe(id);
    const rows = await sql!`select type, source, workspace_id from events where target = ${`resource/connector/${id}`}`;
    expect(rows.map((r) => ({ ...r }))).toEqual([{ type: 'github.connected', source: `human:${owner.id}`, workspace_id: input.workspace }]);
    expect(tracked('github.connected', `resource/connector/${id}`)).toEqual([undefined]);
  });
});
