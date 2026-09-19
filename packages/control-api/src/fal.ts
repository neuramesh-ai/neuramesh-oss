// fal.ai's queue, the three calls the video rung makes (docs.fal.ai queue reference, 2026-09-19):
// submit (202, a request id in under a second), status (IN_QUEUE · IN_PROGRESS · COMPLETED, an
// `error` on a completed failure), and the result (the model's output, a `video.url` for every
// video model). The key rides `Authorization: Key …` and never leaves this process. `fetchFn` is
// injectable so the lane's tests run against a fake queue.
export const FAL_QUEUE = 'https://queue.fal.run';
export type FalFetch = typeof fetch;

export interface FalSubmit { requestId?: string; error?: string; status?: number; unavailable?: boolean }
export interface FalStatus { state: 'queued' | 'running' | 'done' | 'failed'; error?: string; position?: number }
export interface FalResult { url?: string; contentType?: string; error?: string }

const headers = (key: string) => ({ authorization: `Key ${key}`, 'content-type': 'application/json' });

/** the request endpoints hang off the APP, not the sub-path: a submit to
 *  `bytedance/seedance-2.0/fast/text-to-video` is polled at `bytedance/seedance-2.0/requests/{id}`
 *  (the sub-path form answers 405, found live 2026-09-19; fal's own status_url says the same) */
export const queueBase = (endpoint: string): string => endpoint.split('/').slice(0, 2).join('/');

/** 404 or a "not found / unavailable" answer at submit: this key cannot reach that endpoint, the next tier's model may do */
const unavailable = (status: number, msg: string): boolean => status === 404 || (status === 422 && /not found|unavailable|deprecated|no longer/i.test(msg));

export async function falSubmit(key: string, endpoint: string, input: Record<string, unknown>, fetchFn: FalFetch = fetch, timeoutSeconds = 480): Promise<FalSubmit> {
  const res = await fetchFn(`${FAL_QUEUE}/${endpoint}`, { method: 'POST', headers: { ...headers(key), 'x-fal-request-timeout': String(timeoutSeconds) }, body: JSON.stringify(input) })
    .catch((e: unknown) => new Response(JSON.stringify({ detail: String(e) }), { status: 599 }));
  const body = (await res.json().catch(() => null)) as { request_id?: string; detail?: unknown; error?: string } | null;
  if (res.ok && body?.request_id) return { requestId: body.request_id, status: res.status };
  const msg = typeof body?.detail === 'string' ? body.detail : Array.isArray(body?.detail) ? JSON.stringify(body.detail) : body?.error ?? `fal ${res.status}`;
  return { error: msg, status: res.status, unavailable: unavailable(res.status, msg) };
}

export async function falStatus(key: string, endpoint: string, requestId: string, fetchFn: FalFetch = fetch): Promise<FalStatus> {
  const res = await fetchFn(`${FAL_QUEUE}/${queueBase(endpoint)}/requests/${requestId}/status`, { headers: headers(key) })
    .catch((e: unknown) => new Response(JSON.stringify({ detail: String(e) }), { status: 599 }));
  const body = (await res.json().catch(() => null)) as { status?: string; error?: string; error_type?: string; queue_position?: number; detail?: unknown } | null;
  if (!res.ok) return { state: 'failed', error: typeof body?.detail === 'string' ? body.detail : `fal status ${res.status}` };
  if (body?.error) return { state: 'failed', error: body.error };
  if (body?.status === 'COMPLETED') return { state: 'done' };
  if (body?.status === 'IN_PROGRESS') return { state: 'running' };
  return { state: 'queued', ...(typeof body?.queue_position === 'number' ? { position: body.queue_position } : {}) };
}

export async function falResult(key: string, endpoint: string, requestId: string, fetchFn: FalFetch = fetch): Promise<FalResult> {
  const res = await fetchFn(`${FAL_QUEUE}/${queueBase(endpoint)}/requests/${requestId}`, { headers: headers(key) })
    .catch((e: unknown) => new Response(JSON.stringify({ detail: String(e) }), { status: 599 }));
  const body = (await res.json().catch(() => null)) as { video?: { url?: string; content_type?: string }; detail?: unknown; error?: string } | null;
  if (!res.ok) return { error: typeof body?.detail === 'string' ? body.detail : body?.error ?? `fal result ${res.status}` };
  if (!body?.video?.url) return { error: 'the film came back without a video' };
  return { url: body.video.url, contentType: body.video.content_type };
}
