// The browser-called routes, and the header that decides whether the browser may look.
//
// `/invites/:token` shipped without a CORS mount. It worked perfectly from curl and failed
// from every real invitee: the /join fetch was rejected by the browser before the page saw a
// status, so it fell into its catch and rendered "This invitation has expired" over a live,
// minutes-old invitation. A missing allow-origin header is not a closed door — it is an
// invisible one, and the client's error copy gets to invent the reason.
//
// So: every route the marketing site fetches is asserted here, on the SAME predicate.
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const app = createApp(new MemoryStore());
const get = (path: string, origin: string) => app.request(path, { headers: { origin } });

describe('CORS on the browser-called routes', () => {
  it('/invites/:token answers the web origins — the header rides even the 404', async () => {
    for (const origin of ['https://neuramesh.app', 'https://www.neuramesh.app', 'http://localhost:5173']) {
      const res = await get('/invites/whatever-token', origin);
      // 404 here (MemoryStore has no such invite) is exactly the case that matters: an
      // unknown token must still come back readable, or the page can't tell "expired"
      // (404) from "couldn't ask" (blocked) — and it will guess wrong.
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    }
  });

  it('a foreign origin gets no allow-origin header', async () => {
    const res = await get('/invites/whatever-token', 'https://evil.example');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('the preflight is answered for GET', async () => {
    const res = await app.request('/invites/whatever-token', {
      method: 'OPTIONS',
      headers: { origin: 'https://neuramesh.app', 'access-control-request-method': 'GET' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://neuramesh.app');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('the desktop handoff keeps its headers (both mounts share one predicate now)', async () => {
    const res = await app.request('/auth/desktop/complete', {
      method: 'OPTIONS',
      headers: { origin: 'https://neuramesh.app', 'access-control-request-method': 'POST' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://neuramesh.app');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('CORS on the routes /pro and /announce fetch from the site (2026-09-18)', () => {
  // the exact preflight a browser sends for a JSON POST with a bearer: it must come back 2xx
  // with the origin, or the page sees "Failed to fetch" and its catch invents the reason
  const preflight = (path: string, method = 'POST') => app.request(path, {
    method: 'OPTIONS',
    headers: { origin: 'https://www.neuramesh.app', 'access-control-request-method': method, 'access-control-request-headers': 'authorization,content-type' },
  });
  it('/auth/clerk, /v1/workspaces, /v1/billing/checkout and /v1/announce/:id/claim answer the preflight', async () => {
    for (const [path, method] of [['/auth/clerk', 'POST'], ['/v1/workspaces', 'GET'], ['/v1/billing/checkout', 'POST'], ['/v1/announce/some-id/claim', 'POST']] as const) {
      const res = await preflight(path, method);
      expect(res.status, path).toBe(204);
      expect(res.headers.get('access-control-allow-origin'), path).toBe('https://www.neuramesh.app');
      expect(res.headers.get('access-control-allow-headers')?.toLowerCase(), path).toContain('authorization');
    }
  });
  it('the guarded routes still refuse a real call without a bearer, readably', async () => {
    const res = await app.request('/v1/workspaces', { headers: { origin: 'https://www.neuramesh.app' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.neuramesh.app');
  });
  it('a foreign origin gets nothing on them either', async () => {
    const res = await app.request('/auth/clerk', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
