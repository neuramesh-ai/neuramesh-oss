// THE X MEDIA UPLOAD: the draft's picture or film, pulled by URL and pushed to X in chunks. Split
// from connectors-x.ts at the size gate (the video rung, 2026-09-19) when a film joined the pictures.
// XReauthRequired lives here and the connector re-exports it: both modules throw it, and a value
// import from the connector back into this one would be a real cycle.
import { sniffImageMime, sniffVideoMime } from '@neuramesh/shared';

/** X's token endpoint saying the stored grant ITSELF is dead — the refresh token was revoked,
 * expired, or already spent (X's refresh tokens are single-use). Retrying can never fix it;
 * only a human re-running the Connect flow can. Callers catch this to flip the connector's
 * synced status and put a reconnect instruction in front of a human, instead of letting every
 * sweep fail with a bare `x token refresh failed 400` forever (the @joinflowe incident). */
export class XReauthRequired extends Error {}

const X_MEDIA_MAX = 5_000_000; // X's image ceiling
const X_VIDEO_MAX = 64_000_000; // a film (the video rung): X takes 512 MB, this function's memory does not; the hosted row caps at 8 MB anyway

/** Pull the draft's media so it can be uploaded. Works for our own hosted /media/<id> and for a
 *  URL a human pasted — X is the one network that wants BYTES rather than a link. */
export async function fetchMediaBytes(url: string, fetchFn: typeof fetch): Promise<{ bytes: Buffer; mime: string }> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`media url did not load (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new Error('media url returned no bytes');
  const ct = ((res.headers.get('content-type') ?? '').split(';')[0] ?? '').toLowerCase();
  // the BYTES outrank the header: our own /media route echoes the mime the generator DECLARED,
  // and a declared-vs-actual drift dies days later at X's finalize. Unrecognizable bytes REFUSE
  // to upload — mislabeled garbage burns an attempt and answers with X's vaguest error; the hex
  // head in the message is the remote diagnosis (what did the route actually serve?).
  const head = new Uint8Array(bytes.subarray(0, 16));
  const video = sniffVideoMime(head);
  if (video && bytes.length > X_VIDEO_MAX) throw new Error(`video too large for X (${bytes.length} bytes, max 64MB)`);
  if (video) return { bytes, mime: video };
  if (bytes.length > X_MEDIA_MAX) throw new Error(`image too large for X (${bytes.length} bytes, max 5MB)`);
  const sniffed = sniffImageMime(head);
  if (!sniffed) throw new Error(`the hosted media is not a recognizable image or video (served ${ct || 'no content-type'}, ${bytes.length} bytes, head ${bytes.subarray(0, 8).toString('hex')}) — regenerate the media on the card (Try again), then re-approve`);
  return { bytes, mime: sniffed };
}

/** Upload one image or film to X and return its media id.
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
export async function uploadXMedia(accessToken: string, bytes: Buffer, mime: string, fetchFn: typeof fetch): Promise<string> {
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
    body: JSON.stringify({ media_type: mime, total_bytes: bytes.length, media_category: mime.startsWith('video/') ? 'tweet_video' : 'tweet_image' }),
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
  // images normally finalize inline; a pending state gets a short, bounded courtesy poll. A film
  // always processes after finalize (pending → in_progress → succeeded, seconds for an 8 s clip), so
  // it gets the long leash: the publish pass runs every minute and this function may not
  const film = mime.startsWith('video/');
  for (let i = 0; i < (film ? 12 : 3); i += 1) {
    const p = fin.data?.processing_info;
    if (!p?.state || p.state === 'succeeded') return id;
    if (p.state === 'failed') throw new Error(`x media processing failed after upload (${sent})${p.error?.message ? `: ${p.error.message}` : ''}`);
    await new Promise((r) => setTimeout(r, Math.min(5, p.check_after_secs ?? 1) * 1000));
    fin = await guard(await fetchFn(`${U}?command=STATUS&media_id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${accessToken}` } }), 'status');
  }
  const last = fin.data?.processing_info?.state;
  if (last && last !== 'succeeded') throw new Error(`x is still processing the ${film ? 'video' : 'image'} (${last}) — publish again in a minute`);
  return id;
}
