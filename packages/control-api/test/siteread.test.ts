// The brand read behind the public door (src/siteread.ts). What must hold: the guards refuse
// every private host before a byte is fetched (and again on every redirect hop), the caps bound
// what a stranger's page can make the server read, and the parse lands the palette, the fonts,
// the title, the description, the logo and the voice from a real-shaped page.
import { describe, expect, it } from 'vitest';
import { HTML_CAP, normalizeSiteUrl, readSite, SiteReadError, tallyFonts, tallyPalette, voiceOf } from '../src/siteread';

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title> Acme &amp; Co  </title>
  <meta name="description" content="Acme builds tools for small teams.">
  <meta property="og:description" content="The og one, read second">
  <meta property="og:image" content="/brand/og.png">
  <link rel="icon" href="/favicon.ico">
  <link rel="stylesheet" href="/site.css">
  <link rel="stylesheet" href="https://cdn.example.net/theme.css">
  <link rel="stylesheet" href="http://insecure.example.org/late.css">
  <link rel="stylesheet" href="/fourth.css">
  <link rel="stylesheet" href="/fifth.css">
  <style>.hero { color: #834a2b; font-family: "NeuraMesh Sans", system-ui, sans-serif; }</style>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/pricing">Pricing</a></nav>
  <header><h1>Ship the thing, <em>together</em></h1></header>
  <main>
    <p>Acme is the workbench for teams that ship every day.</p>
    <script>window.__x = "not copy";</script>
    <p>Your work&nbsp;stays yours.</p>
  </main>
  <footer>Copyright Acme. All rights reserved.</footer>
</body>
</html>`;

const SITE_CSS = `
:root { --accent: #834a2b; --ground: #1a1a2e; --paper: #f0e7dc; }
body { background: #1a1a2e; color: #fff; font-family: 'NeuraMesh Sans', system-ui, sans-serif; }
h1 { color: #834a2b; font-family: "NeuraMesh Sans", sans-serif; }
a { color: #834a2b; }
code { font-family: "Geist Mono", ui-monospace, monospace; color: #0af; }
.muted { color: #333; border-color: #eee; background: #000; }
.paper { background: #f0e7dc; }`;

const THEME_CSS = `
.btn { background: #834a2b; color: #FFFFFF; font-family: var(--font-body), sans-serif; }
.card { border: 1px solid #1a1a2e; font-family: serif; }
pre { font-family: "Geist Mono", monospace; }`;

const html = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, ...init, headers: { 'content-type': 'text/html; charset=utf-8', ...(init.headers ?? {}) } });
const css = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/css' } });

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fn = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    return routes[url]?.() ?? new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
  }) as typeof fetch;
  return { fn, calls };
}

const ACME = {
  'https://acme.example/': () => html(PAGE),
  'https://acme.example/site.css': () => css(SITE_CSS),
  'https://cdn.example.net/theme.css': () => css(THEME_CSS),
  'https://acme.example/fourth.css': () => css('.x { color: #123456 }'),
  'https://acme.example/fifth.css': () => css('.y { color: #654321 }'),
};

describe('readSite on a real-shaped page', () => {
  it('lands the title, the description, the logo, the palette, the fonts and the voice', async () => {
    const { fn, calls } = fakeFetch(ACME);
    const read = await readSite('acme.example', { fetchFn: fn });
    expect(read.url).toBe('https://acme.example/');
    expect(read.title).toBe('Acme & Co');
    expect(read.description).toBe('Acme builds tools for small teams.');
    expect(read.logo).toBe('https://acme.example/brand/og.png');
    // by frequency (5, 3, 2), then the two singletons alphabetically; every grey dropped
    expect(read.palette).toEqual(['#834a2b', '#1a1a2e', '#f0e7dc', '#00aaff', '#123456']);
    // the first named family of each stack: NeuraMesh Sans 3, Geist Mono 2; generics and var() never count
    expect(read.fonts).toEqual(['NeuraMesh Sans', 'Geist Mono']);
    // three sheets at most; the cross-origin http one and the fifth are never fetched
    expect(read.cssUrls).toEqual(['https://acme.example/site.css', 'https://cdn.example.net/theme.css', 'https://acme.example/fourth.css']);
    expect(calls).not.toContain('http://insecure.example.org/late.css');
    expect(calls).not.toContain('https://acme.example/fifth.css');
    expect(read.voice.startsWith('Ship the thing, together\n')).toBe(true);
    expect(read.voice).toContain('Acme is the workbench for teams that ship every day.');
    expect(read.voice).toContain('Your work stays yours.');
    for (const gone of ['Pricing', 'All rights reserved', 'not copy', 'Acme & Co']) expect(read.voice).not.toContain(gone);
  });

  it('falls back to the icon and og:description when the primary sources are missing', async () => {
    const page = '<html><head><meta property="og:description" content="Only og"><link rel="shortcut icon" href="fav.png"></head><body><p>hi</p></body></html>';
    const { fn } = fakeFetch({ 'https://acme.example/': () => html(page) });
    const read = await readSite('https://acme.example', { fetchFn: fn });
    expect(read.title).toBeNull();
    expect(read.description).toBe('Only og');
    expect(read.logo).toBe('https://acme.example/fav.png');
    expect(read.cssUrls).toEqual([]);
    expect(read.palette).toEqual([]);
  });

  it('reports the final url after a public redirect and resolves the logo against it', async () => {
    const { fn } = fakeFetch({
      'https://acme.example/': () => new Response(null, { status: 301, headers: { location: 'https://www.acme.example/' } }),
      'https://www.acme.example/': () => html(PAGE),
      'https://www.acme.example/site.css': () => css(SITE_CSS),
    });
    const read = await readSite('acme.example', { fetchFn: fn });
    expect(read.url).toBe('https://www.acme.example/');
    expect(read.logo).toBe('https://www.acme.example/brand/og.png');
    expect(read.cssUrls).toEqual(['https://www.acme.example/site.css']);
  });
});

describe('the guards', () => {
  it.each(['127.0.0.1', 'http://10.0.0.1/', 'localhost', 'http://169.254.1.1/latest/meta-data', 'http://[::1]/', 'metadata', 'app.internal'])(
    'refuses %s before any fetch',
    async (input) => {
      const { fn, calls } = fakeFetch(ACME);
      await expect(readSite(input, { fetchFn: fn })).rejects.toMatchObject({ code: 'PRIVATE_HOST' });
      expect(calls).toEqual([]);
    },
  );

  it('refuses a scheme that is not http(s) and a login in the address', () => {
    expect(() => normalizeSiteUrl('ftp://acme.example/')).toThrow(SiteReadError);
    expect(() => normalizeSiteUrl('https://user:pw@acme.example/')).toThrow(SiteReadError);
    expect(normalizeSiteUrl('Acme.example/path#frag').toString()).toBe('https://acme.example/path');
  });

  it('re-checks every redirect hop', async () => {
    const { fn, calls } = fakeFetch({ 'https://acme.example/': () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }) });
    await expect(readSite('acme.example', { fetchFn: fn })).rejects.toMatchObject({ code: 'PRIVATE_HOST' });
    expect(calls).toEqual(['https://acme.example/']);
  });

  it('refuses a response that is not a page', async () => {
    const { fn } = fakeFetch({ 'https://acme.example/': () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }) });
    await expect(readSite('acme.example', { fetchFn: fn })).rejects.toMatchObject({ code: 'NOT_HTML' });
    const missing = fakeFetch({});
    await expect(readSite('acme.example', { fetchFn: missing.fn })).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });

  it('caps the HTML at one megabyte and the voice at 1500 characters', async () => {
    const page = `<!doctype html><html><head><title>Big</title><style>.a{color:#4466aa}</style></head><body><p>${'x'.repeat(HTML_CAP)}</p><style>.b{color:#aa4466}</style></body></html>`;
    const { fn } = fakeFetch({ 'https://acme.example/': () => html(page) });
    const read = await readSite('acme.example', { fetchFn: fn });
    expect(read.palette).toEqual(['#4466aa']);
    expect(read.voice.length).toBeLessThanOrEqual(1500);
  });

  it('skips a stylesheet that fails and keeps the rest', async () => {
    const { fn } = fakeFetch({ ...ACME, 'https://acme.example/site.css': () => new Response('gone', { status: 500 }) });
    const read = await readSite('acme.example', { fetchFn: fn });
    expect(read.cssUrls).toEqual(['https://cdn.example.net/theme.css', 'https://acme.example/fourth.css']);
  });
});

describe('the pure tallies', () => {
  it('normalizes short hex, drops greys and keeps eight', () => {
    const css = Array.from({ length: 12 }, (_, i) => `.c${i}{color:#${(i + 1).toString(16).padStart(2, '0')}4488}`).join('') + '.s{color:#abc;background:#ABC;border-color:#fff}';
    const palette = tallyPalette(css);
    expect(palette).toHaveLength(8);
    expect(palette[0]).toBe('#aabbcc');
    expect(palette).not.toContain('#ffffff');
  });

  it('keeps four families and strips quotes and generics', () => {
    const css = ['Inter', '"Inter"', "'Inter'", 'Lora, serif', 'Lora', 'Fira Code, monospace', 'Manrope', 'Zed Mono', 'sans-serif', 'var(--x), serif']
      .map((f) => `.x{font-family:${f}}`).join('');
    expect(tallyFonts(css)).toEqual(['Inter', 'Lora', 'Fira Code', 'Manrope']);
  });

  it('reads the voice headline first without the chrome', () => {
    expect(voiceOf('<html><head><title>T</title></head><body><nav>menu</nav><h1>Hello <b>there</b></h1><p>Body &amp; soul.</p><footer>foot</footer></body></html>')).toBe('Hello there\nBody & soul.');
  });
});
