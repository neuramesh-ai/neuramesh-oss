// The Instagram and TikTok OAuth legs. Split out of connectors.ts.
import { randomBytes } from 'node:crypto';

import { seal, unseal } from './connector-crypto';

// ── Instagram: publishing rides the Meta Graph API — an IG BUSINESS/creator account
// linked to a Facebook Page, authorized via Facebook Login. Media is REQUIRED by the
// platform (text-only posts don't exist), so the poster demands the draft's media url.
export const IG_SCOPES = 'instagram_basic,instagram_content_publish,pages_show_list,business_management';
export const FB = 'https://graph.facebook.com/v21.0';
// ── TikTok: Login Kit (web flow) + Content Posting in MEDIA_UPLOAD mode — the
// unaudited-legal path: the photo lands in the creator's TikTok INBOX as a private
// draft and the human finishes + publishes it in the TikTok app (v31.8+). Photos are
// PULL_FROM_URL-only and TikTok pulls ONLY from developer-verified domains, so the
// poster hands TikTok a mediaSig-signed proxy URL on our API host (verify the api
// domain once in the TikTok portal; works for every user's arbitrary image URL).
// Access tokens live 24h (refresh 365d) — publishing refreshes routinely.
export const TT_SCOPES = 'user.info.basic,video.upload';
export const TT = 'https://open.tiktokapis.com/v2';

import type { TokenBundle } from './connectors';

export function instagramStartUrl(ctx: { workspace: string; channel: string | null; actor: string }, redirectUri: string): string {
  const state = seal({ ...ctx, nonce: randomBytes(16).toString('base64url') });
  const u = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  u.searchParams.set('client_id', String(process.env['META_APP_ID']));
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', IG_SCOPES);
  u.searchParams.set('state', state);
  return u.toString();
}

export async function instagramCallback(
  code: string,
  sealedState: string,
  redirectUri: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ workspace: string; channel: string | null; actor: string; handle: string; tokens: TokenBundle }> {
  const st = unseal<{ workspace: string; channel: string | null; actor: string }>(sealedState);
  const short = await fetchFn(`${FB}/oauth/access_token?client_id=${process.env['META_APP_ID']}&client_secret=${process.env['META_APP_SECRET']}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`);
  if (!short.ok) throw new Error(`meta token exchange failed ${short.status}: ${await short.text()}`);
  const shortTok = ((await short.json()) as { access_token: string }).access_token;
  // long-lived user token (~60 days) — the sealed credential of record
  const long = await fetchFn(`${FB}/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env['META_APP_ID']}&client_secret=${process.env['META_APP_SECRET']}&fb_exchange_token=${encodeURIComponent(shortTok)}`);
  const longTok = long.ok ? ((await long.json()) as { access_token: string; expires_in?: number }) : { access_token: shortTok };
  // find the first Page carrying a linked IG business account
  const pages = await fetchFn(`${FB}/me/accounts?fields=instagram_business_account%7Bid%2Cusername%7D&access_token=${encodeURIComponent(longTok.access_token)}`);
  if (!pages.ok) throw new Error(`meta pages lookup failed ${pages.status}`);
  const ig = ((await pages.json()) as { data?: Array<{ instagram_business_account?: { id: string; username?: string } }> })
    .data?.map((p) => p.instagram_business_account).find((a) => !!a);
  if (!ig) throw new Error('no Instagram business account is linked to your Facebook Pages — link one in Meta Business Suite, then reconnect');
  const tokens: TokenBundle = {
    access_token: longTok.access_token,
    ...(longTok.expires_in ? { expires_at: Date.now() + longTok.expires_in * 1000 } : {}),
    meta: { ig_user: ig.id },
  };
  return { workspace: st.workspace, channel: st.channel, actor: st.actor, handle: ig.username ? `@${ig.username}` : 'Instagram', tokens };
}

export function tiktokStartUrl(ctx: { workspace: string; channel: string | null; actor: string }, redirectUri: string): string {
  const state = seal({ ...ctx, nonce: randomBytes(16).toString('base64url') });
  const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
  u.searchParams.set('client_key', String(process.env['TIKTOK_CLIENT_KEY']));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', TT_SCOPES);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

export async function tiktokCallback(
  code: string,
  sealedState: string,
  redirectUri: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ workspace: string; channel: string | null; actor: string; handle: string; tokens: TokenBundle }> {
  const st = unseal<{ workspace: string; channel: string | null; actor: string }>(sealedState);
  const tokRes = await fetchFn(`${TT}/oauth/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: String(process.env['TIKTOK_CLIENT_KEY']), client_secret: String(process.env['TIKTOK_CLIENT_SECRET']),
      code, grant_type: 'authorization_code', redirect_uri: redirectUri,
    }).toString(),
  });
  if (!tokRes.ok) throw new Error(`tiktok token exchange failed ${tokRes.status}: ${await tokRes.text()}`);
  const tok = (await tokRes.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; open_id?: string; error?: string; error_description?: string };
  if (!tok.access_token) throw new Error(`tiktok token exchange rejected: ${tok.error_description ?? tok.error ?? 'no access_token'}`);
  const meRes = await fetchFn(`${TT}/user/info/?fields=display_name,username`, { headers: { authorization: `Bearer ${tok.access_token}` } });
  const me = meRes.ok ? ((await meRes.json()) as { data?: { user?: { display_name?: string; username?: string } } }).data?.user : undefined;
  const tokens: TokenBundle = {
    access_token: tok.access_token,
    ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
    ...(tok.expires_in ? { expires_at: Date.now() + tok.expires_in * 1000 } : {}),
    ...(tok.open_id ? { meta: { open_id: tok.open_id } } : {}),
  };
  return { workspace: st.workspace, channel: st.channel, actor: st.actor, handle: me?.username ? `@${me.username}` : (me?.display_name ?? 'TikTok'), tokens };
}
