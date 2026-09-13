// THE X CONNECTOR — its OAuth, its token refresh, its media upload, its poster, its search.
//
// Split out of connectors.ts, which held four networks' posters plus the publish loop in one
// file. X earns its own because it is the only one that is BOTH a publish target and a read
// source (xSearchRecent rides the same credentials), so its refresh path has two callers and
// belongs beside both.
//
// The back-imports to connectors.ts are TYPE-ONLY on purpose: connectors.ts imports xPoster as
// a value for the POSTERS registry, so a value import in this direction would be a real cycle.
import { createHash, randomBytes } from 'node:crypto';
import { sniffImageMime } from '@neuramesh/shared';
import { seal, unseal } from './connector-crypto';
import type { Poster, TokenBundle } from './connectors';
import type { Store } from './store';

/** X's token endpoint saying the stored grant ITSELF is dead — the refresh token was revoked,
 * expired, or already spent (X's refresh tokens are single-use). Retrying can never fix it;
 * only a human re-running the Connect flow can. Callers catch this to flip the connector's
 * synced status and put a reconnect instruction in front of a human, instead of letting every
 * sweep fail with a bare `x token refresh failed 400` forever (the @joinflowe incident). */
export class XReauthRequired extends Error {}

// `media.write` is required by the v2 media upload endpoint (X split it out of tweet.write) —
// without it every image post 403s at upload while text-only tweets sail through, and the
// connector still reads 'connected' because nothing about the auth is wrong. Scopes are fixed
// at grant time: an account connected before this line needs ONE reconnect to post images.
const X_SCOPES = 'tweet.read tweet.write users.read offline.access media.write';

/** The authorize redirect. PKCE verifier + the caller's context ride INSIDE the sealed
 * state — cookieless, tamper-proof, and nothing to store server-side mid-flow. */
export function xStartUrl(ctx: { workspace: string; channel: string | null; actor: string }, redirectUri: string): string {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = seal({ ...ctx, verifier });
  const u = new URL('https://x.com/i/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', String(process.env['X_CLIENT_ID']));
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', X_SCOPES);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

/** Code → tokens → @handle. fetchFn injectable for tests. */
export async function xCallback(
  code: string,
  sealedState: string,
  redirectUri: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ workspace: string; channel: string | null; actor: string; handle: string; tokens: TokenBundle }> {
  const st = unseal<{ workspace: string; channel: string | null; actor: string; verifier: string }>(sealedState);
  const basic = Buffer.from(`${process.env['X_CLIENT_ID']}:${process.env['X_CLIENT_SECRET']}`).toString('base64');
  const tokRes = await fetchFn('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: st.verifier }).toString(),
  });
  if (!tokRes.ok) throw new Error(`x token exchange failed ${tokRes.status}: ${await tokRes.text()}`);
  const tok = (await tokRes.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const tokens: TokenBundle = {
    access_token: tok.access_token,
    ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
    ...(tok.expires_in ? { expires_at: Date.now() + tok.expires_in * 1000 } : {}),
  };
  const meRes = await fetchFn('https://api.x.com/2/users/me', { headers: { authorization: `Bearer ${tokens.access_token}` } });
  const handle = meRes.ok ? `@${(((await meRes.json()) as { data?: { username?: string } }).data?.username ?? '')}` : '';
  return { workspace: st.workspace, channel: st.channel, actor: st.actor, handle, tokens };
}

/** Refresh, then hand the ROTATED bundle to `persist` before returning. X's refresh tokens are
 * single-use: the stored one is spent the moment X answers, so the new bundle must be durable
 * BEFORE the API call that follows gets a chance to fail — persisting only on a fully successful
 * call is what stranded @joinflowe with a spent refresh token after one rate-limited sweep. */
async function refreshTokens(tokens: TokenBundle, fetchFn: typeof fetch, persist?: (t: TokenBundle) => Promise<void>): Promise<TokenBundle> {
  if (!tokens.refresh_token) throw new XReauthRequired('x token expired and the stored authorization has no refresh token');
  const basic = Buffer.from(`${process.env['X_CLIENT_ID']}:${process.env['X_CLIENT_SECRET']}`).toString('base64');
  const res = await fetchFn('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }).toString(),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    // 400 from the token endpoint = the grant is unusable (X answers `invalid_request` for
    // revoked, expired, and already-spent refresh tokens). Everything else — 401 is our app
    // creds, 429/5xx is X's weather — stays a plain loud error, never a reconnect verdict.
    if (res.status === 400) throw new XReauthRequired(`x refused to renew the stored authorization${detail ? ` (${detail})` : ''}`);
    throw new Error(`x token refresh failed ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const next: TokenBundle = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? tokens.refresh_token,
    ...(tok.expires_in ? { expires_at: Date.now() + tok.expires_in * 1000 } : {}),
  };
  // a failed write here must not fail the call — the caller's end-of-call secretPatch is the retry
  if (persist) await persist(next).catch((e) => console.error('x token rotation persist failed:', e));
  return next;
}

const X_MEDIA_MAX = 5_000_000; // X's image ceiling

/** Pull the draft's image so it can be uploaded. Works for our own hosted /media/<id> and for a
 *  URL a human pasted — X is the one network that wants BYTES rather than a link. */
async function fetchMediaBytes(url: string, fetchFn: typeof fetch): Promise<{ bytes: Buffer; mime: string }> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`media url did not load (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new Error('media url returned no bytes');
  if (bytes.length > X_MEDIA_MAX) throw new Error(`image too large for X (${bytes.length} bytes, max 5MB)`);
  const ct = ((res.headers.get('content-type') ?? '').split(';')[0] ?? '').toLowerCase();
  // the BYTES outrank the header: our own /media route echoes the mime the generator DECLARED,
  // and a declared-vs-actual drift dies days later at X's finalize. Unrecognizable bytes REFUSE
  // to upload — mislabeled garbage burns an attempt and answers with X's vaguest error; the hex
  // head in the message is the remote diagnosis (what did the route actually serve?).
  const sniffed = sniffImageMime(new Uint8Array(bytes.subarray(0, 16)));
  if (!sniffed) throw new Error(`the hosted media is not a recognizable image (served ${ct || 'no content-type'}, ${bytes.length} bytes, head ${bytes.subarray(0, 8).toString('hex')}) — regenerate the image on the card (Try again), then re-approve`);
  return { bytes, mime: sniffed };
}

/** Upload one image to X and return its media id.
 *
 *  Three request shapes, three sub-endpoints — pinned from a LIVE-VERIFIED client
 *  (node-twitter-api-v2 `uploadMedia`, client.v2.write.ts, master @ 2026-08) after two
 *  doc-shaped guesses failed against the real API: the docs' one-URL command-multipart story
 *  answered "Missing media field in JSON" because the ROOT endpoint wants a JSON body — the
 *  chunked flow lives on sub-paths. INITIALIZE: POST /2/media/upload/initialize, flat JSON
 *  (media_type · total_bytes · media_category) → data.id. APPEND: POST /2/media/upload/{id}/
 *  append, multipart (segment_index + the bytes, 1MB chunks like the reference client).
 *  FINALIZE: bare POST /2/media/upload/{id}/finalize. STATUS: GET ?command=STATUS&media_id=.
 *  The boundary must be left to fetch on the multipart step (hand-set content-type breaks it);
 *  ids are read defensively (data.id, else the older media_id_string). */
async function uploadXMedia(accessToken: string, bytes: Buffer, mime: string, fetchFn: typeof fetch): Promise<string> {
  type UploadReply = { data?: { id?: string; processing_info?: { state?: string; check_after_secs?: number; error?: { message?: string } } }; id?: string; media_id_string?: string };
  const U = 'https://api.x.com/2/media/upload';
  // what we sent, in every error — four rounds of guessing taught us the failure must describe
  // itself: the declared mime, the byte count and the head are the whole remote diagnosis
  const sent = `sent ${mime} ${bytes.length}B head ${bytes.subarray(0, 8).toString('hex')}`;
  const guard = async (res: Response, step: string): Promise<UploadReply> => {
    // 403 is the missing `media.write` grant (see X_SCOPES) — a DEAD GRANT for this work: no
    // retry can fix it, only a human re-running Connect. XReauthRequired flips the connector
    // row and the attention bar grows its Reconnect button.
    if (res.status === 403) throw new XReauthRequired(`x refused the image upload (403) — the connected account's authorization predates image posting (no media.write grant). X said: ${(await res.text().catch(() => '')).slice(0, 160)}`);
    if (!res.ok) throw new Error(`x media ${step} failed ${res.status} (${sent}): ${(await res.text().catch(() => '')).slice(0, 180)}`);
    return (await res.json().catch(() => ({}))) as UploadReply; // append may answer 2xx with no body
  };
  const idOf = (j: UploadReply): string | undefined => j.data?.id ?? j.id ?? j.media_id_string;

  // THE CONTRACT (docs.x.com media-upload-append + node-twitter-api-v2, both live-checked):
  // INITIALIZE and APPEND both accept application/json — and JSON with base64 bytes
  // (`media` format: byte) is the shape with NO multipart-parser variance, which is exactly
  // where the last ambiguity lived: a 2xx append that X silently parsed as zero media parts
  // finalizes into "media type unrecognized" because the sniffed buffer is empty.
  const init = await guard(await fetchFn(`${U}/initialize`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ media_type: mime, total_bytes: bytes.length, media_category: 'tweet_image' }),
  }), 'init');
  const id = idOf(init);
  if (!id) throw new Error(`x media init returned no media id (${sent})`);

  const CHUNK = 1024 * 1024;
  for (let i = 0; i * CHUNK < bytes.length; i += 1) {
    const part = bytes.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, bytes.length));
    await guard(await fetchFn(`${U}/${id}/append`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ segment_index: i, media: part.toString('base64') }),
    }), 'append');
  }

  let fin = await guard(await fetchFn(`${U}/${id}/finalize`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } }), 'finalize');
  // images normally finalize inline; a pending state gets a short, bounded courtesy poll
  for (let i = 0; i < 3; i += 1) {
    const p = fin.data?.processing_info;
    if (!p?.state || p.state === 'succeeded') break;
    if (p.state === 'failed') throw new Error(`x media processing failed after upload (${sent})${p.error?.message ? `: ${p.error.message}` : ''}`);
    await new Promise((r) => setTimeout(r, Math.min(5, p.check_after_secs ?? 1) * 1000));
    fin = await guard(await fetchFn(`${U}?command=STATUS&media_id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${accessToken}` } }), 'status');
  }
  return id;
}

export const xPoster: Poster = {
  async post(tokens, body, opts, fetchFn = fetch) {
    let t = tokens;
    let refreshed = false;
    if (t.expires_at && t.expires_at < Date.now() + 30_000) { t = await refreshTokens(t, fetchFn, opts?.persistPatch); refreshed = true; }
    // media is optional on X (unlike IG/TikTok) — a text-only tweet is still a tweet
    let mediaIds: string[] | null = null;
    if (opts?.mediaUrl) {
      const got = await fetchMediaBytes(opts.mediaUrl, fetchFn);
      mediaIds = [await uploadXMedia(t.access_token, got.bytes, got.mime, fetchFn)];
    }
    const payload = (): string => JSON.stringify({ text: body, ...(mediaIds ? { media: { media_ids: mediaIds } } : {}) });
    let res = await fetchFn('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${t.access_token}` },
      body: payload(),
    });
    if (res.status === 401 && !refreshed) {
      t = await refreshTokens(t, fetchFn, opts?.persistPatch); refreshed = true;
      res = await fetchFn('https://api.x.com/2/tweets', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${t.access_token}` },
        body: payload(),
      });
    }
    if (!res.ok) throw new Error(`x post failed ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data?: { id?: string } };
    const id = data.data?.id;
    if (!id) throw new Error('x post returned no id');
    return { url: `https://x.com/i/web/status/${id}`, ...(refreshed ? { secretPatch: t } : {}) };
  },
};

// ── READING X on the SAME connection that publishes (2026-08-09) ─────────────────────────
//
// The Connect button has always requested `tweet.read users.read` (X_SCOPES above) — nothing
// ever read them. The first cut of X research asked each user for their own app's Bearer
// Token instead, which is fine for a developer and impossible for a customer: users do not
// have X developer apps. So reads ride the connector they already made, HERE, server-side:
// the sealed token never leaves this process (the same custody rule publishing keeps), and
// the desktop only ever sees the JSON we return.
//
// Cost note: these calls bill OUR X app (pay-per-use since Feb 2026, ~$0.005/post read), so
// `max` is clamped by the caller and every read is a deliberate agent tool call, never a poll.
export interface XSearchHit {
  id: string;
  text: string;
  createdAt: string | null;
  authorId: string | null;
  authorHandle: string | null;
  authorName: string | null;
  metrics: { replies: number; reposts: number; likes: number; quotes: number; impressions: number | null } | null;
  url: string;
}

/** Recent search (last 7 days) on a user-context token. Returns hits plus a re-sealed bundle
 * when the token had to refresh — the caller persists it, exactly like `xPoster` does. `persist`
 * additionally lands the rotation the MOMENT it happens, so a search that fails after a
 * successful refresh (a 429 mid-sweep) can no longer strand a spent refresh token in the store. */
export async function xSearchRecent(
  tokens: TokenBundle,
  query: string,
  max: number,
  fetchFn: typeof fetch = fetch,
  persist?: (t: TokenBundle) => Promise<void>,
): Promise<{ hits: XSearchHit[]; secretPatch?: TokenBundle }> {
  let t = tokens;
  let refreshed = false;
  if (t.expires_at && t.expires_at < Date.now() + 30_000) { t = await refreshTokens(t, fetchFn, persist); refreshed = true; }
  const url = () => {
    const u = new URL('https://api.x.com/2/tweets/search/recent');
    u.searchParams.set('query', query);
    // X's floor is 10; asking for less is a 400 rather than a smaller bill
    u.searchParams.set('max_results', String(Math.min(100, Math.max(10, max))));
    u.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id');
    u.searchParams.set('expansions', 'author_id');
    u.searchParams.set('user.fields', 'username,name');
    return u.toString();
  };
  const call = () => fetchFn(url(), { headers: { authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(20_000) });
  let res = await call();
  if (res.status === 401 && !refreshed) { t = await refreshTokens(t, fetchFn, persist); refreshed = true; res = await call(); }
  if (res.status === 429) throw new Error('X rate-limited this search — wait a minute and try again');
  if (res.status === 403) throw new Error('X refused this search for the connected account — its API access may not include search (check the plan on the X developer console)');
  if (!res.ok) throw new Error(`x search failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    data?: Array<{ id: string; text: string; created_at?: string; author_id?: string; public_metrics?: Record<string, number> }>;
    includes?: { users?: Array<{ id: string; username?: string; name?: string }> };
  };
  const users = new Map((body.includes?.users ?? []).map((u) => [u.id, u]));
  const hits: XSearchHit[] = (body.data ?? []).map((d) => {
    const u = d.author_id ? users.get(d.author_id) : undefined;
    const m = d.public_metrics;
    return {
      id: d.id,
      text: d.text,
      createdAt: d.created_at ?? null,
      authorId: d.author_id ?? null,
      authorHandle: u?.username ? `@${u.username}` : null,
      authorName: u?.name ?? null,
      // REAL numbers or none — a null here is what stops an agent inventing "high reach"
      metrics: m
        ? {
            replies: m['reply_count'] ?? 0, reposts: m['retweet_count'] ?? 0,
            likes: m['like_count'] ?? 0, quotes: m['quote_count'] ?? 0,
            impressions: typeof m['impression_count'] === 'number' ? m['impression_count'] : null,
          }
        : null,
      url: u?.username ? `https://x.com/${u.username}/status/${d.id}` : `https://x.com/i/web/status/${d.id}`,
    };
  });
  return { hits, ...(refreshed ? { secretPatch: t } : {}) };
}

/** The whole read, store-side: resolve the room's connector, search on it, persist any token
 * rotation the moment it happens, and turn a dead grant into a flipped connector plus a
 * RECONNECT_REQUIRED the caller can put in front of a human.
 *
 * A dead-grant verdict re-reads the stored secret before it condemns anything: two sweeps racing
 * the same single-use refresh token is normal (the loser's refresh 400s because the winner spent
 * it), and the loser must pick up the winner's rotation rather than declare the connection dead.
 * Only a 400 with NO newer secret behind it flips the row — and the flip keeps the sealed secret,
 * because unlike the human's disconnect there is no intent here, and a destructive delete would
 * make a misfired verdict unrecoverable.
 *
 * The human-disconnect case never reaches RECONNECT_REQUIRED: `connector.disconnect` deletes the
 * secret, so a revoked row without ciphertext reads as plain NOT_CONNECTED. */
export async function xSearchOnConnector(
  store: Store,
  workspace: string,
  channel: string | null,
  query: string,
  max: number,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; hits: XSearchHit[] } | { ok: false; code: 'NOT_CONNECTED' | 'RECONNECT_REQUIRED' | 'X_ERROR'; error: string }> {
  const conn = await store.connectorWithSecret(workspace, 'x', channel);
  if (!conn?.ciphertext) return { ok: false, code: 'NOT_CONNECTED', error: 'no X account is connected for this room' };
  const reconnect = {
    ok: false as const,
    code: 'RECONNECT_REQUIRED' as const,
    error: `X rejected the stored authorization for the connected account${conn.handle ? ` (${conn.handle})` : ''} — a human needs to reconnect X (Twitter) from Connections`,
  };
  if (conn.status !== 'connected') return reconnect;
  const persist = (b: TokenBundle) => store.setConnectorSecret(conn.id, seal(b));
  const run = async (ciphertext: string): Promise<{ ok: true; hits: XSearchHit[] }> => {
    const out = await xSearchRecent(unseal<TokenBundle>(ciphertext), query, max, fetchFn, persist);
    if (out.secretPatch) await store.setConnectorSecret(conn.id, seal(out.secretPatch));
    return { ok: true, hits: out.hits };
  };
  const xError = (e: unknown) => ({ ok: false as const, code: 'X_ERROR' as const, error: e instanceof Error ? e.message : 'x search failed' });
  try {
    return await run(conn.ciphertext);
  } catch (e) {
    if (!(e instanceof XReauthRequired)) return xError(e);
    const fresh = await store.connectorWithSecret(workspace, 'x', channel);
    if (fresh?.ciphertext && fresh.ciphertext !== conn.ciphertext) {
      try {
        return await run(fresh.ciphertext);
      } catch (e2) {
        if (!(e2 instanceof XReauthRequired)) return xError(e2);
        await store.markConnectorReauth(conn.id);
        return reconnect;
      }
    }
    await store.markConnectorReauth(conn.id);
    return reconnect;
  }
}
