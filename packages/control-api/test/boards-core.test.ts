// Message boards' core touch points (docs/design/message-boards-2026-11/plan.md §7.5, §7.6):
//   1. nm-api refuses every `nmbd_` bearer, on every route, before the Clerk verifier sees it
//   2. GET /v1/machines/agents/:id/board-credentials: machine-only, workspace-scoped, an OIDC proxy to
//      nm-boards that passes 200/204 through and turns every upstream failure into a bare 502
//   3. /.well-known/nm-config says where Message boards is
// The sign-in wall (a session token of the boards origin) is in boards-signin-wall.test.ts: it needs
// the real Clerk verifier, which this file replaces to prove that the guard never reaches it.
import { BOARD_TOKEN_PREFIX } from '@neuramesh/shared';
import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { boardCredentialOf, boardsRoutes, type BoardCredentialDeps } from '../src/boards-credentials';
import { boardsOrigin, boardsUrl } from '../src/boards-guard';
import { hashMachineToken, mintMachineToken } from '../src/machine-auth';
import { MemoryStore } from '../src/store';
import type { Store } from '../src/store';

const clerk = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../src/clerk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/clerk')>();
  return { ...actual, verifyClerkToken: vi.fn(async () => { clerk.calls += 1; return { sub: 'clerk_abc' }; }) };
});

// the shape of a real token (nmbd_<lookup 8>_<secret>), made here: the boards packages are private
const boardToken = () => `${BOARD_TOKEN_PREFIX}${randomBytes(4).toString('hex')}_${randomBytes(18).toString('hex')}`;
const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';
const FOREIGN_AGENT = '44444444-4444-4444-8444-444444444444';
const RETIRED_AGENT = '66666666-6666-4666-8666-666666666666';
const MACHINE = '77777777-7777-4777-8777-777777777777';
const BOARDS = 'https://boards.test';

const saved = { ...process.env };
afterEach(() => {
  for (const k of ['NM_BOARDS_URL', 'NM_LOCAL']) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

describe('nm-api refuses nmbd_ tokens', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { clerk.calls = 0; delete process.env['NM_BOARDS_URL']; app = createApp(new MemoryStore()); });

  // a representative spread: below the /v1 gate (commands, messages, me, sync, brain, workspaces),
  // above it (the machine lanes that prove their own bearers), the managed-credentials route itself,
  // the public doors, an /internal cron door, the health probe and a path with no route
  const routes: Array<[string, string]> = [
    ['POST', '/v1/commands'],
    ['POST', '/v1/messages'],
    ['GET', '/v1/me'],
    ['GET', '/v1/workspaces'],
    ['GET', '/v1/sync/bootstrap'],
    ['GET', '/v1/brain/threads/t1'],
    ['GET', '/v1/x/search?workspace=w&q=x'],
    ['POST', '/v1/machines/facts'],
    ['GET', '/v1/machines/vault'],
    ['POST', '/v1/machines/heartbeat'],
    ['GET', `/v1/machines/agents/${AGENT}/board-credentials`],
    ['POST', '/auth/clerk'],
    ['GET', '/.well-known/nm-config'],
    ['GET', '/internal/announce-due'],
    ['GET', '/healthz'],
    ['GET', '/v1/no-such-route'],
  ];
  it.each(routes)('%s %s → 401 TOKEN_INVALID, never the Clerk verifier', async (method, path) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${boardToken()}`, 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('TOKEN_INVALID');
    expect(body.error).toBe('A Message boards token (nmbd_) works only on the Message boards service. The NeuraMesh API refuses it.');
    expect(clerk.calls).toBe(0);
  });

  it('names the address of Message boards when the deployment has one', async () => {
    process.env['NM_BOARDS_URL'] = `${BOARDS}/`;
    const res = await app.request('/v1/me', { headers: { authorization: `Bearer ${boardToken()}` } });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe(`A Message boards token (nmbd_) works only on ${BOARDS}. The NeuraMesh API refuses it.`);
  });

  it('matches the scheme case-insensitively and any nmbd_ shape, not only well-formed tokens', async () => {
    for (const authorization of [`bearer ${boardToken()}`, 'Bearer nmbd_x', `BEARER   ${boardToken()}`]) {
      const res = await app.request('/v1/me', { headers: { authorization } });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe('TOKEN_INVALID');
    }
    expect(clerk.calls).toBe(0);
  });

  it('leaves other credentials to the gate (a Clerk bearer still reaches the verifier)', async () => {
    await app.request('/v1/me', { headers: { authorization: 'Bearer not-a-board-token' } });
    expect(clerk.calls).toBe(1);
  });

  it('leaves a request with no bearer alone', async () => {
    expect((await app.request('/healthz')).status).toBe(200);
  });

  // REGRESSION (found before the first sandbox deploy): core's machine BOOT credential is nmb_<64 hex>.
  // The guard must never answer for it, or no Cloud Run machine could boot.
  it("lets a machine boot credential (nmb_<64 hex>) through to POST /v1/machines/boot's own check", async () => {
    const res = await app.request('/v1/machines/boot', {
      method: 'POST',
      headers: { authorization: `Bearer nmb_${'ab'.repeat(32)}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    expect(body.code).not.toBe('TOKEN_INVALID');
    expect(body.error ?? '').not.toMatch(/Message boards/);
  });
});

describe('GET /v1/machines/agents/:agentId/board-credentials', () => {
  const machine = mintMachineToken();
  const store = {
    machineByTokenHash: async (hash: string) => (hash === machine.hash ? { id: MACHINE, workspace_id: WS, owner_user_id: 'u1', kind: 'runner' } : null),
    agentWorkspace: async (id: string) => ({ [AGENT]: WS, [FOREIGN_AGENT]: OTHER_WS } as Record<string, string>)[id] ?? null,
  } as unknown as Store;
  const cred = (over: Record<string, unknown> = {}) => ({
    token: boardToken(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), apiUrl: `${BOARDS}/api/v1`, mcpUrl: `${BOARDS}/mcp`,
    boards: [{ workspaceSlug: 'acme', boardSlug: 'ops', perm: 'post' }], ...over,
  });
  const env = { NM_BOARDS_URL: `${BOARDS}/` };
  type Upstream = (url: string, init: RequestInit) => Response | Promise<Response>;

  function mount(upstream: Upstream, opts: { env?: Record<string, string | undefined>; idToken?: () => Promise<string>; store?: Store; liveAgentWorkspace?: BoardCredentialDeps['liveAgentWorkspace'] } = {}) {
    const calls: Array<{ url: string; init: RequestInit; audience?: string }> = [];
    const audiences: string[] = [];
    const app = new Hono();
    boardsRoutes(app, opts.store ?? store, {
      env: opts.env ?? env,
      idToken: opts.idToken ?? (async (a) => { audiences.push(a); return 'oidc-test-token'; }),
      fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init, audience: audiences.at(-1) }); return upstream(url, init); }) as unknown as typeof fetch,
      ...(opts.liveAgentWorkspace ? { liveAgentWorkspace: opts.liveAgentWorkspace } : {}),
    });
    const get = (agentId: string, authorization?: string) => app.request(`/v1/machines/agents/${agentId}/board-credentials`, { headers: authorization ? { authorization } : {} });
    return { get, calls, audiences };
  }
  const asMachine = `Bearer ${machine.token}`;

  it('refuses a caller with no credential (401), a non-machine bearer (403) and an unknown machine (401)', async () => {
    const { get, calls, audiences } = mount(() => new Response(null, { status: 204 }));
    const none = await get(AGENT);
    expect(none.status).toBe(401);
    expect(((await none.json()) as { code: string }).code).toBe('AUTH_REQUIRED');
    const person = await get(AGENT, 'Bearer some-clerk-session');
    expect(person.status).toBe(403);
    expect(((await person.json()) as { code: string }).code).toBe('MACHINE_ONLY');
    const localHuman = await get(AGENT, `Bearer nmh_${'a'.repeat(40)}`);
    expect(localHuman.status).toBe(403);
    const unknown = await get(AGENT, `Bearer ${mintMachineToken().token}`);
    expect(unknown.status).toBe(401);
    expect(((await unknown.json()) as { code: string }).code).toBe('AUTH_FAILED');
    expect(hashMachineToken(machine.token)).toBe(machine.hash);
    expect(calls).toHaveLength(0);
    expect(audiences).toHaveLength(0);
  });

  it('refuses a board token on its own route before the machine check', async () => {
    const { get, calls } = mount(() => Response.json(cred()));
    const res = await get(AGENT, `Bearer ${boardToken()}`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('TOKEN_INVALID');
    expect(calls).toHaveLength(0);
  });

  it("answers one 404 for another workspace's agent, an unknown agent, a retired agent and a malformed id, without a call to nm-boards", async () => {
    const live = async (id: string) => (id === RETIRED_AGENT ? null : store.agentWorkspace(id));
    const { get, calls } = mount(() => new Response(null, { status: 204 }), { liveAgentWorkspace: live });
    const bodies = new Set<string>();
    for (const id of [FOREIGN_AGENT, '55555555-5555-4555-8555-555555555555', RETIRED_AGENT, 'not-a-uuid']) {
      const res = await get(id, asMachine);
      expect(res.status).toBe(404);
      bodies.add(await res.text());
    }
    // one answer for each case: a 404 says nothing about which agents exist
    expect([...bodies]).toEqual([JSON.stringify({ error: 'This agent does not exist, or this machine has no access to it.', code: 'NOT_FOUND' })]);
    expect(calls).toHaveLength(0);
  });

  it('proxies the credential: OIDC for the NM_BOARDS_URL audience, the workspace, agent and machine in the body, no-store', async () => {
    const issued = cred();
    const { get, calls } = mount(() => Response.json({ ...issued, pepper: 'never-passed-on' }));
    const res = await get(AGENT, asMachine);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // rebuilt field by field: a field the contract does not name stays in core
    expect(await res.json()).toEqual(issued);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`${BOARDS}/internal/managed-credentials`);
    expect(call?.audience).toBe(BOARDS);
    expect(call?.init.method).toBe('POST');
    expect((call?.init.headers as Record<string, string>)['authorization']).toBe('Bearer oidc-test-token');
    expect(JSON.parse(String(call?.init.body))).toEqual({ workspaceId: WS, agentId: AGENT, machineId: MACHINE });
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('takes an answer with no mcpUrl: the daemon reads apiUrl', async () => {
    const { mcpUrl: _gone, ...issued } = cred();
    const res = await mount(() => Response.json(issued)).get(AGENT, asMachine);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(issued);
  });

  it('passes 204 through (no grants), and treats a JSON null the same', async () => {
    expect((await mount(() => new Response(null, { status: 204 })).get(AGENT, asMachine)).status).toBe(204);
    expect((await mount(() => Response.json(null)).get(AGENT, asMachine)).status).toBe(204);
  });

  it('answers 204 with no call at all when Message boards is off (NM_BOARDS_URL unset or not an address)', async () => {
    for (const off of [{}, { NM_BOARDS_URL: '  ' }, { NM_BOARDS_URL: 'boards.test' }, { NM_BOARDS_URL: 'ftp://boards.test' }]) {
      const { get, calls, audiences } = mount(() => Response.json(cred()), { env: off });
      expect((await get(AGENT, asMachine)).status).toBe(204);
      expect(calls).toHaveLength(0);
      expect(audiences).toHaveLength(0);
    }
  });

  it('turns every upstream failure into a 502 that leaks nothing', async () => {
    const failures: Array<Parameters<typeof mount>> = [
      [() => new Response('db password is hunter2', { status: 500 })],
      [() => new Response('nope', { status: 401 })],
      [() => new Response('<html>hunter2</html>', { status: 200 })],
      [() => Response.json({ token: 'not-a-board-token', secret: 'leak' })],
      [() => Response.json(cred({ apiUrl: 'https://evil.example/api/v1' }))],
      [() => Response.json(cred({ apiUrl: 'not a url' }))],
      [() => Response.json(cred({ expiresAt: 'leak-soon' }))],
      [() => Response.json(cred({ boards: [{ boardSlug: 'ops' }] }))],
      [() => Response.json(cred({ boards: 'leak' }))],
      [() => { throw new Error('ECONNREFUSED 10.0.0.7:8080'); }],
      [() => Response.json(cred()), { idToken: async () => { throw new Error('metadata server said no'); } }],
    ];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const args of failures) {
        const res = await mount(...args).get(AGENT, asMachine);
        expect(res.status).toBe(502);
        const text = await res.text();
        expect(JSON.parse(text)).toEqual({ error: expect.any(String), code: 'BOARDS_UNAVAILABLE' });
        expect(text).not.toMatch(/hunter2|leak|evil|ECONNREFUSED|metadata|10\.0\.0\.7|nmbd_/);
      }
      // our own log names the agent, the machine and a status or a transport reason, never a token
      expect(warn.mock.calls.flat().join('\n')).not.toMatch(/nmbd_|hunter2/);
    } finally { warn.mockRestore(); }
  });

  // the default agent read, against a store with postgres: `sql` here answers the two queries the route
  // makes (the machine by its token, the agent by its id) from rows, and applies `retired_at is null`
  // only when the query asks for it, so a route that dropped the predicate fails this test
  describe('with a postgres store', () => {
    const rows = {
      machine: { id: MACHINE, workspace_id: WS, owner_user_id: 'u1', kind: 'runner', owner_clerk_id: null, substrate: 'cloudrun', epoch: '4', token_epoch: '4', current: true, expired: false },
      agents: [{ id: AGENT, w: WS, retired: false }, { id: RETIRED_AGENT, w: WS, retired: true }, { id: FOREIGN_AGENT, w: OTHER_WS, retired: false }],
    };
    const pg = (machineRow: Record<string, unknown> = rows.machine) => ({
      sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        if (/from machines/.test(text)) return values[0] === machine.hash ? [machineRow] : [];
        if (/from agents/.test(text)) return rows.agents.filter((a) => a.id === values[0] && !(a.retired && /retired_at is null/.test(text))).map(({ w }) => ({ w }));
        throw new Error(`unexpected query: ${text}`);
      },
    }) as unknown as Store;

    it('gives a live agent of the workspace its credential', async () => {
      const issued = cred();
      const res = await mount(() => Response.json(issued), { store: pg() }).get(AGENT, asMachine);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(issued);
    });

    it('answers 404 for a retired agent and for an agent of another workspace, with no call to nm-boards', async () => {
      const { get, calls } = mount(() => Response.json(cred()), { store: pg() });
      expect((await get(RETIRED_AGENT, asMachine)).status).toBe(404);
      expect((await get(FOREIGN_AGENT, asMachine)).status).toBe(404);
      expect(calls).toHaveLength(0);
    });

    it('answers 409 for a replaced Cloud Run instance: only the current epoch gets a credential', async () => {
      const { get, calls } = mount(() => Response.json(cred()), { store: pg({ ...rows.machine, token_epoch: '3' }) });
      const res = await get(AGENT, asMachine);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe('STALE_EPOCH');
      expect(calls).toHaveLength(0);
    });
  });
});

describe('the credential shape and the one setting', () => {
  it('reads NM_BOARDS_URL as an http address with no slash at the end, and null when it is not one', () => {
    expect(boardsUrl({})).toBeNull();
    expect(boardsUrl({ NM_BOARDS_URL: '' })).toBeNull();
    expect(boardsUrl({ NM_BOARDS_URL: 'boards.neuramesh.app' })).toBeNull();
    expect(boardsUrl({ NM_BOARDS_URL: 'javascript:alert(1)' })).toBeNull();
    expect(boardsUrl({ NM_BOARDS_URL: ' https://boards.neuramesh.app// ' })).toBe('https://boards.neuramesh.app');
    expect(boardsOrigin({ NM_BOARDS_URL: 'https://boards.neuramesh.app/' })).toBe('https://boards.neuramesh.app');
    expect(boardsOrigin({ NM_BOARDS_URL: 'http://127.0.0.1:8790' })).toBe('http://127.0.0.1:8790');
    expect(boardsOrigin({})).toBeNull();
  });

  it('keeps only the fields of the contract, and refuses an answer that points the token at a different origin', () => {
    const good = { token: 'nmbd_abc', expiresAt: '2026-11-14T10:00:00.000Z', apiUrl: 'https://boards.test/api/v1', boards: [{ boardSlug: 'ops', workspaceSlug: 'acme', perm: 'read', id: 'x' }], extra: 1 };
    expect(boardCredentialOf(good, 'https://boards.test')).toEqual({ token: 'nmbd_abc', expiresAt: '2026-11-14T10:00:00.000Z', apiUrl: 'https://boards.test/api/v1', boards: [{ boardSlug: 'ops', workspaceSlug: 'acme', perm: 'read' }] });
    expect(boardCredentialOf(good, 'https://boards.other')).toBeNull();
    expect(boardCredentialOf(good, null)).toBeNull();
    expect(boardCredentialOf({ ...good, token: 'nmm_abc' }, 'https://boards.test')).toBeNull();
    expect(boardCredentialOf({ ...good, token: 'nmb_abc' }, 'https://boards.test')).toBeNull();
    expect(boardCredentialOf(null, 'https://boards.test')).toBeNull();
  });
});

describe('/.well-known/nm-config names Message boards', () => {
  const config = async () => (await createApp(new MemoryStore()).request('/.well-known/nm-config')).json() as Promise<{ boardsUrl: string | null; mode: string }>;

  it('is null when the deployment has no Message boards', async () => {
    delete process.env['NM_BOARDS_URL'];
    expect((await config()).boardsUrl).toBeNull();
  });

  it('is the address when NM_BOARDS_URL is set', async () => {
    process.env['NM_BOARDS_URL'] = 'https://boards.neuramesh.app/';
    expect(await config()).toMatchObject({ mode: 'cloud', boardsUrl: 'https://boards.neuramesh.app' });
  });

  it('is null on the local stack, whatever the setting says', async () => {
    process.env['NM_BOARDS_URL'] = 'https://boards.neuramesh.app';
    process.env['NM_LOCAL'] = '1';
    expect(await config()).toMatchObject({ mode: 'local', boardsUrl: null });
  });
});
