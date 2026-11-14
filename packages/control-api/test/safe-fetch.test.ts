// R10 NM-089: a server fetch on someone else's URL refuses private addresses on every hop (a redirect
// or a DNS name into the VPC was followed before), and stops reading past its byte cap.
import { describe, expect, it } from 'vitest';
import { assertPublicHost, publicAddress, SafeFetchError, safeFetch } from '../src/safe-fetch';

const code = async (p: Promise<unknown>): Promise<string> => p.then(() => 'OK', (e: unknown) => (e instanceof SafeFetchError ? e.code : String(e)));
const answers = (map: Record<string, () => Response>): typeof fetch => (async (u: string | URL) => {
  const hit = map[String(u)];
  if (!hit) throw new Error(`unexpected fetch ${String(u)}`);
  return hit();
}) as typeof fetch;
const publicDns = async () => ['93.184.216.34'];

describe('publicAddress', () => {
  it('refuses loopback, private, link-local, CGNAT, ULA and mapped private addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '224.0.0.1']) expect(publicAddress(ip), ip).toBe(false);
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) expect(publicAddress(ip), ip).toBe(true);
  });
  it('an IPv4 address inside an IPv6 one is judged as the IPv4 address, in each spelling', () => {
    // `new URL('https://[::ffff:169.254.169.254]/').hostname` is [::ffff:a9fe:a9fe]: the spelling a fetch sees
    expect(new URL('https://[::ffff:169.254.169.254]/').hostname).toBe('[::ffff:a9fe:a9fe]');
    for (const ip of ['::ffff:a9fe:a9fe', '::ffff:169.254.169.254', '::ffff:0:a9fe:a9fe', '::a9fe:a9fe', '0:0:0:0:0:ffff:a00:1', '::ffff:7f00:1', '::ffff:c0a8:101']) expect(publicAddress(ip), ip).toBe(false);
    for (const ip of ['::ffff:5db8:d822', '::ffff:93.184.216.34', '2606:4700:4700::1111']) expect(publicAddress(ip), ip).toBe(true);
    for (const ip of ['::ffff:zzzz:1', '1::2::3', '']) expect(publicAddress(ip), ip).toBe(false);
  });
  it('a name that resolves to a private address is refused', async () => {
    expect(await code(assertPublicHost('sneaky.example', async () => ['93.184.216.34', '10.0.0.5']))).toBe('PRIVATE_ADDRESS');
    expect(await code(assertPublicHost('ok.example', publicDns))).toBe('OK');
  });
});

describe('safeFetch', () => {
  it('a public host that redirects to the metadata server is refused at the hop', async () => {
    const fetchFn = answers({ 'https://cdn.example/pic.png': () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/computeMetadata/v1/' } }) });
    expect(await code(safeFetch('https://cdn.example/pic.png', { fetchFn, lookup: publicDns, maxBytes: 1000, allowHttp: true }))).toBe('PRIVATE_ADDRESS');
  });
  it('a redirect to a name that resolves privately is refused too', async () => {
    const fetchFn = answers({ 'https://cdn.example/pic.png': () => new Response(null, { status: 301, headers: { location: 'https://internal.example/x' } }) });
    const lookup = async (h: string) => (h === 'internal.example' ? ['10.0.0.9'] : ['93.184.216.34']);
    expect(await code(safeFetch('https://cdn.example/pic.png', { fetchFn, lookup, maxBytes: 1000 }))).toBe('PRIVATE_ADDRESS');
  });
  it('http is refused unless allowed, and a literal private address is refused even with no DNS', async () => {
    expect(await code(safeFetch('http://cdn.example/x', { fetchFn: answers({}), lookup: null, maxBytes: 10 }))).toBe('BAD_URL');
    expect(await code(safeFetch('https://10.0.0.1/x', { fetchFn: answers({}), lookup: null, maxBytes: 10 }))).toBe('PRIVATE_ADDRESS');
  });
  it('stops reading past the cap, whatever the header claims', async () => {
    const fetchFn = answers({ 'https://cdn.example/big': () => new Response(new Uint8Array(5000), { status: 200 }) });
    expect(await code(safeFetch('https://cdn.example/big', { fetchFn, lookup: publicDns, maxBytes: 1000 }))).toBe('TOO_LARGE');
  });
  it('follows a public redirect and returns the bytes', async () => {
    const fetchFn = answers({
      'https://cdn.example/a': () => new Response(null, { status: 302, headers: { location: '/b' } }),
      'https://cdn.example/b': () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }),
    });
    const got = await safeFetch('https://cdn.example/a', { fetchFn, lookup: publicDns, maxBytes: 1000 });
    expect([...got.bytes]).toEqual([1, 2, 3]);
    expect(got.url).toBe('https://cdn.example/b');
  });
});
