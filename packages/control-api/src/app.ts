import { createHash, randomBytes } from 'node:crypto';
import { CREDIT_PACKS, MAX_PACK_CREDITS, MIN_PACK_CREDITS, attachmentLimits, commRulesFrom, createEvent, DESIGN_PROVIDER_QUESTION, DESKTOP_AUTH_TTL_MS, formatAddress, parseCard, parseQuestions, readAnswers, RETRO_RANGES, scrubEmdash, usdForCredits, WB_SCENE_MAX, WB_SNAPSHOT_MAX, WB_TITLE_MAX, type Actor, type RetroRange } from '@neuramesh/shared';
import { Hono } from 'hono';
import { cronRoutes } from './cron-routes';
import { fleetRoutes } from './fleet';
import { relayRoutes } from './relay';
import { resolveBearerActor } from './bearer-auth';
import { resolveTokenLane } from './local-auth';
import { localAuthRoutes, meRoute } from './local-routes';
import { localMode } from './localmode';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { billingEnabled, constructWebhookEvent, createCheckoutSession, createCreditsCheckout, createPortalSession, creditGrantFromEvent, planPatchFromEvent } from './billing';
import { linkedinCallback, linkedinStartUrl, providerConfigured, xCallback, xSearchOnConnector, xStartUrl } from './connectors';
import { instagramCallback, instagramStartUrl, tiktokCallback, tiktokStartUrl } from './connectors-meta';
import { seal, verifyMediaSig } from './connector-crypto';
import { clerkCreateUser, clerkFindUserByEmail, clerkPrimaryEmail, clerkVerifyPassword, createClerkSession, mintPowerSyncToken, verifyClerkToken } from './clerk';
import { unsubscribePage, verifyUnsubscribeToken } from './mail';
import { fireWakeBump, lifecycleRoutes } from './fleet-lifecycle';
import { actorInWorkspace, applyCreditPack, creditRoutes, type WebhookOutcome } from './credits';
import { applyPlanPatch } from './plan-flip';
import { actorMayReadCredentials } from './credentials-authz';
import { onAuthArrival } from './onauth';
import { ActorSchema, CommandSchema } from './commands';
import { DomainError } from './errors';
import { exportRoutes } from './export';
import { importRoutes } from './import';
import { executeCommand } from './handler';
import { hostedFreeGate } from './hosted-gate';
import { pushAfterCommand, type PushService } from './push';
import type { Store } from './store';

const MessageInputSchema = z.object({
  // Client-supplied id keeps optimistic local rows identical to server rows
  // (PowerSync echo-back would otherwise duplicate-then-swap them).
  id: z.string().uuid().optional(),
  workspace: z.string().min(1),
  channel: z.string().min(1),
  // may be empty when the message carries only attachments (no caption)
  body: z.string(),
  taskId: z.string().min(1).optional(),
  // the conversation thread this message belongs to (conversation-first shell). A
  // fresh client-generated id births the thread transactionally with the message.
  threadId: z.string().uuid().optional(),
  // docs/34: the composer's Tasks toggle, applied ONLY when this send births the thread.
  // A later message carrying it is ignored — the mode is the thread's, and changing it is
  // thread.set_mode (human-only), never a side effect of typing.
  threadMode: z.enum(['tasks', 'chat']).optional(),
  // docs/10 §15: the composer's brain draft, applied ONLY when this send births the thread —
  // the same birth-time contract as threadMode above, and for the same reason. Moving it
  // afterwards is thread.set_brain (human-only), never a side effect of typing.
  brainOverride: z.record(z.string(), z.string()).nullable().optional(),
  // docs/31: when this send BIRTHS a thread, the room message it hangs off. The root is
  // referenced, never moved — it keeps its place in the feed and grows a replies footer.
  rootMessageId: z.string().uuid().optional(),
  // 0119: the automation whose slot fired this send, applied ONLY when it births the thread —
  // the same birth-time contract as threadMode/brainOverride. It is what lets the Automations
  // card list a routine's runs without pattern-matching the marker in its opening line.
  scheduleId: z.string().uuid().optional(),
  // 0134, rule D9: WHERE the session runs and WHICH client bore it, applied ONLY when this send
  // births the thread — the same birth-time contract as the three above. Moving the machine
  // afterwards is thread.set_machine (human-only); the origin never moves.
  threadMachineId: z.string().uuid().nullable().optional(), threadOrigin: z.enum(['desktop', 'web', 'routine']).optional(),
  // the message this reply ANSWERS (agent wake replies) — the server enforces one
  // reply per (agent, trigger) so concurrent daemons can't double-reply (0060).
  replyTo: z.string().uuid().optional(),
});

// Chat attachment forwarded by the desktop's PowerSync uploadData. The full bytes stay on the
// host; only metadata + a small thumbnail (inlineContent) are persisted here and synced.
const ArtifactCreateSchema = z.object({
  id: z.string().uuid(),
  workspace: z.string().min(1),
  channel: z.string().min(1),
  taskId: z.string().min(1).optional(),
  messageId: z.string().uuid(),
  kind: z.enum(['screenshot', 'file', 'doc', 'diff', 'test_report']).default('file'),
  name: z.string().min(1).max(512),
  mime: z.string().max(255).optional(),
  inlineContent: z.string().max(400_000).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

// Whiteboards (docs/38) — the desktop's local-first lanes, forwarded by PowerSync uploadData.
// PUT is the create (idempotent on the client-minted id, like messages); PATCH is the autosave
// (LWW by rev — a stale patch is ACKed as applied:false, NEVER an error: a throwing autosave
// wedges the whole upload queue behind one lost race, the v0.29.2 phone-wedge class).
const WhiteboardPutSchema = z.object({
  id: z.string().uuid(),
  workspace: z.string().min(1),
  channel: z.string().min(1),
  threadId: z.string().uuid().optional(),
  taskId: z.string().optional(),
  title: z.string().trim().min(1).max(WB_TITLE_MAX).catch('Untitled board'),
  scene: z.string().max(WB_SCENE_MAX).optional(),
  snapshotSvg: z.string().max(WB_SNAPSHOT_MAX).optional(),
  snapshotRev: z.number().int().nonnegative().optional(),
  rev: z.number().int().min(1).default(1),
});

const WhiteboardPatchSchema = z.object({
  rev: z.number().int().min(1),
  title: z.string().trim().min(1).max(WB_TITLE_MAX).optional(),
  scene: z.string().max(WB_SCENE_MAX).optional(),
  snapshotSvg: z.string().max(WB_SNAPSHOT_MAX).optional(),
  snapshotRev: z.number().int().nonnegative().optional(),
  archivedAt: z.string().nullable().optional(),
});

type Env = { Variables: { actor: Actor } };

/** The origins the marketing site is served from (plus local dev for e2e). EVERY route the
 *  BROWSER calls has to be mounted with these CORS headers — a browser-called route without
 *  them isn't locked down, it's invisible: the fetch rejects before the page sees the status,
 *  so the client falls into whatever its catch does. That is exactly how `/invites/:token`
 *  told invitees with live, minutes-old invitations that theirs had expired. */
const webOrigin = (origin: string): string | null =>
  origin === 'https://neuramesh.app' || origin === 'https://www.neuramesh.app'
  || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : null;

export function createApp(store: Store, opts: { push?: PushService } = {}) {
  const app = new Hono<Env>();

  // errors NEVER leave as text/html: clients parse JSON envelopes. P0001 is
  // the DB state-guard raising (defense-in-depth, e.g. an app/schema version
  // skew) — same 409 contract as the app-level FSM verdict.
  app.onError((err, c) => {
    const pgCode = (err as { code?: string }).code;
    if (pgCode === 'P0001') {
      return c.json({ error: err.message, code: 'ILLEGAL_TRANSITION' }, 409);
    }
    console.error('unhandled api error:', err);
    return c.json({ error: 'internal error', code: 'INTERNAL' }, 500);
  });

  app.get('/healthz', (c) => c.json({ ok: true }));

  // A2A discovery (public, read-only — outside the /v1 auth scope). Agent Cards
  // carry only team-visible facts (name, role-derived skills, runtime, channels)
  // — never secrets — so the agents the owner exposes are externally discoverable.
  app.get('/a2a/agents/:agentId/card.json', async (c) => {
    const card = await store.getAgentCard(c.req.param('agentId'));
    if (!card) return c.json({ error: 'no agent card', code: 'NOT_FOUND' }, 404);
    return c.json(card);
  });
  // the A2A spec well-known path: ?agent=<id> resolves a specific card; bare,
  // it returns the NeuraMesh discovery descriptor pointing at per-agent cards.
  app.get('/.well-known/a2a/agent-card.json', async (c) => {
    const agentId = c.req.query('agent');
    if (agentId) {
      const card = await store.getAgentCard(agentId);
      if (!card) return c.json({ error: 'no agent card', code: 'NOT_FOUND' }, 404);
      return c.json(card);
    }
    return c.json({
      name: 'NeuraMesh',
      description: 'NeuraMesh A2A gateway — fetch a specific agent card at /a2a/agents/<agentId>/card.json, or this path with ?agent=<agentId>.',
      version: '1.0.0',
      protocolVersion: '1.0',
      capabilities: { streaming: true, pushNotifications: false },
      'x-neuramesh': { cardUrlTemplate: '/a2a/agents/{agentId}/card.json' },
    });
  });

  // Clerk auth bridge (public — the Clerk token IS the credential): verify the
  // Clerk session JWT, resolve the Clerk user to our stable internal uuid (the id
  // the host then mints a PowerSync token for). Outside /v1 because the caller has
  // no nm actor yet — this is what establishes it.
  app.post('/auth/clerk', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: string };
    const token = body.token ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return c.json({ error: 'missing token', code: 'INVALID_INPUT' }, 400);
    try {
      const claims = await verifyClerkToken(token);
      const clerkId = String(claims.sub);
      const primary = await clerkPrimaryEmail(clerkId);
      const email = primary?.email ?? null;
      const { id, created } = await store.resolveClerkUser(clerkId, email);
      // first-arrival side effects: welcome mail, and REPORT (never claim) pending invitations —
      // joining is the invitee's own act now, see workspace.accept_invite
      const { pending } = await onAuthArrival(store, { userId: id, email, emailVerified: !!primary?.verified, isNew: created, firstName: primary?.firstName ?? null });
      // sid lets the desktop refresh its PowerSync token server-side (no browser)
      return c.json({ userId: id, email, created, pendingInvites: pending, sessionId: claims['sid'] ?? null });
    } catch (e) {
      if (e instanceof DomainError) return c.json({ error: e.message, code: e.code }, e.status as 401);
      console.error('clerk auth error:', e);
      return c.json({ error: 'authentication failed', code: 'AUTH_FAILED' }, 401);
    }
  });

  // In-app email/password sign-in (no browser): verify the password against Clerk's
  // Backend API, then mint a session for token re-minting. The desktop renderer can't
  // call Clerk's frontend API from its file:// origin, so this local control-api is
  // the in-app path; the password only ever touches the user's own machine + Clerk.
  app.post('/auth/clerk/password', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
    if (!body.email || !body.password) return c.json({ error: 'email and password required', code: 'INVALID_INPUT' }, 400);
    try {
      const found = await clerkFindUserByEmail(body.email);
      // same opaque message whether the account is missing or the password is wrong
      if (!found || !(await clerkVerifyPassword(found.id, body.password))) {
        return c.json({ error: 'incorrect email or password', code: 'AUTH_FAILED' }, 401);
      }
      const { id, created } = await store.resolveClerkUser(found.id, found.email);
      // an existing account signing in still claims any invitation waiting on its address
      const primary = await clerkPrimaryEmail(found.id);
      await onAuthArrival(store, { userId: id, email: found.email, emailVerified: !!primary?.verified, isNew: created, firstName: primary?.firstName ?? null });
      const sessionId = await createClerkSession(found.id);
      return c.json({ userId: id, email: found.email, sessionId });
    } catch (e) {
      if (e instanceof DomainError) return c.json({ error: e.message, code: e.code }, e.status as 401);
      console.error('clerk password auth error:', e);
      return c.json({ error: 'authentication failed', code: 'AUTH_FAILED' }, 401);
    }
  });

  // In-app email/password sign-up (no browser): create the Clerk user via the
  // Backend API, then sign the new account straight in — same response shape as
  // /auth/clerk/password so the desktop proceeds into onboarding identically.
  // The renderer's "Create account" mode was copy-only until this existed: it
  // submitted the sign-in endpoint, which 401s on any new email.
  app.post('/auth/clerk/signup', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
    if (!body.email || !body.password) return c.json({ error: 'email and password required', code: 'INVALID_INPUT' }, 400);
    try {
      const created = await clerkCreateUser(body.email.trim(), body.password);
      const { id, created: isNew } = await store.resolveClerkUser(created.id, created.email);
      // In-app sign-up: Clerk marks the address verified when it creates the user with a
      // password, but re-read it rather than assuming — this is the invite-claim boundary.
      const primary = await clerkPrimaryEmail(created.id);
      await onAuthArrival(store, { userId: id, email: created.email, emailVerified: !!primary?.verified, isNew, firstName: primary?.firstName ?? null });
      const sessionId = await createClerkSession(created.id);
      return c.json({ userId: id, email: created.email, sessionId });
    } catch (e) {
      if (e instanceof DomainError) return c.json({ error: e.message, code: e.code }, e.status as 401);
      console.error('clerk signup error:', e);
      return c.json({ error: 'account creation failed', code: 'AUTH_FAILED' }, 401);
    }
  });

  // Mint a fresh PowerSync token from the Clerk session (sub stays the Clerk id;
  // the workspace sync rule maps it → our uuid via nm_users). PowerSync validates
  // it against Clerk's JWKS — no client holds a signing key.
  app.post('/auth/clerk/token', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string };
    if (!body.sessionId) return c.json({ error: 'missing sessionId', code: 'INVALID_INPUT' }, 400);
    try {
      const jwt = await mintPowerSyncToken(body.sessionId);
      return c.json({ token: jwt });
    } catch (e) {
      // 401 is reserved for a VERIFIED-dead session (SESSION_EXPIRED) — the desktop
      // signs the user out on it. Anything unclassified is a transient infra failure.
      if (e instanceof DomainError) return c.json({ error: e.message, code: e.code }, e.status as 401);
      console.error('clerk token mint error:', e);
      return c.json({ error: 'token mint temporarily unavailable', code: 'AUTH_UNAVAILABLE' }, 503);
    }
  });

  // the non-Clerk token mints (/auth/dev/token, /auth/local/token) and /.well-known/nm-config —
  // public, outside /v1 like /auth/clerk (local-routes.ts)
  localAuthRoutes(app, store);

  // Desktop sign-in handoff (device-code style). The packaged desktop can't complete a
  // production Clerk OAuth flow on its 127.0.0.1 loopback (the callback needs a first-party
  // cookie on clerk.neuramesh.app a cross-site loopback can't hold), so sign-in runs on the
  // trusted neuramesh.app page and the result is handed back here. Outside /v1 like /auth/clerk
  // — no nm actor exists yet; this is what establishes it. Only /complete is browser-called
  // (the page POSTs the signed-in Clerk token), so CORS is scoped to the trusted web origins;
  // /start and /poll are called by the desktop (Node fetch, no Origin).
  app.use('/auth/desktop/*', cors({
    origin: webOrigin,
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['content-type'],
  }));

  // 1) Desktop opens a pending rendezvous: nonce (public, rides the browser URL) + pollSecret
  //    (desktop-only). We store only sha256(pollSecret), so a leaked nonce can't claim the session.
  app.post('/auth/desktop/start', async (c) => {
    const nonce = randomBytes(32).toString('base64url');
    const pollSecret = randomBytes(32).toString('base64url');
    // fifteen minutes (DESKTOP_AUTH_TTL_MS): Get Pro signs up AND pays before it completes the handoff
    await store.startDesktopAuth({ nonce, pollSecretHash: createHash('sha256').update(pollSecret).digest('hex'), ttlSeconds: DESKTOP_AUTH_TTL_MS / 1000 });
    return c.json({ nonce, pollSecret, expiresIn: DESKTOP_AUTH_TTL_MS / 1000 });
  });

  // 2) The trusted web page (signed-in, holding the Clerk token) fills in the rendezvous. We
  //    verify the token server-side — same path as /auth/clerk — and stash the nm session.
  app.post('/auth/desktop/complete', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { nonce?: string; token?: string };
    if (!body.nonce || !body.token) return c.json({ error: 'nonce and token required', code: 'INVALID_INPUT' }, 400);
    try {
      const claims = await verifyClerkToken(body.token);
      const clerkId = String(claims.sub);
      const primary = await clerkPrimaryEmail(clerkId);
      const email = primary?.email ?? null;
      const { id, created } = await store.resolveClerkUser(clerkId, email);
      await onAuthArrival(store, { userId: id, email, emailVerified: !!primary?.verified, isNew: created, firstName: primary?.firstName ?? null });
      const { ok } = await store.completeDesktopAuth(body.nonce, { userId: id, email, sessionId: (claims['sid'] as string) ?? null });
      if (!ok) return c.json({ error: 'sign-in request expired — restart from the app', code: 'NOT_FOUND' }, 404);
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof DomainError) return c.json({ error: e.message, code: e.code }, e.status as 401);
      console.error('desktop auth complete error:', e);
      return c.json({ error: 'authentication failed', code: 'AUTH_FAILED' }, 401);
    }
  });

  // 3) Desktop polls with its pollSecret until the page completes it; the row is one-use.
  app.post('/auth/desktop/poll', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { nonce?: string; pollSecret?: string };
    if (!body.nonce || !body.pollSecret) return c.json({ error: 'nonce and pollSecret required', code: 'INVALID_INPUT' }, 400);
    const out = await store.claimDesktopAuth(body.nonce, createHash('sha256').update(body.pollSecret).digest('hex'));
    if (out.status === 'done') return c.json({ status: 'done', ...out.result });
    return c.json({ status: out.status }); // 'pending' | 'gone'
  });

  // Stripe webhook (public — authenticated by the Stripe signature, NOT an nm actor; it sits outside
  // /v1 like /auth/clerk). This is the ONLY writer of workspaces.plan, so a client can never grant
  // itself Cloud. Reads the RAW body for signature verification, maps the event to a plan patch, and
  // persists it via the sanctioned setWorkspacePlan — through applyPlanPatch, which on the flip
  // `free → cloud` also grants the seat credits and mints the runner (plan-flip.ts). Stripe should
  // point ONLY at the hosted Vercel control-api (the desktop's embedded api never receives webhooks).
  app.post('/webhooks/stripe', async (c) => {
    if (!billingEnabled()) return c.json({ error: 'billing not configured', code: 'NOT_FOUND' }, 404);
    const sig = c.req.header('stripe-signature');
    if (!sig) return c.json({ error: 'missing stripe-signature', code: 'INVALID_INPUT' }, 400);
    let event;
    try {
      event = constructWebhookEvent(await c.req.text(), sig);
    } catch (e) {
      console.error('stripe webhook signature verify failed:', e);
      return c.json({ error: 'invalid signature', code: 'AUTH_FAILED' }, 400);
    }
    // One event is a plan change OR a credit pack, never both (billing.test.ts holds the two
    // mappers apart). Both grant money, the money is already taken by the time this runs, and
    // Stripe only redelivers on a NON-2xx — so a failed grant MUST answer with a failing status.
    const mapped = planPatchFromEvent(event);
    const pack = creditGrantFromEvent(event);
    let applied: WebhookOutcome = 'ok';
    if (mapped) applied = await applyPlanPatch(store, mapped);
    else if (pack) applied = await applyCreditPack(store, pack);
    if (applied === 'unavailable') return c.json({ error: 'credit ledger unavailable', code: 'LEDGER_UNAVAILABLE' }, 503);
    if (applied === 'failed') return c.json({ error: 'credit grant failed', code: 'GRANT_FAILED' }, 500);
    return c.json({ received: true });
  });

  // ── connectors (marketing-channel plan §4.8): the OAuth round-trips run in the user's
  // external browser against these PUBLIC routes (the billing-checkout pattern). Sealed
  // tokens land in connector_secrets and never leave the server. Env-gated per provider:
  // a provider without its app keys 501s while the others keep working.
  const CONNECT_FLOWS: Record<string, {
    start: (ctx: { workspace: string; channel: string | null; actor: string }, redirectUri: string) => string;
    callback: (code: string, state: string, redirectUri: string) => Promise<{ workspace: string; channel: string | null; actor: string; handle: string; tokens: unknown }>;
    scopes: string;
  }> = {
    x: { start: xStartUrl, callback: xCallback, scopes: 'tweet.read tweet.write users.read offline.access' },
    linkedin: { start: linkedinStartUrl, callback: linkedinCallback, scopes: 'openid profile w_member_social' },
    instagram: { start: instagramStartUrl, callback: instagramCallback, scopes: 'instagram_basic instagram_content_publish pages_show_list business_management' },
    tiktok: { start: tiktokStartUrl, callback: tiktokCallback, scopes: 'user.info.basic video.upload' },
  };

  app.get('/connect/:provider/start', (c) => {
    const provider = c.req.param('provider');
    const flow = CONNECT_FLOWS[provider];
    if (!flow || !process.env['NM_CONNECTOR_KEY'] || !providerConfigured(provider)) return c.text(`${provider} connect is not configured on this server`, 501);
    const workspace = c.req.query('workspace');
    const actor = c.req.query('actor');
    if (!workspace || !actor) return c.text('missing workspace/actor', 400);
    const redirectUri = `${new URL(c.req.url).origin}/connect/${provider}/callback`;
    return c.redirect(flow.start({ workspace, channel: c.req.query('channel') ?? null, actor }, redirectUri), 302);
  });

  app.get('/connect/:provider/callback', async (c) => {
    const provider = c.req.param('provider');
    const flow = CONNECT_FLOWS[provider];
    if (!flow || !process.env['NM_CONNECTOR_KEY'] || !providerConfigured(provider)) return c.text(`${provider} connect is not configured on this server`, 501);
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.text('missing code/state', 400);
    try {
      const redirectUri = `${new URL(c.req.url).origin}/connect/${provider}/callback`;
      const out = await flow.callback(code, state, redirectUri);
      const { id } = await store.upsertConnector({ workspace: out.workspace, channelId: out.channel, provider, handle: out.handle, connectedBy: out.actor, scopes: flow.scopes });
      await store.setConnectorSecret(id, seal(out.tokens));
      return c.html(`<!doctype html><meta charset="utf-8"><title>Connected</title><body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#1d1d1d;color:#e6e6e6"><div style="text-align:center"><div style="font-size:34px">✓</div><p><b>${out.handle || provider}</b> is connected.</p><p style="color:#8f8f8f">Head back to NeuraMesh — the room already knows.</p></div></body>`);
    } catch (e) {
      console.error(`${provider} connect callback failed:`, e);
      return c.text('connection failed — close this tab and try again from NeuraMesh', 400);
    }
  });

  // TikTok's photo pull: TikTok only fetches from developer-verified domains, so the
  // poster hands it THIS route (verify the api domain once in the TikTok portal) and we
  // stream the draft's real image through. mediaSig gates it per-item — without the
  // connector key the URL is unforgeable, so this is not an open proxy. Image-only,
  // size-capped, and public hosts only (no loopback/private targets).
  // The draft's own hosted image (0090). PUBLIC by necessity — Instagram publishes by handing
  // Meta a URL that META fetches, so this route can carry no session. It is gated instead by the
  // per-media HMAC (unforgeable without NM_CONNECTOR_KEY) and serves nothing but image bytes.
  app.get('/media/:id', async (c) => {
    const mediaId = c.req.param('id');
    const sig = c.req.query('s') ?? '';
    if (!process.env['NM_CONNECTOR_KEY'] || !verifyMediaSig(mediaId, sig)) return c.text('forbidden', 403);
    const media = await store.contentMediaBytes(mediaId);
    if (!media) return c.text('not found', 404);
    return new Response(new Uint8Array(media.bytes), {
      headers: { 'content-type': media.mime, 'content-length': String(media.bytes.length), 'cache-control': 'public, max-age=300' },
    });
  });

  app.get('/connect/tiktok/media/:item', async (c) => {
    const itemId = c.req.param('item');
    const sig = c.req.query('s') ?? '';
    if (!process.env['NM_CONNECTOR_KEY'] || !verifyMediaSig(itemId, sig)) return c.text('forbidden', 403);
    const media = await store.contentItemMedia(itemId);
    if (!media || media.platform !== 'tiktok') return c.text('no media on this item', 404);
    // our own hosted image: stream it straight out rather than round-tripping our own URL
    if (media.mediaId) {
      const own = await store.contentMediaBytes(media.mediaId);
      if (!own) return c.text('no media on this item', 404);
      return new Response(new Uint8Array(own.bytes), { headers: { 'content-type': own.mime, 'cache-control': 'private, max-age=300' } });
    }
    if (!media.mediaUrl) return c.text('no media on this item', 404);
    let u: URL;
    try { u = new URL(media.mediaUrl); } catch { return c.text('bad media url', 400); }
    const host = u.hostname.toLowerCase();
    const privateHost = u.protocol !== 'https:' || host === 'localhost' || host.endsWith('.local')
      || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '[::1]';
    if (privateHost) return c.text('media must be a public https url', 400);
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(15_000), redirect: 'follow' }).catch(() => null);
    if (!res || !res.ok || !res.body) return c.text('media url did not load', 502);
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!ct.startsWith('image/')) return c.text('media url is not an image', 415);
    if (Number(res.headers.get('content-length') ?? 0) > 20_000_000) return c.text('image too large', 413);
    return new Response(res.body, { headers: { 'content-type': ct, 'cache-control': 'private, max-age=300' } });
  });

  fleetRoutes(app, store);
  relayRoutes(app, store);
  cronRoutes(app, store, opts.push);

  // One-click unsubscribe. No login: the HMAC token IS the credential, so it works from a mail
  // client that has no session. GET renders the confirmation a human sees; POST is what
  // Gmail/Yahoo call for List-Unsubscribe-Post one-click.
  const doUnsubscribe = async (token: string): Promise<boolean> => {
    const userId = verifyUnsubscribeToken(token);
    if (!userId) return false;
    await store.setUnsubscribed(userId);
    console.log(`unsubscribed user=${userId}`);
    return true;
  };
  app.get('/u/:token', async (c) => {
    const ok = await doUnsubscribe(c.req.param('token'));
    return c.html(unsubscribePage(ok), ok ? 200 : 400);
  });
  app.post('/u/:token', async (c) => {
    const ok = await doUnsubscribe(c.req.param('token'));
    return c.json({ ok }, ok ? 200 : 400);
  });

  // The /join page IS a browser calling this cross-origin (neuramesh.app → api.neuramesh.app),
  // so it needs the same trusted-origin headers the desktop handoff gets. Registered ahead of
  // the route: Hono runs middleware in declaration order, so a `use` below the handler never fires.
  app.use('/invites/*', cors({ origin: webOrigin, allowMethods: ['GET', 'OPTIONS'] }));

  // What does this invite token point at? Public + read-only: the /join page renders the
  // workspace name and prefills the address before the invitee has any session at all.
  // Membership is never granted here — that happens on verified sign-in (docs/27 §1d).
  app.get('/invites/:token', async (c) => {
    const hash = createHash('sha256').update(c.req.param('token')).digest('hex');
    const inv = await store.inviteByToken(hash);
    if (!inv) return c.json({ error: 'this invitation has expired or been revoked', code: 'NOT_FOUND' }, 404);
    return c.json({ workspace: inv.workspaceName, email: inv.email, role: inv.role });
  });

  // /v1 auth accepts these credentials:
  //  1) Authorization: Bearer <clerk-jwt> — a human client (mobile/desktop). We verify the
  //     Clerk-signed JWT (same JWKS path as /auth/clerk) and map its `sub` → our internal uuid.
  //     This is the tamper-proof credential a second, untrusted client platform requires.
  //  2) x-nm-actor header ALONE — the legacy dev/daemon path (agent daemons post agent-authored
  //     rows under their own actor). CLOSED unless NM_ALLOW_ACTOR_HEADER='1' (review F1, 2026-09-12:
  //     it opened unless '0', and on the local stack any process that reaches 127.0.0.1 — an agent
  //     in a worktree included — would have been any actor, self-approval one curl away). The test
  //     scripts and the dev lanes set '1'; nothing shipped does. With a bearer present the bearer
  //     proves the member and the header names the author (bearer-auth.ts).
  //  3) token bearers — nmm_ (machine) and nmh_ (the local stack's human), local-auth.ts.
  app.use('/v1/*', async (c, next) => {
    const bearer = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
    // 3) the token lanes: the token proves the caller, the header names the author, and an
    //    illegitimate claim is refused, never re-attributed
    if (bearer?.startsWith('nmm_') || bearer?.startsWith('nmh_')) {
      const lane = await resolveTokenLane(store, bearer, c.req.header('x-nm-actor'));
      if (!('actor' in lane)) return c.json({ error: lane.error, code: lane.code }, lane.status);
      c.set('actor', lane.actor);
      return next();
    }
    if (bearer) {
      try {
        const claims = await verifyClerkToken(bearer);
        const id = await store.userIdForClerkId(String(claims.sub));
        if (!id) return c.json({ error: 'no NeuraMesh account for this identity', code: 'AUTH_FAILED' }, 401);
        // the header names the AUTHOR on this lane (bearer-auth.ts): an agent of the member's
        // workspace, or the member; an illegitimate agent claim is refused, never re-attributed
        const actor = await resolveBearerActor(store, id, c.req.header('x-nm-actor'));
        if (!actor) return c.json({ error: 'this account cannot act as that agent', code: 'FORBIDDEN' }, 403);
        c.set('actor', actor);
      } catch (e) {
        // 401 IS A VERDICT ON THE TOKEN, NEVER ON OUR LUCK. Both branches used to answer 401, so a
        // JWKS blip or a database hiccup told every client its credential was dead: the desktop
        // signs out on a 401, and the phone's post died with the server's own "authentication
        // failed" (George, 2026-09-06). DomainError already carries the right status —
        // AUTH_UNAVAILABLE is a 503 — and an unclassified throw is our failure, so it is a 503 too.
        if (e instanceof DomainError) return c.json({ error: e.message, code: e.code }, e.status as 401);
        console.error('v1 auth error:', e);
        return c.json({ error: 'the sign-in check is unavailable', code: 'AUTH_UNAVAILABLE' }, 503);
      }
      return next();
    }
    // 2) the bare header — read ONLY when the lane is explicitly open
    const raw = process.env['NM_ALLOW_ACTOR_HEADER'] === '1' ? c.req.header('x-nm-actor') : undefined;
    if (raw) {
      const parsed = ActorSchema.safeParse(safeJson(raw));
      if (!parsed.success) return c.json({ error: 'invalid actor' }, 401);
      c.set('actor', parsed.data);
      return next();
    }
    return c.json({ error: 'missing credentials', code: 'AUTH_REQUIRED' }, 401);
  });
  // the hosted write gate (hosted-gate.ts): a `free` workspace reads, never writes. AFTER auth,
  // BEFORE every route below. Off unless NM_HOSTED_FREE_GATE=1, and never under NM_LOCAL.
  app.use('/v1/*', hostedFreeGate(store));

  // machine lifecycle: the machine-sweep cron + the usage meter (fleet-lifecycle.ts).
  // registered AFTER the /v1 gate — /v1/machines/usage reads the actor it sets. So is /v1/me.
  lifecycleRoutes(app, store);
  creditRoutes(app, store);
  meRoute(app, store);
  exportRoutes(app, store); // GET /v1/workspaces/:id/export — owner only, exempt from the gate (export.ts)
  importRoutes(app, store); // POST /v1/workspaces/:id/import/batches, owner only, cloud target only (import.ts)

  app.post('/v1/commands', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CommandSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid command', issues: parsed.error.issues }, 400);
    }
    try {
      const outcome = await executeCommand(store, c.get('actor'), parsed.data);
      // fire-and-forget push when a command lands a task on a human gate, or a Code approval waits (push.ts)
      if (opts.push) pushAfterCommand(opts.push, c.get('actor').id, parsed.data, outcome);
      return c.json(outcome);
    } catch (err) {
      if (err instanceof DomainError) {
        return c.json({ error: err.message, code: err.code }, err.status as 403);
      }
      throw err;
    }
  });

  /**
   * Read X on the workspace's own connection — the read half of the Connect button.
   *
   * Server-side by construction: the sealed token is unsealed HERE, used, and never returned.
   * That is the same custody rule publishing keeps (connectors.ts header), and it is what lets
   * an ordinary user — who has no X developer app — get real posts by clicking Connect once.
   *
   * Scoped by CHANNEL → project (0106), identically to `publishDueItems`, so what an agent can
   * read matches what its room could publish as. `max` is clamped: every call bills our X app.
   */
  app.get('/v1/x/search', async (c) => {
    const workspace = c.req.query('workspace');
    const q = (c.req.query('q') ?? '').trim();
    if (!workspace || !q) return c.json({ error: 'workspace and q are required', code: 'INVALID_INPUT' }, 400);
    if (!process.env['NM_CONNECTOR_KEY'] || !providerConfigured('x')) {
      return c.json({ error: 'x is not configured on this server', code: 'NOT_CONFIGURED' }, 501);
    }
    const channel = c.req.query('channel') ?? null;
    const max = Math.min(25, Math.max(10, Number(c.req.query('max') ?? 10) || 10));
    // token custody, rotation-at-refresh, and the dead-grant → RECONNECT_REQUIRED verdict all
    // live in xSearchOnConnector — this route only maps its outcomes onto HTTP statuses
    const out = await xSearchOnConnector(store, workspace, channel, q, max);
    if (!out.ok) return c.json({ error: out.error, code: out.code }, out.code === 'X_ERROR' ? 502 : 409);
    return c.json({ query: q, hits: out.hits });
  });

  app.post('/v1/messages', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = MessageInputSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid message', issues: parsed.error.issues }, 400);
    const actor = c.get('actor');
    // the workspace voice, ENFORCED at the one boundary every agent message crosses
    // (docs/design/agent-comm-rules-2026-08 slice 3): with noEmdash on, agent-authored
    // prose is scrubbed fence-aware — quoted code stays untouched by construction.
    // Humans are never rewritten; a failed rules read fails open to the raw body.
    const styledBody = actor.kind === 'agent'
      ? await store.getCommRules(parsed.data.workspace)
          .then((r) => (commRulesFrom(r).noEmdash ? scrubEmdash(parsed.data.body) : parsed.data.body))
          .catch(() => parsed.data.body)
      : parsed.data.body;
    const msg = {
      id: parsed.data.id ?? crypto.randomUUID(),
      workspace: parsed.data.workspace,
      channel: parsed.data.channel,
      taskId: parsed.data.taskId ?? null,
      threadId: parsed.data.threadId ?? null,
      rootMessageId: parsed.data.rootMessageId ?? null,
      threadMode: parsed.data.threadMode ?? null,
      brainOverride: parsed.data.brainOverride ?? null,
      scheduleId: parsed.data.scheduleId ?? null,
      // a routine's slot is its own origin, whichever daemon posts it
      threadMachineId: parsed.data.threadMachineId ?? null, threadOrigin: parsed.data.scheduleId ? 'routine' : parsed.data.threadOrigin ?? null,
      author: { kind: actor.kind, id: actor.id },
      body: styledBody,
      createdAt: new Date().toISOString(),
      // agent-only semantics: a human never "replies-to" in the dedupe sense
      replyTo: actor.kind === 'agent' ? parsed.data.replyTo ?? null : null,
    };
    const event = createEvent({
      type: 'message.posted',
      source: formatAddress({ kind: actor.kind, id: actor.id }),
      target: parsed.data.taskId ? `task:${parsed.data.taskId}` : `channel/${parsed.data.channel}`,
      workspace: parsed.data.workspace,
      payload: { preview: styledBody.slice(0, 120) },
    });
    // decisions (docs/12 slice 2): every nmq card an AGENT posts becomes a first-class
    // decision row, extracted here — the one choke point every card flows through
    // (deterministic daemon cards AND LLM-authored ones) — and inserted transactionally
    // with the message, so an open card without authoritative state is impossible.
    //
    // EXCEPT in a chat thread (docs/34: "no nmq cards in chat" — a conversation asks in prose,
    // never by filing an item in the needs-you queue). That rule was prompt-only until
    // 2026-08-18: extraction had no thread-mode check, so a chat agent emitting an nmq block
    // WOULD mint a decision row + phone push despite the mode claiming otherwise.
    const inChatThread = actor.kind === 'agent' && msg.threadId
      ? (await store.getThreadMode(msg.workspace, msg.threadId)) === 'chat'
      : false;
    const cards = actor.kind === 'agent' && !inChatThread ? parseQuestions(styledBody) : [];
    const decisions = cards.map((q) => ({
      id: crypto.randomUUID(),
      question: q.question,
      options: q.options ?? [],
      allowOther: q.allowOther !== false,
    }));
    try {
      // Mobile and older clients post the rendered `question → answer` reply
      // without calling decision.answer first. Resolve the design-provider card
      // through the same command path before saving that reply, so the decision
      // and provider event commit atomically and Iris cannot remain paused.
      if (actor.kind === 'human' && msg.taskId) {
        for (const [question, answer] of readAnswers([msg.body])) {
          if (question !== DESIGN_PROVIDER_QUESTION) continue;
          const open = (await store.listDecisions(msg.workspace)).find(
            (d) => d.status === 'open' && d.taskId === msg.taskId && d.question === question,
          );
          if (open) await executeCommand(store, actor, { type: 'decision.answer', decisionId: open.id, answer });
        }
      }
      const saved = await store.postMessage(msg, event, decisions.length ? decisions : undefined);
      // cloud wake (cloud-first): a delivered message is workspace activity — bump the fleet's
      // idle clocks fire-and-forget, never in (or failing) the response path.
      fireWakeBump(store, saved.workspace, actor.kind === 'human' ? actor.id : null);
      // fire-and-forget push when an agent posts an nmq/nmauth decision card. The daemon posts
      // by channel ID, so the room in the title was a UUID fragment ("A question for you · #b66…"
      // on George's lock screen, 2026-09-08): name the room by its slug. A slug-addressed post
      // resolves to nothing (the pg lookup casts to uuid) and keeps the slug it came with.
      if (opts.push && actor.kind === 'agent' && parseCard(saved.body)) {
        const room = await store.channelProject(saved.workspace, saved.channel).catch(() => null);
        void opts.push
          .notifyCardMessage(
            { id: saved.id, workspace: saved.workspace, channelId: saved.channel, taskId: saved.taskId, threadId: parsed.data.threadId ?? null, authorKind: saved.author.kind, authorId: saved.author.id, body: saved.body },
            `#${room?.slug ?? parsed.data.channel}`,
          )
          .catch(() => {});
      }
      return c.json({ message: saved, event });
    } catch (err) {
      if (err instanceof DomainError) return c.json({ error: err.message, code: err.code }, err.status as 404);
      throw err;
    }
  });

  // Create a chat attachment (idempotent; per-plan caps enforced server-side). The desktop posts
  // here from uploadData after staging the bytes locally — the full file never transits this API.
  app.post('/v1/artifacts', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ArtifactCreateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid artifact', issues: parsed.error.issues }, 400);
    const actor = c.get('actor');
    const limits = attachmentLimits(localMode() ? 'cloud' : await store.workspacePlan(parsed.data.workspace));
    try {
      const saved = await store.createAttachment(
        {
          id: parsed.data.id,
          workspace: parsed.data.workspace,
          channel: parsed.data.channel,
          taskId: parsed.data.taskId ?? null,
          messageId: parsed.data.messageId,
          kind: parsed.data.kind,
          name: parsed.data.name,
          mime: parsed.data.mime ?? null,
          inlineContent: parsed.data.inlineContent ?? null,
          sizeBytes: parsed.data.sizeBytes ?? null,
          width: parsed.data.width ?? null,
          height: parsed.data.height ?? null,
          author: { kind: actor.kind, id: actor.id },
        },
        limits,
      );
      return c.json({ artifact: saved });
    } catch (err) {
      if (err instanceof DomainError) return c.json({ error: err.message, code: err.code }, err.status as 402);
      throw err;
    }
  });

  // Whiteboards (docs/38) — the desktop's local-first lanes (uploadData forwards local rows
  // here) plus the daemon's reads (agent list/read tools). Agent writes go through
  // /v1/commands (whiteboard.create / whiteboard.update), never these.
  app.post('/v1/whiteboards', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = WhiteboardPutSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid whiteboard', issues: parsed.error.issues }, 400);
    const actor = c.get('actor');
    try {
      const saved = await store.createWhiteboard(
        {
          id: parsed.data.id,
          channelId: parsed.data.channel,
          threadId: parsed.data.threadId ?? null,
          taskId: parsed.data.taskId ?? null,
          title: parsed.data.title,
          scene: parsed.data.scene ?? null,
          snapshotSvg: parsed.data.snapshotSvg ?? null,
          snapshotRev: parsed.data.snapshotRev ?? 0,
          rev: parsed.data.rev,
          createdByKind: actor.kind,
          createdBy: actor.id,
        },
        (ws) => createEvent({
          type: 'whiteboard.created',
          source: formatAddress({ kind: actor.kind, id: actor.id }),
          target: formatAddress({ kind: 'channel', slug: parsed.data.channel }),
          workspace: ws,
          payload: { title: parsed.data.title },
        }),
      );
      return c.json({ whiteboard: saved });
    } catch (err) {
      if (err instanceof DomainError) return c.json({ error: err.message, code: err.code }, err.status as 404);
      throw err;
    }
  });

  app.patch('/v1/whiteboards/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = WhiteboardPatchSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid whiteboard patch', issues: parsed.error.issues }, 400);
    const actor = c.get('actor');
    const { applied } = await store.patchWhiteboardLww({
      id: c.req.param('id'),
      rev: parsed.data.rev,
      title: parsed.data.title,
      scene: parsed.data.scene,
      snapshotSvg: parsed.data.snapshotSvg,
      snapshotRev: parsed.data.snapshotRev,
      archivedAt: parsed.data.archivedAt,
      updatedByKind: actor.kind,
      updatedBy: actor.id,
    });
    return c.json({ applied });
  });

  app.get('/v1/whiteboards', async (c) => {
    const { workspace, channel, archived, limit } = c.req.query();
    if (!workspace && !channel) return c.json({ error: 'workspace or channel required', code: 'INVALID_INPUT' }, 400);
    const rows = await store.listWhiteboards({
      workspace,
      channel,
      includeArchived: archived === '1',
      limit: limit ? Number(limit) : undefined,
    });
    return c.json({ whiteboards: rows });
  });

  app.get('/v1/whiteboards/:id', async (c) => {
    const row = await store.getWhiteboard(c.req.param('id'));
    if (!row) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404);
    // the snapshot SVG never rides the API read — cards read it from the sync replica; an agent
    // reading a board wants the scene/source, and 150KB of SVG per read is pure drag
    const { snapshotSvg, ...rest } = row;
    return c.json({ whiteboard: { ...rest, hasSnapshot: !!snapshotSvg } });
  });

  // Register / unregister this device for push (mobile). Human-only; `token` is the
  // Expo push token. Stored control-api-side only (never synced). Idempotent upsert —
  // the client re-registers on token rotation and unregisters on sign-out.
  app.post('/v1/devices', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'push devices are human-only', code: 'NOT_PERMITTED' }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { platform?: string; token?: string; deviceName?: string; appVersion?: string };
    if (b.platform !== 'ios' && b.platform !== 'android') return c.json({ error: 'platform must be ios or android', code: 'INVALID_INPUT' }, 400);
    if (!b.token) return c.json({ error: 'token required', code: 'INVALID_INPUT' }, 400);
    await store.registerDevice({ userId: actor.id, platform: b.platform, token: b.token, deviceName: b.deviceName ?? null, appVersion: b.appVersion ?? null });
    return c.json({ ok: true });
  });
  // "have I got the app on a phone" — the setup tracker's mobile item. PLATFORMS ONLY: a push
  // token is a credential, so this route is shaped so it cannot leak one even by accident, and
  // it answers only for the CALLER (a device belongs to a person, not to a workspace).
  app.get('/v1/devices', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'push devices are human-only', code: 'NOT_PERMITTED' }, 403);
    const rows = await store.devicesForUsers([actor.id]);
    return c.json({ devices: rows.map((r) => ({ platform: r.platform })) });
  });
  app.post('/v1/devices/remove', async (c) => {
    const actor = c.get('actor');
    const b = (await c.req.json().catch(() => ({}))) as { token?: string };
    if (!b.token) return c.json({ error: 'token required', code: 'INVALID_INPUT' }, 400);
    await store.removeDevice(actor.id, b.token);
    return c.json({ ok: true });
  });

  // Daemon-only in spirit: returns the raw token for the resolution chain.
  // Agent Retro (docs/13): per-agent improvement aggregates over a rolling
  // window. Server-side because events/facts are deliberately unsynced.
  app.get('/v1/retro', async (c) => {
    const { workspace, range = 'week' } = c.req.query();
    if (!workspace) return c.json({ error: 'workspace required' }, 400);
    if (!(range in RETRO_RANGES)) return c.json({ error: `range must be one of ${Object.keys(RETRO_RANGES).join('|')}` }, 400);
    if (!store.retro) return c.json({ error: 'retro requires the postgres store' }, 501);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    return c.json(await store.retro(workspace, range as RetroRange, dayStart.getTime()));
  });

  // both credential reads are workspace-scoped by the CALLER, not by the query string
  // (credentials-authz.ts) — a workspace uuid is not a secret, so without this any signed-in
  // identity could read another workspace's provider tokens.
  app.get('/v1/credentials/resolve', async (c) => {
    const { workspace, provider = 'anthropic', agentId } = c.req.query();
    if (!workspace) return c.json({ error: 'workspace required' }, 400);
    if (!(await actorMayReadCredentials(store, c.get('actor'), workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    const r = await store.resolveCredential(workspace, provider, agentId ?? null);
    return c.json(r ?? { token: null, authMode: null, source: 'none', autoFailover: false });
  });

  app.get('/v1/credentials', async (c) => {
    const { workspace } = c.req.query();
    if (!workspace) return c.json({ error: 'workspace required' }, 400);
    if (!(await actorMayReadCredentials(store, c.get('actor'), workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    return c.json({ credentials: await store.listCredentials(workspace) });
  });

  app.get('/v1/workspaces', async (c) => c.json({ workspaces: await store.listWorkspaces(c.get('actor').id) }));

  // Pending invitations for the Members tab — not PowerSync-replicated (same doctrine as
  // /v1/workspaces): an invite is operator state, and it carries addresses of people who are
  // not members yet and so have no business in anyone's replica.
  app.get('/v1/invites', async (c) => {
    const { workspace } = c.req.query();
    if (!workspace) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    return c.json({ invites: await store.pendingInvites(workspace) });
  });

  // Invitations waiting on ME (0113) — what the desktop polls on boot and on window focus, and
  // the reason an already-signed-in user finally sees one at all. The address is resolved
  // SERVER-side from the caller's identity and never accepted from the request: taking an email
  // from the client here would let anyone enumerate (and then answer) someone else's invitation.
  app.get('/v1/invites/mine', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ invites: [] });
    const identity = await store.userIdentity(actor.id);
    if (!identity) return c.json({ invites: [] });
    let email = identity.email;
    if (identity.clerkUserId) {
      const primary = await clerkPrimaryEmail(identity.clerkUserId);
      if (primary) email = primary.verified ? primary.email : null;
    }
    if (!email) return c.json({ invites: [] });
    return c.json({ invites: await store.pendingInvitesForEmail(email) });
  });

  // Custom brains (user-authored model packs) — workspace-scoped config, deliberately not
  // PowerSync-replicated (same doctrine as /v1/workspaces): clients read on demand.
  app.get('/v1/model-packs', async (c) => {
    const { workspace } = c.req.query();
    if (!workspace) return c.json({ error: 'workspace required' }, 400);
    return c.json({ packs: await store.listModelPacks(workspace) });
  });

  // Billing (Cloud upgrade): mint a hosted Stripe Checkout / Customer-Portal URL the desktop opens in
  // the user's external browser — the human pays on Stripe's page, never in-app. The webhook flips the
  // plan; the desktop re-reads it on focus. Human-only; no-op (404) when billing isn't configured.
  app.post('/v1/billing/checkout', async (c) => {
    if (!billingEnabled()) return c.json({ error: 'billing not configured', code: 'NOT_FOUND' }, 404);
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'billing is human-only', code: 'NOT_PERMITTED' }, 403);
    const { workspace } = (await c.req.json().catch(() => ({}))) as { workspace?: string };
    if (!workspace) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    const info = await store.workspaceForBilling(workspace);
    const url = await createCheckoutSession({ workspace, quantity: info?.memberCount ?? 1, customerId: info?.stripeCustomerId ?? null });
    return c.json({ url });
  });

  // credit packs: one-time purchase, ANY plan — free users top up without upgrading. The
  // webhook grants; this only mints the hosted page.
  app.post('/v1/billing/credits-checkout', async (c) => {
    if (!billingEnabled()) return c.json({ error: 'billing not configured', code: 'NOT_FOUND' }, 404);
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'billing is human-only', code: 'NOT_PERMITTED' }, 403);
    const { workspace, credits } = (await c.req.json().catch(() => ({}))) as { workspace?: string; credits?: number };
    if (!workspace) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    // THE CLIENT NAMES A SIZE, THE SERVER NAMES THE PRICE — the invariant that survived opening
    // this up to custom amounts. It used to hold because the size had to match a menu entry;
    // now it holds because the price is COMPUTED here from the flat rate and the request's own
    // dollar figure is never read. An amount outside the bounds is refused rather than clamped:
    // silently charging someone a different number than they typed is worse than a 400.
    const n = Number(credits);
    if (!Number.isInteger(n) || n < MIN_PACK_CREDITS || n > MAX_PACK_CREDITS) return c.json({ error: `credits must be a whole number between ${MIN_PACK_CREDITS} and ${MAX_PACK_CREDITS}`, code: 'INVALID_INPUT', min: MIN_PACK_CREDITS, max: MAX_PACK_CREDITS, packs: CREDIT_PACKS }, 400);
    if (!(await actorInWorkspace(store, actor, workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    const info = await store.workspaceForBilling(workspace);
    const url = await createCreditsCheckout({ workspace, credits: n, usd: usdForCredits(n), customerId: info?.stripeCustomerId ?? null });
    return c.json({ url });
  });

  app.post('/v1/billing/portal', async (c) => {
    if (!billingEnabled()) return c.json({ error: 'billing not configured', code: 'NOT_FOUND' }, 404);
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'billing is human-only', code: 'NOT_PERMITTED' }, 403);
    const { workspace } = (await c.req.json().catch(() => ({}))) as { workspace?: string };
    if (!workspace) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    const info = await store.workspaceForBilling(workspace);
    if (!info?.stripeCustomerId) return c.json({ error: 'no Stripe customer yet — subscribe first', code: 'NOT_FOUND' }, 404);
    const url = await createPortalSession({ customerId: info.stripeCustomerId });
    return c.json({ url });
  });

  app.get('/v1/memory', async (c) => {
    const { workspace, channel } = c.req.query();
    if (!workspace || !channel) return c.json({ error: 'workspace and channel required' }, 400);
    try {
      return c.json(await store.channelMemory(workspace, channel));
    } catch (err) {
      if (err instanceof DomainError) return c.json({ error: err.message, code: err.code }, err.status as 404);
      throw err;
    }
  });

  app.post('/v1/recall', async (c) => {
    const b = (await c.req.json()) as { workspace?: string; channel?: string; query?: string; k?: number };
    if (!b.workspace || !b.query) return c.json({ error: 'workspace and query required', code: 'BAD_REQUEST' }, 400);
    const t0 = performance.now();
    const hits = await store.recall(b.workspace, b.channel ?? null, b.query, Math.min(b.k ?? 8, 25));
    return c.json({ hits, ms: Math.round(performance.now() - t0) });
  });

  app.get('/v1/tasks/:id', async (c) => {
    const task = await store.getTask(c.req.param('id'));
    if (!task) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404);
    const events = await store.listEvents(`task:${task.number}`);
    const artifacts = await store.listArtifacts(task.id);
    return c.json({ task, events, artifacts });
  });

  return app;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
