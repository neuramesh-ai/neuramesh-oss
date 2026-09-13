// The first hosted sign-in creates the workspace (source release 2026-09, unit U1b), once.
// The name and slug are derived from the Clerk profile, the slug de-duplicates by asking, a
// person with a membership or an invitation waiting gets nothing, and POST /auth/clerk lands a
// workspace that GET /v1/workspaces lists with role and plan, which is what the site's
// pickWorkspace reads (apps/web pro-handoff.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { ensureFirstWorkspace, firstWorkspaceName, firstWorkspaceSlug } from '../src/first-workspace';
import { onAuthArrival } from '../src/onauth';
import { MemoryStore } from '../src/store';

vi.mock('../src/clerk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/clerk')>();
  return {
    ...actual,
    verifyClerkToken: vi.fn(async (token: string) => ({ sub: `clerk_${token}`, sid: `sid_${token}` })),
    clerkPrimaryEmail: vi.fn(async (clerkId: string) => ({ email: `${clerkId.slice(6)}@first.test`, verified: true, firstName: clerkId === 'clerk_ada' ? 'Ada' : null })),
  };
});

const j = (r: Response): Promise<any> => r.json() as Promise<any>;

describe('the name and the slug', () => {
  it.each([
    ['Ada', 'ada@x.dev', "Ada's workspace", 'ada'],
    ['Ada Lovelace', null, "Ada Lovelace's workspace", 'ada-lovelace'],
    [null, 'ada.lovelace+nm@x.dev', "ada.lovelace+nm's workspace", 'ada-lovelace-nm'],
    ['  ', 'x@x.dev', "x's workspace", 'x-workspace'],
    [null, null, 'My workspace', 'workspace'],
    ['日本', null, "日本's workspace", 'workspace'],
  ])('first name %j and email %j give %j and %j', (first, email, name, slug) => {
    expect(firstWorkspaceName(first, email)).toBe(name);
    expect(firstWorkspaceSlug(first, email)).toBe(slug);
  });

  it('keeps the name under the command cap and the slug under 37 so a counter fits', () => {
    const long = 'a'.repeat(80);
    expect(firstWorkspaceName(long, null).length).toBeLessThanOrEqual(60);
    expect(firstWorkspaceSlug(long, null).length).toBeLessThanOrEqual(36);
    expect(firstWorkspaceSlug(long, null)).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });
});

describe('ensureFirstWorkspace', () => {
  const local = process.env['NM_LOCAL'];
  beforeEach(() => { delete process.env['NM_LOCAL']; });
  afterEach(() => { if (local === undefined) delete process.env['NM_LOCAL']; else process.env['NM_LOCAL'] = local; });

  it('creates once: the second call sees the membership and makes nothing', async () => {
    const store = new MemoryStore();
    const u = '10000000-0000-0000-0000-000000000001';
    const made = await ensureFirstWorkspace(store, { userId: u, email: 'ada@x.dev', firstName: 'Ada', pending: [] });
    expect(made).toEqual({ workspaceId: expect.any(String), slug: 'ada' });
    expect(await ensureFirstWorkspace(store, { userId: u, email: 'ada@x.dev', firstName: 'Ada', pending: [] })).toBeNull();
    const list = await store.listWorkspaces(u);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Ada's workspace", slug: 'ada', role: 'owner', plan: 'free' });
  });

  it('a second Ada gets ada-2: the slug de-duplicates by asking', async () => {
    const store = new MemoryStore();
    await ensureFirstWorkspace(store, { userId: '10000000-0000-0000-0000-000000000001', email: null, firstName: 'Ada', pending: [] });
    const second = await ensureFirstWorkspace(store, { userId: '10000000-0000-0000-0000-000000000002', email: null, firstName: 'Ada', pending: [] });
    expect(second?.slug).toBe('ada-2');
  });

  it('an invitation waiting means no workspace: joining is the person’s own act', async () => {
    const store = new MemoryStore();
    expect(await ensureFirstWorkspace(store, { userId: '10000000-0000-0000-0000-000000000003', email: 'b@x.dev', firstName: null, pending: ['ws-someone-elses'] })).toBeNull();
    expect(await store.listWorkspaces('10000000-0000-0000-0000-000000000003')).toHaveLength(0);
  });

  it('NM_LOCAL=1: the local stack seeds its own, so nothing is created', async () => {
    process.env['NM_LOCAL'] = '1';
    const store = new MemoryStore();
    expect(await ensureFirstWorkspace(store, { userId: '10000000-0000-0000-0000-000000000004', email: 'c@x.dev', firstName: null, pending: [] })).toBeNull();
  });
});

describe('POST /auth/clerk lands a workspace the site can pick', () => {
  const savedKey = process.env['CLERK_SECRET_KEY'];
  beforeEach(() => { process.env['CLERK_SECRET_KEY'] = 'sk_test_first_workspace'; });
  afterEach(() => { if (savedKey === undefined) delete process.env['CLERK_SECRET_KEY']; else process.env['CLERK_SECRET_KEY'] = savedKey; });

  it('the first sign-in creates it, the second creates nothing, and GET /v1/workspaces carries role and plan', async () => {
    const store = new MemoryStore();
    const app = createApp(store);
    const signIn = () => app.request('/auth/clerk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'ada' }) });
    const first = await signIn();
    expect(first.status).toBe(200);
    const { userId, created } = await j(first);
    expect(created).toBe(true);

    const list = () => app.request('/v1/workspaces', { headers: { 'x-nm-actor': JSON.stringify({ kind: 'human', id: userId }) } });
    const { workspaces } = await j(await list());
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ id: expect.any(String), name: "Ada's workspace", slug: 'ada', role: 'owner', plan: 'free' });

    const second = await signIn();
    expect((await j(second)).created).toBe(false);
    expect((await j(await list())).workspaces).toHaveLength(1);
  });

  it('onAuthArrival is the hook, so every sign-in route reaches it', async () => {
    const store = new MemoryStore();
    const u = '10000000-0000-0000-0000-000000000009';
    await onAuthArrival(store, { userId: u, email: 'grace@x.dev', emailVerified: true, isNew: true, firstName: null });
    expect((await store.listWorkspaces(u))[0]).toMatchObject({ name: "grace's workspace", slug: 'grace' });
  });
});
