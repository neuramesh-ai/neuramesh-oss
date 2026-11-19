// The social connectors' OAuth round-trip (marketing-channel plan §4.8), moved out of app.ts.
//
// THE START IS A SIGNED-IN ACT (R10 lane A, NM-011, 2026-11-09). GET /connect/:provider/start sat
// outside /v1 and took `workspace` and `actor` from the query string, sealing them into the state
// with no expiry: anyone who knew a workspace and channel uuid (ids are not secrets) could connect
// THEIR OWN X/LinkedIn/Instagram/TikTok account into it, silently replacing the room's connector, so
// its scheduled posts published to the attacker's account. The callback also reflected the handle
// into HTML unescaped. Now:
//   · POST /v1/connect/:provider/start (behind the /v1 gate) checks the CALLER is a member of the
//     workspace the channel lives in, takes the actor from the gate (never the body), and answers
//     the provider's authorize URL, whose sealed state carries an issue time;
//   · the old public GET start answers 410: a link built by an older client names no person;
//   · the callback refuses a state older than STATE_TTL_MS (or one with no issue time), re-checks
//     that the actor still belongs to the workspace and the channel to it, and escapes the handle.
import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { seal, unseal } from './connector-crypto';
import { sqlOf } from './credits';
import { connectorRedirectUri } from './connector-redirect';
import { linkedinCallback, linkedinStartUrl, providerConfigured, xCallback, xStartUrl } from './connectors';
import { instagramCallback, instagramStartUrl, tiktokCallback, tiktokStartUrl } from './connectors-meta';
import { routeMayWrite } from './handler/scope';
import { mayUseDestination } from './marketing-access';
import type { Store } from './store';

type Ctx = { workspace: string; channel: string | null; actor: string };
const CONNECT_FLOWS: Record<string, {
  start: (ctx: Ctx, redirectUri: string) => string;
  callback: (code: string, state: string, redirectUri: string) => Promise<Ctx & { handle: string; tokens: unknown }>;
  scopes: string;
}> = {
  x: { start: xStartUrl, callback: xCallback, scopes: 'tweet.read tweet.write users.read offline.access' },
  linkedin: { start: linkedinStartUrl, callback: linkedinCallback, scopes: 'openid profile w_member_social' },
  instagram: { start: instagramStartUrl, callback: instagramCallback, scopes: 'instagram_basic instagram_content_publish pages_show_list business_management' },
  tiktok: { start: tiktokStartUrl, callback: tiktokCallback, scopes: 'user.info.basic video.upload' },
};

/** A SOCIAL ACCOUNT IS A MARKETING ROW (0181), so the person who connects one needs Marketing access,
 *  as `connector.disconnect` on the same row does. Before, any member could replace the project's
 *  account from a build room (the security lane's review, 2026-11-13). Only a store with a database
 *  holds that boundary, as in marketing-access.ts: the in-memory store has phantom workspaces. */
const marketingAllowed = async (store: Store, actor: Actor, workspace: string): Promise<boolean> =>
  !sqlOf(store) || !store.destinations || mayUseDestination(store, actor, workspace, 'marketing');

/** a state is good for the authorize round-trip and no longer (a person consents in seconds) */
export const STATE_TTL_MS = 15 * 60_000;

const configured = (provider: string): boolean => !!CONNECT_FLOWS[provider] && !!process.env['NM_CONNECTOR_KEY'] && providerConfigured(provider);
// the configured public origin, never the request's own: TLS ends before the API (connector-redirect.ts)
const callbackUri = connectorRedirectUri;
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** the public half: the provider's callback (and the retired public start) */
export function socialConnectRoutes<E extends Env>(app: Hono<E>, store: Store): void {
  app.get('/connect/:provider/start', (c) => {
    const provider = c.req.param('provider');
    if (!configured(provider)) return c.text(`${provider} connect is not configured on this server`, 501);
    return c.text('This connect link is out of date. Select Connect again in NeuraMesh. If you see this page again, update the app.', 410);
  });

  app.get('/connect/:provider/callback', async (c) => {
    const provider = c.req.param('provider');
    const flow = CONNECT_FLOWS[provider];
    if (!flow || !configured(provider)) return c.text(`${provider} connect is not configured on this server`, 501);
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.text('missing code/state', 400);
    let st: { iat?: unknown } | null = null;
    try { st = unseal<{ iat?: unknown }>(state); } catch { st = null; }
    const now = Date.now();
    if (!st || typeof st.iat !== 'number' || now - st.iat > STATE_TTL_MS || st.iat > now + 60_000) {
      return c.text('This connection link expired. Close this tab. Then select Connect again in NeuraMesh.', 400);
    }
    try {
      const out = await flow.callback(code, state, callbackUri(c.req.url, provider));
      // the person who started it must still be in the workspace, and the room must be the workspace's
      const person: Actor = { kind: 'human', id: out.actor };
      if (!(await routeMayWrite(store, person, out.workspace, [['channel', out.channel]]))) return c.text('You are not a member of that workspace now.', 403);
      if (!(await marketingAllowed(store, person, out.workspace))) return c.text('You have no Marketing access in that workspace now.', 403);
      const { id } = await store.upsertConnector({ workspace: out.workspace, channelId: out.channel, provider, handle: out.handle, connectedBy: out.actor, scopes: flow.scopes });
      await store.setConnectorSecret(id, seal(out.tokens));
      return c.html(`<!doctype html><meta charset="utf-8"><title>Connected</title><body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#1d1d1d;color:#e6e6e6"><div style="text-align:center"><div style="font-size:34px">✓</div><p><b>${escapeHtml(out.handle || provider)}</b> is connected.</p><p style="color:#8f8f8f">Head back to NeuraMesh — the room already knows.</p></div></body>`);
    } catch (e) {
      console.error(`${provider} connect callback failed:`, e);
      return c.text('connection failed — close this tab and try again from NeuraMesh', 400);
    }
  });
}

/** the signed-in half, registered after the /v1 gate: the start, for a member of the room's workspace */
export function socialConnectApiRoutes<E extends Env & { Variables: { actor: Actor; machine?: { id: string; workspaceId: string } } }>(app: Hono<E>, store: Store): void {
  app.post('/v1/connect/:provider/start', async (c) => {
    const provider = c.req.param('provider');
    const flow = CONNECT_FLOWS[provider];
    if (!flow || !configured(provider)) return c.json({ error: `${provider} connect is not configured on this server`, code: 'NOT_CONFIGURED' }, 501);
    const actor = c.get('actor');
    if (actor.kind !== 'human' || c.get('machine')) return c.json({ error: 'a person connects an account', code: 'HUMAN_ONLY' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { channel?: unknown; workspace?: unknown };
    const channel = typeof body.channel === 'string' && body.channel ? body.channel : null;
    if (!channel) return c.json({ error: 'channel is required', code: 'INVALID_INPUT' }, 400);
    const owner = await store.channelWorkspace(channel).catch(() => null);
    const workspace = typeof body.workspace === 'string' && body.workspace ? body.workspace : owner?.workspace;
    if (!workspace || !(await routeMayWrite(store, actor, workspace, [['channel', channel]]))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    if (!(await marketingAllowed(store, actor, workspace))) return c.json({ error: 'Ask the workspace owner to add you to Marketing.', code: 'NOT_PERMITTED' }, 403);
    const ctx = { workspace, channel, actor: actor.id, iat: Date.now() };
    return c.json({ url: flow.start(ctx, callbackUri(c.req.url, provider)) });
  });
}
