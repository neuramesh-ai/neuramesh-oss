// Connectors (marketing-channel plan §4.8): the server-side half of "agents draft, humans
// publish". Env-gated like billing.ts — absent envs make every entry point a hard no-op:
//   NM_CONNECTOR_KEY  — seals tokens (AES-256-GCM; the raw key is sha256(env) so any
//                       strong string works). Tokens NEVER leave this process unsealed.
//   X_CLIENT_ID / X_CLIENT_SECRET — the X developer app (OAuth2 PKCE, offline access).
//   CRON_SECRET       — Vercel cron auth for the publish pass (Bearer, sent automatically).
// The OAuth round-trip runs in the user's external browser against these routes (the
// billing-checkout pattern); the desktop only ever sees the synced connectors row.
import { randomBytes } from 'node:crypto';
import type { Store } from './store';
import { mediaSig, seal, unseal } from './connector-crypto';
import { XReauthRequired, xPoster as xPosterImpl } from './connectors-x';
import { FB, TT } from './connectors-meta';

export const connectorsEnabled = (): boolean =>
  !!process.env['NM_CONNECTOR_KEY'] && (providerConfigured('x') || providerConfigured('linkedin') || providerConfigured('instagram') || providerConfigured('tiktok'));

/** Per-provider env gates — a provider without its app keys is a hard no-op while the
 * others keep working (LinkedIn ships without waiting on Meta's review, and vice versa). */
export function providerConfigured(provider: string): boolean {
  if (provider === 'x') return !!process.env['X_CLIENT_ID'] && !!process.env['X_CLIENT_SECRET'];
  if (provider === 'linkedin') return !!process.env['LINKEDIN_CLIENT_ID'] && !!process.env['LINKEDIN_CLIENT_SECRET'];
  if (provider === 'instagram') return !!process.env['META_APP_ID'] && !!process.env['META_APP_SECRET'];
  if (provider === 'tiktok') return !!process.env['TIKTOK_CLIENT_KEY'] && !!process.env['TIKTOK_CLIENT_SECRET'];
  return false;
}

export interface TokenBundle {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  /** provider-specific identifiers that must travel with the token (LinkedIn person id,
   * Instagram business-account id) — sealed alongside, never synced */
  meta?: Record<string, string>;
}


// ── LinkedIn: OAuth 2.0 (confidential client, no PKCE) + the versioned Posts API.
// Text posts are first-class, which matches our drafts exactly. Access tokens live ~60
// days; programmatic refresh is partner-gated, so an expired token fails loudly with
// "reconnect" rather than pretending.
const LI_SCOPES = 'openid profile w_member_social';
const LI_VERSION = '202506';

export function linkedinStartUrl(ctx: { workspace: string; channel: string | null; actor: string }, redirectUri: string): string {
  const state = seal({ ...ctx, nonce: randomBytes(16).toString('base64url') });
  const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', String(process.env['LINKEDIN_CLIENT_ID']));
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', LI_SCOPES);
  u.searchParams.set('state', state);
  return u.toString();
}

export async function linkedinCallback(
  code: string,
  sealedState: string,
  redirectUri: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ workspace: string; channel: string | null; actor: string; handle: string; tokens: TokenBundle }> {
  const st = unseal<{ workspace: string; channel: string | null; actor: string }>(sealedState);
  const tokRes = await fetchFn('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
      client_id: String(process.env['LINKEDIN_CLIENT_ID']), client_secret: String(process.env['LINKEDIN_CLIENT_SECRET']),
    }).toString(),
  });
  if (!tokRes.ok) throw new Error(`linkedin token exchange failed ${tokRes.status}: ${await tokRes.text()}`);
  const tok = (await tokRes.json()) as { access_token: string; expires_in?: number; refresh_token?: string };
  const meRes = await fetchFn('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } });
  if (!meRes.ok) throw new Error(`linkedin userinfo failed ${meRes.status}`);
  const me = (await meRes.json()) as { sub?: string; name?: string };
  if (!me.sub) throw new Error('linkedin userinfo returned no subject');
  const tokens: TokenBundle = {
    access_token: tok.access_token,
    ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
    ...(tok.expires_in ? { expires_at: Date.now() + tok.expires_in * 1000 } : {}),
    meta: { person: me.sub },
  };
  return { workspace: st.workspace, channel: st.channel, actor: st.actor, handle: me.name ?? 'LinkedIn', tokens };
}



/** What the publish pass calls per item. secretPatch returns a re-sealed bundle when the
 * poster had to refresh — the caller persists it so refresh tokens rotate correctly.
 * opts.persistPatch lands a rotation the MOMENT it happens (X's refresh tokens are single-use;
 * waiting for the call to fully succeed is how a failed post strands a spent token — the
 * @joinflowe incident). opts.mediaUrl carries the draft's attached image (Instagram/TikTok
 * require it); opts.itemId + opts.publicBase let a poster mint proxy URLs for its platform's pulls. */
export interface Poster {
  post(tokens: TokenBundle, body: string, opts?: { mediaUrl?: string | null; itemId?: string; publicBase?: string | null; persistPatch?: (bundle: TokenBundle) => Promise<void> }, fetchFn?: typeof fetch): Promise<{ url: string; secretPatch?: TokenBundle }>;
}


export const liPoster: Poster = {
  async post(tokens, body, _opts, fetchFn = fetch) {
    const person = tokens.meta?.['person'];
    if (!person) throw new Error('linkedin token bundle is missing the person id — reconnect LinkedIn');
    if (tokens.expires_at && tokens.expires_at < Date.now()) throw new Error('linkedin token expired — reconnect LinkedIn from the room');
    const res = await fetchFn('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokens.access_token}`,
        'LinkedIn-Version': LI_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author: `urn:li:person:${person}`,
        commentary: body,
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });
    if (res.status === 401) throw new Error('linkedin rejected the token — reconnect LinkedIn from the room');
    if (!res.ok) throw new Error(`linkedin post failed ${res.status}: ${await res.text()}`);
    const id = res.headers.get('x-restli-id');
    if (!id) throw new Error('linkedin post returned no id');
    return { url: `https://www.linkedin.com/feed/update/${id}` };
  },
};

export const igPoster: Poster = {
  async post(tokens, body, opts, fetchFn = fetch) {
    const igUser = tokens.meta?.['ig_user'];
    if (!igUser) throw new Error('instagram token bundle is missing the account id — reconnect Instagram');
    if (!opts?.mediaUrl) throw new Error('instagram needs an image on the draft — add a media URL in the post preview');
    if (tokens.expires_at && tokens.expires_at < Date.now()) throw new Error('instagram token expired — reconnect Instagram from the room');
    const cont = await fetchFn(`${FB}/${igUser}/media`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ image_url: opts.mediaUrl, caption: body, access_token: tokens.access_token }).toString(),
    });
    if (!cont.ok) throw new Error(`instagram container failed ${cont.status}: ${await cont.text()}`);
    const creation = ((await cont.json()) as { id?: string }).id;
    if (!creation) throw new Error('instagram container returned no id');
    const pub = await fetchFn(`${FB}/${igUser}/media_publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: creation, access_token: tokens.access_token }).toString(),
    });
    if (!pub.ok) throw new Error(`instagram publish failed ${pub.status}: ${await pub.text()}`);
    const mediaId = ((await pub.json()) as { id?: string }).id;
    if (!mediaId) throw new Error('instagram publish returned no id');
    const perma = await fetchFn(`${FB}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(tokens.access_token)}`);
    const url = perma.ok ? (((await perma.json()) as { permalink?: string }).permalink ?? `https://www.instagram.com/`) : 'https://www.instagram.com/';
    return { url };
  },
};

async function ttRefresh(tokens: TokenBundle, fetchFn: typeof fetch): Promise<TokenBundle> {
  if (!tokens.refresh_token) throw new Error('tiktok token expired and no refresh token — reconnect TikTok from the room');
  const res = await fetchFn(`${TT}/oauth/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: String(process.env['TIKTOK_CLIENT_KEY']), client_secret: String(process.env['TIKTOK_CLIENT_SECRET']),
      grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
    }).toString(),
  });
  if (!res.ok) throw new Error(`tiktok token refresh failed ${res.status} — reconnect TikTok from the room`);
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tok.access_token) throw new Error('tiktok token refresh returned no access_token — reconnect TikTok from the room');
  return {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? tokens.refresh_token, // TikTok may rotate — keep the returned one
    ...(tok.expires_in ? { expires_at: Date.now() + tok.expires_in * 1000 } : {}),
    ...(tokens.meta ? { meta: tokens.meta } : {}),
  };
}

// where inbox drafts surface on web — there is no permalink until the human publishes
const TT_DRAFTS_URL = 'https://www.tiktok.com/tiktokstudio/content?tab=draft';

export const ttPoster: Poster = {
  async post(tokens, body, opts, fetchFn = fetch) {
    if (!opts?.mediaUrl) throw new Error('tiktok needs an image on the draft — add a media URL in the post preview');
    if (!opts.itemId || !opts.publicBase) throw new Error('tiktok publishing needs the public API base for its media proxy — set it up before arming tiktok posts');
    let t = tokens;
    let refreshed = false;
    // 24h tokens: expiry here is routine, not exceptional — refresh in-line like xPoster
    if (t.expires_at && t.expires_at < Date.now() + 60_000) { t = await ttRefresh(t, fetchFn); refreshed = true; }
    const proxied = `${opts.publicBase.replace(/\/$/, '')}/connect/tiktok/media/${encodeURIComponent(opts.itemId)}?s=${mediaSig(opts.itemId)}`;
    const init = () => fetchFn(`${TT}/post/publish/content/init/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8', authorization: `Bearer ${t.access_token}` },
      body: JSON.stringify({
        post_info: { title: body.split('\n')[0]!.slice(0, 90), description: body.slice(0, 4000) },
        source_info: { source: 'PULL_FROM_URL', photo_images: [proxied], photo_cover_index: 0 },
        post_mode: 'MEDIA_UPLOAD', // inbox draft — the human publishes in the TikTok app
        media_type: 'PHOTO',
      }),
    });
    let res = await init();
    if (res.status === 401 && !refreshed) { t = await ttRefresh(t, fetchFn); refreshed = true; res = await init(); }
    const out = (await res.json().catch(() => ({}))) as { data?: { publish_id?: string }; error?: { code?: string; message?: string } };
    const errCode = out.error?.code ?? '';
    if (!res.ok || (errCode && errCode !== 'ok')) {
      if (errCode === 'url_ownership_unverified') throw new Error('tiktok rejected our media host — verify the api domain URL prefix in the TikTok developer portal (one-time setup)');
      if (errCode === 'spam_risk_too_many_pending_share') throw new Error('tiktok caps pending inbox uploads (5 per 24h) — publish or discard waiting drafts in the TikTok app first');
      throw new Error(`tiktok upload failed ${res.status}${errCode ? ` (${errCode})` : ''}: ${out.error?.message ?? ''}`);
    }
    if (!out.data?.publish_id) throw new Error('tiktok upload returned no publish id');
    return { url: TT_DRAFTS_URL, ...(refreshed ? { secretPatch: t } : {}) };
  },
};

/** The default poster registry — one per platform that can actually publish today.
 * tiktok publishes to the creator's INBOX as a private draft (the unaudited-legal mode);
 * the human makes it live from the TikTok app. */
// X lives in its own file (connectors-x.ts), but `connectors` stays the ONE import every
// consumer uses — a split inside a module is not a reason for callers to learn a second path.
export { XReauthRequired, xStartUrl, xCallback, xPoster, xSearchOnConnector, xSearchRecent, type XSearchHit } from './connectors-x';

export const POSTERS: Record<string, Poster> = { x: xPosterImpl, linkedin: liPoster, instagram: igPoster, tiktok: ttPoster };

/** The publish pass (the Vercel cron's body): due + approved → route to the platform's
 * poster → receipt. One item failing never blocks the rest; failures land on the row
 * (last_error) loudly, not silently. */
// The publish pass self-fetches hosted media through `publicBase` — and Vercel cron invokes
// /internal/publish-due on the DEPLOYMENT's own url (never the custom domain), where Deployment
// Protection meets the anonymous self-fetch with a 302 into vercel.com's login page: ~482KB of
// text/html we then uploaded to X as `image/jpeg` for four straight rounds ("media type
// unrecognized" was X sniffing the truth). A *.vercel.app origin is never a base another
// service can fetch — the canonical public origin is.
export function publicApiBase(reqUrl: string): string {
  const origin = new URL(reqUrl).origin;
  if (!new URL(origin).hostname.endsWith('.vercel.app')) return origin; // localhost dev, the real alias
  return process.env['NM_API_URL'] ?? 'https://api.neuramesh.app';
}

export async function publishDueItems(store: Store, posters: Record<string, Poster>, now: Date = new Date(), publicBase: string | null = null): Promise<{ published: number; failed: number; held: number }> {
  const due = await store.dueContentItems(now.toISOString(), 10);
  let published = 0;
  let failed = 0;
  let held = 0;
  for (const item of due) {
    try {
      const poster = posters[item.platform];
      if (!poster) throw new Error(`publishing for ${item.platform} isn't wired yet`);
      // a hosted image (0090) wins over a pasted URL — it is the one we know is fetchable
      const mediaUrl = item.mediaId && publicBase
        ? `${publicBase}/media/${item.mediaId}?s=${mediaSig(item.mediaId)}`
        : item.mediaUrl ?? null;
      // SAFETY (2026-07-24): a post that was MEANT to carry an image must never go out text-only
      // just because its slot arrived before the picture finished generating — a scheduled X post
      // published without its (still-generating) image, then the image landed on the card after the
      // fact. HOLD it: leave it scheduled (no status change) so the very next pass sends it complete
      // once the image is attached. A genuinely image-less post (no brief/preview) still publishes.
      if (!mediaUrl && item.imageIntended) {
        console.log(`publish_hold item=${item.id.slice(0, 8)} platform=${item.platform} reason=media_not_ready`);
        held += 1;
        continue;
      }
      // A FILM posts to X (the video rung, 2026-09-19: the chunked upload takes a video the way it
      // takes a picture). The other networks' posters know pictures only, so a film fails loudly
      // with the way out, never silently as a text post or as an upload that dies in their words.
      if (item.mediaKind === 'video' && item.platform !== 'x') throw new Error(`NeuraMesh cannot post a video to ${item.platform} yet. Download the film from the card menu and post it there.`);
      // the item's own room decides which project's account posts it (0106)
      const conn = await store.connectorWithSecret(item.workspace, item.platform, item.channel ?? null);
      if (!conn || conn.status !== 'connected' || !conn.ciphertext) throw new Error(`no connected ${item.platform} account`);
      const opts = {
        mediaUrl, itemId: item.id, publicBase,
        persistPatch: async (b: TokenBundle) => { await store.setConnectorSecret(conn.id, seal(b)); },
      };
      const runPost = (ciphertext: string) => poster.post(unseal<TokenBundle>(ciphertext), item.body, opts);
      let out;
      try {
        out = await runPost(conn.ciphertext);
      } catch (e) {
        if (!(e instanceof XReauthRequired)) throw e;
        // the grant died under us — unless a concurrent caller rotated the secret (they are
        // single-use, so racing a sweep is normal), flip the row and fail the item with the
        // one instruction that actually fixes it, instead of retrying into a 400 forever.
        // The CAUSE rides along: "needs re-authorizing" alone told a human what to do but not
        // why, and the why (a spent token vs a missing media.write grant) is the difference
        // between "something broke" and "reconnect once and it's fixed".
        const dead = async (cause: Error): Promise<never> => {
          await store.markConnectorReauth(conn.id);
          throw new Error(`the connected ${item.platform} account${conn.handle ? ` (${conn.handle})` : ''} needs re-authorizing — reconnect it from Connections, then re-approve this post. (${cause.message.slice(0, 220)})`);
        };
        const fresh = await store.connectorWithSecret(item.workspace, item.platform, item.channel ?? null);
        if (!fresh?.ciphertext || fresh.ciphertext === conn.ciphertext) await dead(e);
        try {
          out = await runPost(fresh!.ciphertext!);
        } catch (e2) {
          if (e2 instanceof XReauthRequired) await dead(e2);
          throw e2;
        }
      }
      if (out.secretPatch) await store.setConnectorSecret(conn.id, seal(out.secretPatch));
      await store.markContentPublished(item.id, out.url, now.toISOString());
      published += 1;
    } catch (e) {
      await store.markContentFailed(item.id, e instanceof Error ? e.message : String(e)).catch(() => {});
      failed += 1;
    }
  }
  return { published, failed, held };
}
