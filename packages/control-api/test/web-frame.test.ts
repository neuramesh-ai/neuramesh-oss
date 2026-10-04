// The browser pane's frame check (src/web-frame.ts). What must hold: X-Frame-Options DENY and
// SAMEORIGIN refuse, CSP frame-ancestors decides over X-Frame-Options when both are present, a
// source list that names our origin (exactly, by wildcard or by scheme) allows it, 'self' and
// 'none' never do, a private host is refused before any fetch, and an unreachable site lets the
// pane try rather than claim a refusal nobody sent.
import { describe, expect, it } from 'vitest';
import { checkFrame, frameVerdict } from '../src/web-frame';

const HQ = 'https://hq.neuramesh.app';
const h = (o: Record<string, string>) => new Headers(o);

describe('frameVerdict', () => {
  it('refuses on X-Frame-Options deny and sameorigin, in any case', () => {
    expect(frameVerdict(h({ 'x-frame-options': 'DENY' }), HQ)).toMatchObject({ frameable: false, reason: 'x-frame-options' });
    expect(frameVerdict(h({ 'x-frame-options': 'SameOrigin' }), HQ)).toMatchObject({ frameable: false, reason: 'x-frame-options' });
  });

  it('allows a page with no framing headers', () => {
    expect(frameVerdict(h({}), HQ)).toEqual({ frameable: true, corp: null });
  });

  it('lets frame-ancestors decide when it is present, even over a permissive or a strict X-Frame-Options', () => {
    expect(frameVerdict(h({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'", 'x-frame-options': 'ALLOWALL' }), HQ))
      .toMatchObject({ frameable: false, reason: 'frame-ancestors' });
    expect(frameVerdict(h({ 'content-security-policy': 'frame-ancestors *', 'x-frame-options': 'DENY' }), HQ)).toMatchObject({ frameable: true });
  });

  it('matches our origin exactly, by a wildcard host, by scheme, and refuses another port or host', () => {
    expect(frameVerdict(h({ 'content-security-policy': 'frame-ancestors https://hq.neuramesh.app' }), HQ).frameable).toBe(true);
    expect(frameVerdict(h({ 'content-security-policy': 'frame-ancestors *.neuramesh.app' }), HQ).frameable).toBe(true);
    expect(frameVerdict(h({ 'content-security-policy': 'frame-ancestors https:' }), HQ).frameable).toBe(true);
    expect(frameVerdict(h({ 'content-security-policy': 'frame-ancestors https://hq.neuramesh.app:8443' }), HQ).frameable).toBe(false);
    expect(frameVerdict(h({ 'content-security-policy': "frame-ancestors 'none'" }), HQ).frameable).toBe(false);
    expect(frameVerdict(h({ 'content-security-policy': 'frame-ancestors https://example.com' }), HQ).frameable).toBe(false);
  });

  it('reads frame-ancestors from a second policy header joined by a comma', () => {
    expect(frameVerdict(h({ 'content-security-policy': "script-src 'self', frame-ancestors 'none'" }), HQ).frameable).toBe(false);
  });

  it('reports Cross-Origin-Resource-Policy for browsers with no credentialless frames', () => {
    expect(frameVerdict(h({ 'cross-origin-resource-policy': 'Cross-Origin' }), HQ).corp).toBe('cross-origin');
  });
});

describe('checkFrame', () => {
  it('refuses a private host before a byte is fetched', async () => {
    let fetched = false;
    const f = (async () => { fetched = true; return new Response(''); }) as unknown as typeof fetch;
    expect(await checkFrame('http://10.0.0.5/admin', HQ, f)).toEqual({ frameable: false, reason: 'bad-url' });
    expect(await checkFrame('http://localhost:3000', HQ, f)).toEqual({ frameable: false, reason: 'bad-url' });
    expect(fetched).toBe(false);
  });

  it('reads the headers of the final redirect hop and caches the verdict per host', async () => {
    let calls = 0;
    const f = (async (u: string) => {
      calls++;
      if (u.startsWith('https://short.example/')) return new Response(null, { status: 301, headers: { location: 'https://site.example/home' } });
      return new Response('<html></html>', { headers: { 'x-frame-options': 'DENY' } });
    }) as unknown as typeof fetch;
    expect(await checkFrame('short.example/x', HQ, f, 1_000)).toMatchObject({ frameable: false, reason: 'x-frame-options' });
    expect(calls).toBe(2);
    await checkFrame('short.example/other', HQ, f, 2_000);
    expect(calls).toBe(2);
  });

  it('lets the pane try when the site cannot be reached', async () => {
    const f = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect(await checkFrame('https://down.example', HQ, f, 5_000)).toEqual({ frameable: true, reason: 'unreachable' });
  });
});
