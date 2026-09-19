// THE ACCOUNT LANES, PINNED — the routes, and the refusals that must not look like successes.
//
// Two failure shapes are what this file exists to prevent.
//
// ONE: a lane that silently falls through to the warn-once fallback. That fallback resolves an
// empty ARRAY-LIKE — an object, therefore TRUTHY — so `const { user } = await nm.login(...)`
// destructures a truthy nobody and signs the app in, and `claudeDesignConnect` hands back a
// launch object the card immediately paints "Connected." over. Every lane here is asserted to be
// a function, and every refusal is asserted to be falsy or to reject.
//
// TWO: a read that answers EMPTY when it merely failed. `myInvites` gates the first-run latch
// (App.tsx opens the wizard when `needsOnboarding && wsInvites.length === 0`), so a swallowed
// failure could walk an invited newcomer into creating their own empty second workspace. It must
// reject. `invites` is the deliberate exception — the desktop's own handler returns `[]` on a
// non-OK response and the return type has nowhere to carry an error — so it is pinned as a
// CHOICE rather than left to drift.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { accountOverrides } from './webnm-account';

const cfg = {
  apiUrl: 'http://api.test',
  powersyncUrl: '',
  clerkSessionId: async (): Promise<string | null> => null,
  // annotated, not inferred: a test that overrides this with a token must still typecheck
  clerkBearer: async (): Promise<string | null> => null,
  relayBearer: async (): Promise<string | null> => null,
  actorId: () => 'u1',
  workspaceId: () => 'w1',
};

const arm = (over: Partial<typeof cfg> = {}) =>
  accountOverrides({ ...cfg, ...over } as never, null as never) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;

interface Call { url: string; method: string; body: unknown }

/** a control-api stand-in: records every request, answers from a per-path table */
function stubFetch(reply: (url: string) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { method?: string; body?: string }) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    const r = reply(String(url));
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = prev; } };
}

/** run `fn` with the stub installed, and always put the real fetch back */
async function withApi<T>(reply: (url: string) => { status?: number; body?: unknown }, fn: (calls: Call[]) => Promise<T>): Promise<T> {
  const s = stubFetch(reply);
  try { return await fn(s.calls); } finally { s.restore(); }
}

const WS_OK = { workspaces: [{ id: 'w1', name: 'Acme', slug: 'acme', role: 'owner', memberCount: 3, onboarded: true }] };

const LANES = [
  'login', 'loginGitHub', 'authClerk', 'accountBlockers', 'accountDelete', 'billingCheckout',
  'billingPortal', 'creditsHistory', 'starterVideo', 'creditsCheckout', 'invites', 'myInvites', 'workspaces', 'machineTransfer',
  'setNotificationsEnabled', 'providerReauth', 'claudeDesignConnect', 'claudeDesignStatus',
  'mcpKeys', 'mcpKeySet', 'mcpVerify',
  // the cloud-cap round: the meter + intent read, and the human's manual wake
  'machinesUsage', 'machineWake',
];

describe('the account, billing and machine-key lanes', () => {
  test('every lane is ANSWERED — none may fall through to the truthy fallback', () => {
    const ov = arm();
    for (const name of LANES) assert.equal(typeof ov[name], 'function', `${name} is unwired — the fallback would answer it with a truthy empty`);
    assert.equal(Object.keys(ov).length, LANES.length, 'the override bag carries exactly the tranche');
  });

  test('the reads hit the desktop handlers own routes', async () => {
    await withApi(() => ({ body: WS_OK }), async (calls) => {
      await arm().accountBlockers!();
      assert.deepEqual(calls.map((c) => [c.method, c.url]), [['GET', 'http://api.test/v1/workspaces']]);
    });
    await withApi((u) => ({ body: u.includes('/v1/workspaces') ? WS_OK : { invites: [] } }), async (calls) => {
      await arm().myInvites!();
      assert.deepEqual(calls.map((c) => c.url).sort(), ['http://api.test/v1/invites/mine', 'http://api.test/v1/workspaces']);
    });
    await withApi(() => ({ body: { invites: [] } }), async (calls) => {
      await arm().invites!();
      assert.equal(calls[0]!.url, 'http://api.test/v1/invites?workspace=w1');
    });
  });

  test('workspaces() names the ACTIVE workspace alongside the list', async () => {
    await withApi(() => ({ body: WS_OK }), async () => {
      const r = (await arm().workspaces!()) as { active: string; workspaces: unknown[] };
      assert.equal(r.active, 'w1');
      assert.equal(r.workspaces.length, 1);
    });
  });

  test('accountDelete rides the COMMAND lane, never a bespoke route', async () => {
    await withApi(() => ({ body: { ok: true } }), async (calls) => {
      await arm().accountDelete!();
      assert.equal(calls[0]!.url, 'http://api.test/v1/commands');
      assert.equal(calls[0]!.method, 'POST');
      assert.deepEqual(calls[0]!.body, { type: 'account.delete' });
    });
  });

  test('billing posts its own route and carries the workspace', async () => {
    for (const [lane, path] of [['billingCheckout', 'checkout'], ['billingPortal', 'portal']]) {
      await withApi(() => ({ body: {} }), async (calls) => {
        const r = (await arm()[lane!]!()) as { ok: boolean };
        assert.equal(calls[0]!.url, `http://api.test/v1/billing/${path}`);
        assert.equal(calls[0]!.method, 'POST');
        assert.deepEqual(calls[0]!.body, { workspace: 'w1' });
        // no url back means nothing was opened — `ok` describes the OPENING, not the request
        assert.equal(r.ok, false);
      });
    }
  });

  test('a minted billing url opens a tab — and a BLOCKED popup falls back to this one', async () => {
    const opened: string[] = [];
    const assigned: string[] = [];
    const g = globalThis as unknown as { window?: unknown; location?: unknown };
    const prev = { window: g.window, location: g.location };
    g.location = { assign: (u: string) => assigned.push(u) };
    try {
      g.window = { open: (u: string) => { opened.push(u); return {}; } };
      await withApi(() => ({ body: { url: 'https://stripe.test/s/1' } }), async () => {
        assert.deepEqual(await arm().billingCheckout!(), { ok: true });
      });
      assert.deepEqual(opened, ['https://stripe.test/s/1']);
      assert.deepEqual(assigned, [], 'an allowed popup must not also navigate this tab');

      // popup blocked: window.open answers null, and the human must still reach the page
      g.window = { open: () => null };
      await withApi(() => ({ body: { url: 'https://stripe.test/s/2' } }), async () => {
        await arm().billingCheckout!();
      });
      assert.deepEqual(assigned, ['https://stripe.test/s/2']);
    } finally {
      g.window = prev.window;
      g.location = prev.location;
    }
  });

  test('a failed read REJECTS — it never publishes an empty membership or invite list', async () => {
    const dead = () => ({ status: 500, body: { error: 'boom' } });
    for (const lane of ['accountBlockers', 'workspaces', 'myInvites']) {
      await withApi(dead, async () => {
        await assert.rejects(arm()[lane]!(), /boom/, `${lane} swallowed a failure into an empty answer`);
      });
    }
  });

  test('a refusal carries the SERVER own words, not just a status code', async () => {
    await withApi(() => ({ status: 404, body: { error: 'billing not configured', code: 'NOT_FOUND' } }), async () => {
      await assert.rejects(arm().billingCheckout!(), /billing not configured/);
    });
  });

  test('invites() keeps the desktop [] on a non-OK — pinned as a choice, not a drift', async () => {
    await withApi(() => ({ status: 400, body: { error: 'workspace required' } }), async () => {
      assert.deepEqual(await arm().invites!(), []);
    });
  });

  test('needsOnboarding follows bootstrap rule — HAVING a workspace is not FINISHING one', async () => {
    const cases: Array<[unknown, boolean]> = [
      [{ workspaces: [] }, true],
      [{ workspaces: [{ id: 'w1', name: 'A', slug: 'a', onboarded: false }] }, true],
      [{ workspaces: [{ id: 'w1', name: 'A', slug: 'a', onboarded: true }] }, false],
      // a server that does not answer the question must never eject a working user
      [{ workspaces: [{ id: 'w1', name: 'A', slug: 'a' }] }, false],
    ];
    for (const [body, want] of cases) {
      await withApi((u) => ({ body: u.includes('/v1/workspaces') ? body : { invites: [{ inviteId: 'i1' }] } }), async () => {
        const r = (await arm().myInvites!()) as { invites: unknown[]; needsOnboarding: boolean };
        assert.equal(r.needsOnboarding, want, JSON.stringify(body));
        assert.equal(r.invites.length, 1, 'the waiting invitations are what the caller came for');
      });
    }
  });

  test('the machine-shaped lanes answer FALSY — a truthy shape is the bug this file names', async () => {
    const ov = arm();
    assert.deepEqual(await ov.machineTransfer!(), { ok: false });
    assert.deepEqual(await ov.setNotificationsEnabled!(true), { ok: false });
    assert.deepEqual(await ov.providerReauth!('anthropic'), { authed: false });
    const status = (await ov.claudeDesignStatus!()) as { configured: boolean; claudeAuthed: boolean; detail: string };
    assert.equal(status.configured, false);
    assert.equal(status.claudeAuthed, false);
    assert.match(status.detail, /browser/i, 'the detail is what the card prints — it must say why');
    const verify = (await ov.mcpVerify!('posthog', 'x')) as { ok: boolean; detail: string };
    assert.equal(verify.ok, false);
    assert.match(verify.detail, /relay/);
  });

  test('mcpKeys reports NO key present, including the derived instagram flag', async () => {
    const r = (await arm().mcpKeys!()) as { presence: Record<string, boolean>; metaUrl: string; tiktokUrl: string };
    assert.deepEqual(r.presence, { posthog: false, meta: false, instagram: false, tiktok: false });
    assert.equal(r.metaUrl, '');
    assert.equal(r.tiktokUrl, '');
  });

  test('the four that must REJECT — resolving anything here paints a fake success', async () => {
    const ov = arm();
    // Login destructures `const { user } = await nm.login(...)` straight into onDone
    await assert.rejects(ov.login!('a@b.test', 'x'), /Clerk/);
    await assert.rejects(ov.loginGitHub!(), /Clerk/);
    // QuestionFlow sets "Connected." on whatever this resolves, and launches a terminal on it
    await assert.rejects(ov.claudeDesignConnect!('t1'), /nm-relay/);
    // a write with nowhere to land must say so, not report a presence map
    await assert.rejects(ov.mcpKeySet!('posthog', ''), /machine-local/);
  });

  test('authClerk refuses when signed out, and exchanges the session when not', async () => {
    await assert.rejects(arm().authClerk!(), /no Clerk session/);
    await withApi(() => ({ body: { userId: 'u9', email: 'a@b.test' } }), async (calls) => {
      const r = (await arm({ clerkBearer: async () => 'tok' }).authClerk!()) as { user: { id: string; email: string } };
      assert.equal(calls[0]!.url, 'http://api.test/auth/clerk');
      assert.deepEqual(calls[0]!.body, { token: 'tok' });
      assert.deepEqual(r.user, { id: 'u9', email: 'a@b.test' });
    });
  });
});
