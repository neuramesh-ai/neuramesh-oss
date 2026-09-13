import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlApiClient, ControlApiError, isUnrecoverableUploadError, failure } from '../src/api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function client(token: string | null = 'tok') {
  return new ControlApiClient({ baseUrl: 'https://api.test', getToken: async () => token });
}

// The first (url, init) fetch was called with — throws if fetch wasn't called.
function firstCall(mock: { mock: { calls: unknown[] } }): [string, RequestInit] {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('fetch was not called');
  return call as [string, RequestInit];
}

afterEach(() => vi.restoreAllMocks());

describe('ControlApiClient', () => {
  it('attaches the Bearer token and posts a command to /v1/commands', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ task: { id: 't1' }, events: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().command({ type: 'task.accept', taskId: 't1' });
    expect(out).toEqual({ task: { id: 't1' }, events: [] });

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe('https://api.test/v1/commands');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ type: 'task.accept', taskId: 't1' });
  });

  it('throws a ControlApiError carrying the server envelope on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'illegal transition', code: 'ILLEGAL_TRANSITION' }, 409)));
    await expect(client().command({ type: 'task.accept', taskId: 't1' })).rejects.toMatchObject({
      message: 'illegal transition',
      status: 409,
      code: 'ILLEGAL_TRANSITION',
    });
    await expect(client().command({ type: 'task.approve', taskId: 't1' })).rejects.toBeInstanceOf(ControlApiError);
  });

  it('posts a message to /v1/messages', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: { id: 'm1' }, event: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await client().postMessage({ workspace: 'ws', channel: 'dev', body: 'hi' });
    expect(firstCall(fetchMock)[0]).toBe('https://api.test/v1/messages');
  });

  it('omits Authorization when signed out', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ task: {}, events: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await client(null).command({ type: 'task.accept', taskId: 't1' });
    const [, init] = firstCall(fetchMock);
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('sends the handoff endpoints without a Bearer token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ nonce: 'n', pollSecret: 's', expiresIn: 300 }));
    vi.stubGlobal('fetch', fetchMock);
    await client().startDesktopAuth();
    const [url, init] = firstCall(fetchMock);
    expect(url).toBe('https://api.test/auth/desktop/start');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe('isUnrecoverableUploadError — the upload-queue poison guard', () => {
  it('definitive 4xx = drop the op (it can never succeed on retry)', () => {
    for (const status of [400, 403, 404, 409, 422]) {
      expect(isUnrecoverableUploadError(new ControlApiError('nope', status))).toBe(true);
    }
  });

  it('transient 4xx, 5xx, and network errors = keep retrying', () => {
    for (const status of [401, 408, 425, 429, 500, 502, 503]) {
      expect(isUnrecoverableUploadError(new ControlApiError('later', status))).toBe(false);
    }
    expect(isUnrecoverableUploadError(new TypeError('Network request failed'))).toBe(false);
    expect(isUnrecoverableUploadError(undefined)).toBe(false);
  });
});

// A failure that discards the server's own words is the CORS lesson again: the catch invents a
// reason and the cause becomes unreachable from the report (George's 403, 2026-09-06).
describe('failure', () => {
  it('uses our envelope when the body is our JSON', () => {
    const e = failure('/v1/commands', 403, '{"error":"only the owner deletes a workspace","code":"NOT_PERMITTED"}');
    expect(e.message).toBe('only the owner deletes a workspace');
    expect(e.status).toBe(403);
    expect(e.code).toBe('NOT_PERMITTED');
  });
  it('repeats a non-JSON body rather than hiding it', () => {
    const e = failure('/v1/messages', 403, 'forbidden');
    expect(e.message).toBe('/v1/messages failed (403): forbidden');
  });
  it('flattens an HTML page to one readable line', () => {
    const e = failure('/v1/messages', 403, '<html><body>\n  Attention Required\n</body></html>');
    expect(e.message).toBe('/v1/messages failed (403): Attention Required');
  });
  it('still says something when the body is empty', () => {
    expect(failure('/v1/messages', 502, '').message).toBe('/v1/messages failed (502)');
  });
});

// A cached bearer goes stale on its own schedule, and a 401 is the first thing that says so. One
// retry with a fresh token is the difference between a token that rotates and a screen that fails.
describe('the 401 retry', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const unauth = () => new Response(JSON.stringify({ error: 'token expired', code: 'AUTH_FAILED' }), { status: 401 });

  it('asks for a fresh token once and succeeds on the second try', async () => {
    const seen: Array<string | undefined> = [];
    const fetchSpy = vi.fn(async (_u: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>)['authorization'];
      seen.push(auth);
      return auth === 'Bearer fresh' ? ok({ workspaces: [] }) : unauth();
    });
    vi.stubGlobal('fetch', fetchSpy);
    let minted = 0;
    const api = new ControlApiClient({ baseUrl: 'https://x', getToken: (force) => { if (force) minted += 1; return force ? 'fresh' : 'stale'; } });
    await expect(api.workspaces()).resolves.toEqual({ workspaces: [] });
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(minted).toBe(1);
  });

  it('gives up after the one retry rather than looping', async () => {
    const fetchSpy = vi.fn(async () => unauth());
    vi.stubGlobal('fetch', fetchSpy);
    const api = new ControlApiClient({ baseUrl: 'https://x', getToken: () => 'stale' });
    await expect(api.workspaces()).rejects.toThrow('token expired');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry a status that a new token cannot fix', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 403 }));
    vi.stubGlobal('fetch', fetchSpy);
    const api = new ControlApiClient({ baseUrl: 'https://x', getToken: () => 'stale' });
    await expect(api.workspaces()).rejects.toThrow('nope');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the host has no way to mint', async () => {
    const fetchSpy = vi.fn(async () => unauth());
    vi.stubGlobal('fetch', fetchSpy);
    await expect(new ControlApiClient({ baseUrl: 'https://x' }).workspaces()).rejects.toThrow('token expired');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
