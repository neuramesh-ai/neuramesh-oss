import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

// In-app email/password sign-up (POST /auth/clerk/signup). Before this endpoint
// existed, the desktop's "Create account" mode submitted the sign-in endpoint and
// every new email got 401 "incorrect email or password". Clerk's Backend API is
// stubbed at the fetch layer so clerkCreateUser's error mapping (taken email →
// CONFLICT, password policy → INVALID_INPUT passthrough) is exercised for real;
// app.request() dispatches Hono directly, so the stub only sees Clerk calls.
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Session creation is a two-hop chain (Backend-API sign-in token → Frontend-API
// native ticket exchange) because Backend-API create-session is dev-instance-only
// and broke prod. The FAPI host is derived from the publishable key set below.
function stubClerk(handlers: { createUser?: () => Response; signInToken?: () => Response; ticketExchange?: () => Response }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: { method?: string }) => {
      const u = String(url);
      if (u === 'https://api.clerk.com/v1/users' && init?.method === 'POST') return handlers.createUser?.() ?? json(500, {});
      if (u === 'https://api.clerk.com/v1/sign_in_tokens' && init?.method === 'POST') {
        return handlers.signInToken?.() ?? json(200, { token: 'sit_stub' });
      }
      if (u === 'https://clerk.stub.test/v1/client/sign_ins?_is_native=1' && init?.method === 'POST') {
        return handlers.ticketExchange?.() ?? json(200, { response: { status: 'complete', created_session_id: 'sess_1' } });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    }),
  );
}

function signup(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request('/auth/clerk/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let store: MemoryStore;
let app: ReturnType<typeof createApp>;
const savedKey = process.env['CLERK_SECRET_KEY'];
const savedPk = process.env['CLERK_PUBLISHABLE_KEY'];
// pk_test_<base64("clerk.stub.test$")> — clerkDomain() derives the FAPI host from it
const stubPk = `pk_test_${Buffer.from('clerk.stub.test$').toString('base64')}`;

beforeEach(() => {
  process.env['CLERK_SECRET_KEY'] = 'sk_test_stub';
  process.env['CLERK_PUBLISHABLE_KEY'] = stubPk;
  store = new MemoryStore();
  app = createApp(store);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env['CLERK_SECRET_KEY'];
  else process.env['CLERK_SECRET_KEY'] = savedKey;
  if (savedPk === undefined) delete process.env['CLERK_PUBLISHABLE_KEY'];
  else process.env['CLERK_PUBLISHABLE_KEY'] = savedPk;
});

describe('POST /auth/clerk/signup', () => {
  it('creates the Clerk user, maps it to an internal uuid, and signs it straight in (token → ticket)', async () => {
    stubClerk({
      createUser: () => json(200, { id: 'clerk_new', email_addresses: [{ id: 'e1', email_address: 'new@acme.dev' }], primary_email_address_id: 'e1' }),
      // signInToken + ticketExchange defaults: sit_stub → sess_1. If the code ever
      // regresses to Backend-API create-session (dev-only, broke prod), the stub
      // throws "unexpected fetch: …/v1/sessions" and this test fails.
    });
    const res = await signup(app, { email: 'new@acme.dev', password: 'a-strong-password' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; email: string; sessionId: string };
    expect(body.email).toBe('new@acme.dev');
    expect(body.sessionId).toBe('sess_1');
    expect(body.userId).toBeTruthy();

    // a later sign-in resolves the same Clerk id to the SAME internal uuid —
    // signup then signin is one identity, not two
    const again = await store.resolveClerkUser('clerk_new', 'new@acme.dev');
    expect(again.id).toBe(body.userId);
    expect(again.created).toBe(false);
  });

  it('a taken email is a 409 that steers to sign-in, not "incorrect email or password"', async () => {
    stubClerk({
      createUser: () => json(422, { errors: [{ code: 'form_identifier_exists', message: 'That email address is taken. Please try another.' }] }),
    });
    const res = await signup(app, { email: 'taken@acme.dev', password: 'a-strong-password' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('CONFLICT');
    expect(body.error).toContain('sign in instead');
  });

  it("a rejected password surfaces Clerk's own reason (422 passthrough)", async () => {
    stubClerk({
      createUser: () => json(422, { errors: [{ code: 'form_password_length_too_short', message: 'Passwords must be 8 characters or more.', long_message: 'Passwords must be 8 characters or more.' }] }),
    });
    const res = await signup(app, { email: 'new@acme.dev', password: 'short' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('INVALID_INPUT');
    expect(body.error).toBe('Passwords must be 8 characters or more.');
  });

  it('missing email or password 400s without touching Clerk', async () => {
    stubClerk({}); // any Clerk call would 500 → the endpoint must not reach it
    expect((await signup(app, { email: 'new@acme.dev' })).status).toBe(400);
    expect((await signup(app, { password: 'a-strong-password' })).status).toBe(400);
  });

  it('a Clerk outage is an opaque 401, never a success', async () => {
    stubClerk({ createUser: () => json(503, {}) });
    const res = await signup(app, { email: 'new@acme.dev', password: 'a-strong-password' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('AUTH_FAILED');
  });

  it("a failed ticket exchange surfaces Clerk's reason as 401 — the user is created but not falsely signed in", async () => {
    stubClerk({
      createUser: () => json(200, { id: 'clerk_new2', email_addresses: [{ id: 'e1', email_address: 'new2@acme.dev' }], primary_email_address_id: 'e1' }),
      ticketExchange: () => json(400, { errors: [{ message: 'Invalid request for environment', long_message: 'Request only valid for development instances.' }] }),
    });
    const res = await signup(app, { email: 'new2@acme.dev', password: 'a-strong-password' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('AUTH_FAILED');
    expect(body.error).toContain('could not create a Clerk session');
    expect(body.error).toContain('Request only valid for development instances');
  }, 15000);
});
