// The local stack (source-release round U2, review F1/F7) on the memory store: the `nmh_` bearer,
// its PowerSync token, the two discovery routes, and the one predicate that lifts every plan gate.
//
// The identity rule under test: a TOKEN proves the human, the x-nm-actor header only names the
// author, and the bare header alone is refused unless a stack says otherwise. Any local process
// (an agent in a worktree included) can reach 127.0.0.1, so an open header would have made
// self-approval one curl — the thing the whole product promises nothing needs to prevent.
import { createHmac, randomBytes } from 'node:crypto';
import { createEvent, formatAddress, type Actor } from '@neuramesh/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { LOCAL_SYNC_AUD, LOCAL_SYNC_KID, LOCAL_USER, mintLocalToken, seedLocalUser } from '../src/local-auth';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ev = (by: string, workspace = 'acme') => createEvent({ type: 'workspace.created', source: formatAddress({ kind: 'human', id: by }), target: `resource/workspace/${workspace}`, workspace, payload: {} });

const asHeader = (actor: Actor) => ({ 'x-nm-actor': JSON.stringify(actor) });
const asBearer = (token: string) => ({ authorization: `Bearer ${token}` });
const post = (path: string, headers: Record<string, string>, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const cmd = (headers: Record<string, string>, body: unknown) => post('/v1/commands', headers, body);
const decodeJwt = (jwt: string) => {
  const [h, p] = jwt.split('.');
  return { header: JSON.parse(Buffer.from(h!, 'base64url').toString()), payload: JSON.parse(Buffer.from(p!, 'base64url').toString()) };
};

/** NM_LOCAL=1 with a seeded human: the desktop minted the bearer, only its hash reached the env */
async function localStack(): Promise<{ token: string; userId: string; key: string }> {
  vi.stubEnv('NM_LOCAL', '1');
  const { token, hash } = mintLocalToken();
  vi.stubEnv('NM_LOCAL_HUMAN_TOKEN_HASH', hash);
  const key = randomBytes(32).toString('base64url');
  vi.stubEnv('NM_SYNC_KEY', key);
  vi.stubEnv('NM_POWERSYNC_URL', 'http://127.0.0.1:58081');
  const { id } = await seedLocalUser(store);
  return { token, userId: id, key };
}

beforeEach(() => {
  vi.stubEnv('NM_ALLOW_ACTOR_HEADER', '1'); // the suites' own lane; the stack under test never relies on it
  store = new MemoryStore();
  app = createApp(store);
});
afterEach(() => vi.unstubAllEnvs());

describe('the nmh_ bearer', () => {
  it('resolves to the seeded local human', async () => {
    const { token, userId } = await localStack();
    const res = await app.request('/v1/me', { headers: asBearer(token) });
    expect(res.status).toBe(200);
    expect(await j(res)).toEqual({ actor: { kind: 'human', id: userId }, workspaces: [] });
  });

  it('is refused when unknown, and shut entirely outside NM_LOCAL=1 even for a seeded hash', async () => {
    const stranger = mintLocalToken();
    await localStack();
    const unknown = await app.request('/v1/me', { headers: asBearer(stranger.token) });
    expect(unknown.status).toBe(401);
    expect(await j(unknown)).toMatchObject({ code: 'AUTH_FAILED' });

    vi.unstubAllEnvs();
    vi.stubEnv('NM_ALLOW_ACTOR_HEADER', '1');
    const seeded = mintLocalToken();
    await store.seedLocalUser({ ...LOCAL_USER, tokenHash: seeded.hash });
    const cloud = await app.request('/v1/me', { headers: asBearer(seeded.token) });
    expect(cloud.status).toBe(401);
  });

  it('names an agent author of the human\'s own workspace through the header, and refuses a stranger', async () => {
    const { token, userId } = await localStack();
    const { workspaceId } = await store.createWorkspace({ name: 'Acme', slug: 'acme', createdBy: userId }, ev(userId));
    const rex = (await store.registerAgent({ workspace: workspaceId, machineId: 'm1', name: 'rex', role: 'orchestrator', model: 'claude-opus-5', runtime: 'claude-code', channels: [] }, ev(userId))).id;
    const body = { workspace: workspaceId, channel: 'general', body: 'from the local stack' };
    const mine = await post('/v1/messages', { ...asBearer(token), ...asHeader({ kind: 'agent', id: rex, role: 'orchestrator' }) }, body);
    expect(mine.status).toBe(200);
    expect((await j(mine)).message.author).toEqual({ kind: 'agent', id: rex });
    const theirs = await post('/v1/messages', { ...asBearer(token), ...asHeader({ kind: 'agent', id: 'ghost', role: 'worker' }) }, body);
    expect(theirs.status).toBe(403);
    // a human claim never overrides the bearer: the token says who is here
    const spoof = await post('/v1/messages', { ...asBearer(token), ...asHeader({ kind: 'human', id: 'someone-else' }) }, body);
    expect((await j(spoof)).message.author).toEqual({ kind: 'human', id: userId });
  });

  it('a re-seed ROTATES the hash: the old bearer dies, the new one lives, still one user', async () => {
    const first = await localStack();
    const next = mintLocalToken();
    const { id } = await seedLocalUser(store, next.hash);
    expect(id).toBe(first.userId);
    expect((await app.request('/v1/me', { headers: asBearer(first.token) })).status).toBe(401);
    expect((await app.request('/v1/me', { headers: asBearer(next.token) })).status).toBe(200);
  });

  it('the seed refuses a missing or malformed hash — a stack nobody can sign in to must not boot', async () => {
    vi.stubEnv('NM_LOCAL', '1');
    await expect(seedLocalUser(store, undefined)).rejects.toThrow(/NM_LOCAL_HUMAN_TOKEN_HASH/);
    await expect(seedLocalUser(store, 'nmh_not-a-hash')).rejects.toThrow(/sha256/);
  });
});

describe('POST /auth/local/token', () => {
  it('is 404 outside local mode, 401 without or with a wrong bearer, 503 without the shared key', async () => {
    expect((await post('/auth/local/token', {}, {})).status).toBe(404);
    const { token } = await localStack();
    expect((await post('/auth/local/token', {}, {})).status).toBe(401);
    expect((await post('/auth/local/token', asBearer(mintLocalToken().token), {})).status).toBe(401);
    vi.stubEnv('NM_SYNC_KEY', '');
    const noKey = await post('/auth/local/token', asBearer(token), {});
    expect(noKey.status).toBe(503);
  });

  it('mints HS256 under NM_SYNC_KEY: kid nm-local, aud powersync-local, sub = the local user, 6 h, endpoint', async () => {
    const { token, key } = await localStack();
    const res = await post('/auth/local/token', asBearer(token), {});
    expect(res.status).toBe(200);
    const body = await j(res);
    expect(body.endpoint).toBe('http://127.0.0.1:58081');
    const { header, payload } = decodeJwt(body.token);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT', kid: LOCAL_SYNC_KID });
    expect(payload.aud).toBe(LOCAL_SYNC_AUD);
    expect(payload.sub).toBe(LOCAL_USER.clerkUserId);
    expect(payload.exp - payload.iat).toBe(6 * 3600);
    // verifiable with the key PowerSync holds — the same bytes, base64url
    const [h, p, sig] = (body.token as string).split('.');
    expect(createHmac('sha256', Buffer.from(key, 'base64url')).update(`${h}.${p}`).digest('base64url')).toBe(sig);
  });

  it('/auth/dev/token stays OFF on the local stack, even with NM_ALLOW_DEV_TOKENS=1', async () => {
    vi.stubEnv('NM_ALLOW_DEV_TOKENS', '1');
    expect((await post('/auth/dev/token', {}, {})).status).toBe(200);
    await localStack();
    expect((await post('/auth/dev/token', {}, {})).status).toBe(404);
  });
});

describe('GET /.well-known/nm-config', () => {
  it('local: mode, powersyncUrl, version, schemaVersion — and nothing else (no ids)', async () => {
    await localStack();
    const body = await j(await app.request('/.well-known/nm-config'));
    expect(Object.keys(body).sort()).toEqual(['mode', 'powersyncUrl', 'schemaVersion', 'version']);
    expect(body).toMatchObject({ mode: 'local', powersyncUrl: 'http://127.0.0.1:58081', schemaVersion: null });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('cloud: the same shape with mode cloud', async () => {
    const body = await j(await app.request('/.well-known/nm-config'));
    expect(body.mode).toBe('cloud');
    expect(Object.keys(body).sort()).toEqual(['mode', 'powersyncUrl', 'schemaVersion', 'version']);
  });
});

describe('GET /v1/me', () => {
  it('a human lists its memberships as { id, name, slug }', async () => {
    const { workspaceId } = await store.createWorkspace({ name: 'Acme', slug: 'acme', createdBy: george.id }, ev(george.id));
    const body = await j(await app.request('/v1/me', { headers: asHeader(george) }));
    expect(body).toEqual({ actor: { kind: 'human', id: 'george' }, workspaces: [{ id: workspaceId, name: 'Acme', slug: 'acme' }] });
  });

  it('an agent gets its identity and no workspaces — memberships are a human thing', async () => {
    const body = await j(await app.request('/v1/me', { headers: asHeader({ kind: 'agent', id: 'rex', role: 'orchestrator' }) }));
    expect(body).toEqual({ actor: { kind: 'agent', id: 'rex' }, workspaces: [] });
  });

  it('needs a credential', async () => {
    expect((await app.request('/v1/me')).status).toBe(401);
  });
});

describe('NM_LOCAL=1 lifts every plan gate through localMode(), and only there', () => {
  const MB = 1024 * 1024;
  const attachment = (n: number, workspace: string) => ({ id: uuid(n), workspace, channel: 'dev', messageId: uuid(1), kind: 'screenshot', name: 'shot.png', mime: 'image/png', sizeBytes: 1024 });

  /** each gate: the setup that reaches the cap, then the call that trips it */
  const gates: Array<{ name: string; trip: () => Promise<Response>; lifted: { status: number; code?: string } }> = [
    {
      name: 'seats (workspace.invite past FREE_SEAT_CAP)',
      trip: async () => {
        const { workspaceId } = await store.createWorkspace({ name: 'Acme', slug: 'acme', createdBy: george.id }, ev(george.id));
        return cmd(asHeader(george), { type: 'workspace.invite', workspace: workspaceId, email: 'ann@acme.dev', memberRole: 'member' });
      },
      lifted: { status: 200 },
    },
    {
      name: 'projects (the fourth project.create)',
      trip: async () => {
        for (const name of ['One', 'Two', 'Three']) expect((await cmd(asHeader(george), { type: 'project.create', workspace: 'ws_acme', name })).status).toBe(200);
        return cmd(asHeader(george), { type: 'project.create', workspace: 'ws_acme', name: 'Four' });
      },
      lifted: { status: 200 },
    },
    {
      name: 'schedules (schedule.create on Free)',
      trip: async () => {
        const proj = await j(await cmd(asHeader(george), { type: 'project.create', workspace: 'ws_acme', name: 'Growth' }));
        const chan = await j(await cmd(asHeader(george), { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'marketing' }));
        return cmd(asHeader(george), { type: 'schedule.create', channel: chan.channelId, title: 'Daily drafts', prompt: 'Draft one post.', cadence: 'weekdays', atTime: '09:00', tz: 'UTC' });
      },
      lifted: { status: 200 },
    },
    {
      name: 'cloud machines (machine.provision on Free — lifted, then honestly not served here)',
      trip: async () => {
        const { workspaceId } = await store.createWorkspace({ name: 'Acme', slug: 'acme', createdBy: george.id }, ev(george.id));
        return cmd(asHeader(george), { type: 'machine.provision', workspace: workspaceId });
      },
      lifted: { status: 404, code: 'NOT_FOUND' },
    },
    {
      name: 'attachments (the fourth per message, and a file over the Free size)',
      trip: async () => {
        for (let i = 1; i <= 3; i++) expect((await post('/v1/artifacts', asHeader(george), attachment(100 + i, 'ws_acme'))).status).toBe(200);
        return post('/v1/artifacts', asHeader(george), { ...attachment(104, 'ws_acme'), sizeBytes: 10 * MB });
      },
      lifted: { status: 200 },
    },
  ];

  it.each(gates)('$name: PLAN_LIMIT on Free, lifted under NM_LOCAL=1', async ({ trip, lifted }) => {
    const capped = await trip();
    expect(capped.status).toBe(402);
    expect((await j(capped)).code).toBe('PLAN_LIMIT');

    store = new MemoryStore();
    app = createApp(store);
    vi.stubEnv('NM_LOCAL', '1');
    const open = await trip();
    expect(open.status).toBe(lifted.status);
    const body = await j(open);
    expect(body.code).not.toBe('PLAN_LIMIT');
    if (lifted.code) expect(body.code).toBe(lifted.code);
  });

  it('the stored plan stays free — the UI must say Free', async () => {
    vi.stubEnv('NM_LOCAL', '1');
    const { workspaceId } = await store.createWorkspace({ name: 'Acme', slug: 'acme', createdBy: george.id }, ev(george.id));
    expect(await store.workspacePlan(workspaceId)).toBe('free');
    const listed = await j(await app.request('/v1/workspaces', { headers: asHeader(george) }));
    expect(listed.workspaces[0].plan).toBe('free');
  });

  it('the starter brain is the one door that stays shut: 503, bring your own key', async () => {
    const body = { workspace: 'ws_acme', contents: [] };
    expect((await post('/v1/starter/generate', asHeader(george), body)).status).toBe(501); // memory store: no ledger
    vi.stubEnv('NM_LOCAL', '1');
    const res = await post('/v1/starter/generate', asHeader(george), body);
    expect(res.status).toBe(503);
    expect(await j(res)).toMatchObject({ code: 'UNAVAILABLE', error: expect.stringContaining('own model key') });
  });
});
