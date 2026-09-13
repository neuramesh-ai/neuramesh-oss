import { describe, expect, it, vi } from 'vitest';
import { buildPayload, createAnalytics, defaultSend, makeDistinctId, shouldComplete } from './analytics';

// The beacon is fire-and-forget BY DESIGN — a bug here fails silently in production and
// quietly guts the launch readout. These tests cover every branch of the pure core.

const fakeStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('makeDistinctId', () => {
  it('mints once and stays stable across calls with a working store', () => {
    const store = fakeStore();
    const rand = vi.fn(() => 'id-1');
    expect(makeDistinctId(store, rand)).toBe('id-1');
    expect(makeDistinctId(store, () => 'id-2')).toBe('id-1'); // second call reads, never re-mints
    expect(rand).toHaveBeenCalledTimes(1);
  });
  it('falls back to a per-load id when storage throws (private-mode Safari)', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(makeDistinctId(throwing, () => 'fallback')).toBe('fallback');
  });
  it('falls back to a per-load id when storage is unavailable', () => {
    expect(makeDistinctId(null, () => 'fallback')).toBe('fallback');
  });
  it('falls back to a per-load id when the store reads but cannot write (quota exceeded)', () => {
    const readOnlyStore = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => makeDistinctId(readOnlyStore, () => 'fallback')).not.toThrow();
    expect(makeDistinctId(readOnlyStore, () => 'fallback')).toBe('fallback');
  });
});

describe('vercel.json analytics ingest rewrite (config side of the wire contract)', () => {
  // '/i/capture/' contains no dot, so it MATCHES the SPA catch-all — if the ingest rule is
  // reordered below it or dropped, every beacon 200s into index.html and the funnel silently
  // records nothing. The source is deliberately the ONE path the beacon uses (never a
  // wildcard): proxying the whole PostHog surface would hand third parties an
  // ad-block-evading relay on this domain. Pin config, code, and scope together.
  it('proxies exactly the beacon path to PostHog ingest, AHEAD of the SPA catch-all', async () => {
    const vercel = (await import('../vercel.json')) as { default: { rewrites: Array<{ source: string; destination: string }> } };
    const rules = vercel.default.rewrites;
    const ingest = rules.findIndex((r) => r.source === '/i/capture/');
    const catchAll = rules.findIndex((r) => r.destination === '/index.html');
    expect(ingest).toBeGreaterThanOrEqual(0);
    expect(rules[ingest]!.destination).toBe('https://us.i.posthog.com/capture/');
    expect(rules.some((r) => r.source.startsWith('/i/') && r.source.includes('(.*)'))).toBe(false); // no wildcard relay
    expect(catchAll).toBeGreaterThan(ingest);
  });
});

describe('buildPayload', () => {
  it('matches the PostHog /capture/ data contract', () => {
    const body = JSON.parse(buildPayload('phc_x', 'download_click', 'v-1', { platform: 'apple-silicon' }));
    expect(body).toMatchObject({ api_key: 'phc_x', event: 'download_click', distinct_id: 'v-1', properties: { platform: 'apple-silicon' } });
    expect(body.timestamp).toBeUndefined(); // server stamps arrival — client clocks skew
  });
  it('serializes prop-less events with an empty properties object', () => {
    expect(JSON.parse(buildPayload('phc_x', 'page_view', 'v-1')).properties).toEqual({});
  });
});

describe('shouldComplete (demo_complete = ended or ≥90% watched)', () => {
  it('fires at and past the 90% threshold, not before', () => {
    expect(shouldComplete(53.9, 60)).toBe(false);
    expect(shouldComplete(54, 60)).toBe(true);
    expect(shouldComplete(60, 60)).toBe(true);
  });
  it('never fires while duration is unknown (0 or NaN during metadata load)', () => {
    expect(shouldComplete(10, 0)).toBe(false);
    expect(shouldComplete(10, Number.NaN)).toBe(false);
  });
});

describe('createAnalytics', () => {
  it('hard no-ops without a key — send is never called', () => {
    const send = vi.fn();
    createAnalytics({ key: '', send, id: 'v-1' }).track('page_view');
    expect(send).not.toHaveBeenCalled();
  });
  it('posts to the first-party ingest path with the payload body', () => {
    const send = vi.fn();
    createAnalytics({ key: 'phc_x', send, id: 'v-1' }).track('page_view', { screen: 'landing' });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, body] = send.mock.calls[0]!;
    expect(url).toBe('/i/capture/');
    expect(JSON.parse(body).properties.screen).toBe('landing');
  });
  it('never throws when send throws synchronously (blocked fetch)', () => {
    const a = createAnalytics({ key: 'phc_x', send: () => { throw new Error('blocked'); }, id: 'v-1' });
    expect(() => a.track('page_view')).not.toThrow();
  });
  it('trackOnce dedupes per event name within the pageview', () => {
    const send = vi.fn();
    const a = createAnalytics({ key: 'phc_x', send, id: 'v-1' });
    a.trackOnce('demo_play');
    a.trackOnce('demo_play');
    a.trackOnce('pricing_view');
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('defaultSend (the wire contract)', () => {
  it('POSTs cookie-free and referrer-free with keepalive — signed-in Clerk cookies must never reach the analytics ingest', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal('fetch', fetchMock);
    defaultSend('/i/capture/', '{"event":"page_view"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/i/capture/');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe('POST');
    vi.unstubAllGlobals();
  });
  it('swallows fetch rejections — a blocked beacon never surfaces an error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('blocked'))));
    expect(() => defaultSend('/i/capture/', '{}')).not.toThrow();
    await Promise.resolve();
    vi.unstubAllGlobals();
  });
});
