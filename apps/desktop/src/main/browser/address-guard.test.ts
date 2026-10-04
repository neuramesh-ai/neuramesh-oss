// the address guard decides where the machine's browsers may go. every case below is an address a
// page or an agent could name to reach inside the cluster: the metadata server, a pod, the machine's
// own services. a guard that let one through would still load every public page perfectly, so each
// line here is a failure with no other symptom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, privateAddress, refusedHost, resolveAllowed, type Lookup } from './address-guard';

test('every private, local and link-local IPv4 range is refused, the metadata server first', () => {
  for (const ip of ['169.254.169.254', '169.254.0.1', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.1.1', '127.0.0.1', '127.8.8.8', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255', '198.18.0.1']) {
    assert.equal(privateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '192.169.0.1', '100.128.0.1', '151.101.1.69']) {
    assert.equal(privateAddress(ip), false, ip);
  }
});

test('IPv6 loopback, unique-local, link-local and every form that wraps a private IPv4 address are refused', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd20:ce::254', 'fe80::1', 'fec0::1', 'ff02::1', '::ffff:169.254.169.254', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::127.0.0.1', '64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::1', 'fe80::1%eth0']) {
    assert.equal(privateAddress(ip), true, ip);
  }
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) assert.equal(privateAddress(ip), false, ip);
});

test('the cluster and metadata names are refused before any lookup', () => {
  for (const host of ['localhost', 'app.localhost', 'metadata.google.internal', 'kubernetes.default.svc.cluster.local', 'relay.nm-system.svc.cluster.local', 'printer.local', 'metadata', 'LOCALHOST.', '[::1]']) {
    assert.ok(refusedHost(host), host);
  }
  assert.equal(refusedHost('x.com'), null);
  assert.equal(refusedHost('docs.neuramesh.app'), null);
});

test('only http and https open, with no user name or password, and the URL parser normalises numeric hosts', () => {
  for (const raw of ['file:///etc/passwd', 'chrome://settings', 'javascript:alert(1)', 'data:text/html,hi', 'view-source:https://x.com', 'ftp://a.com/x', 'ws://a.com', 'not a url']) {
    assert.equal(checkUrl(raw).ok, false, raw);
  }
  assert.equal(checkUrl('https://user:secret@x.com/').ok, false);
  // 2130706433 and 0x7f.1 are both 127.0.0.1 once the URL parser reads them
  assert.equal(checkUrl('http://2130706433/').ok, false);
  assert.equal(checkUrl('http://0x7f.1/').ok, false);
  assert.equal(checkUrl('http://[::ffff:a9fe:a9fe]/latest/meta-data').ok, false);
  assert.equal(checkUrl('https://x.com/home').ok, true);
});

test('a public name that resolves to a private address is refused, and one private answer refuses the whole name', async () => {
  const dns = (answers: Record<string, string[]>): Lookup => async (host) => {
    const list = answers[host];
    if (!list) throw new Error('ENOTFOUND');
    return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  const lookup = dns({ 'rebind.example': ['169.254.169.254'], 'mixed.example': ['93.184.216.34', '10.0.0.7'], 'site.example': ['93.184.216.34'], 'v6.example': ['fd00::1'] });
  assert.deepEqual(await resolveAllowed('site.example', lookup), { ok: true, address: '93.184.216.34', family: 4 });
  assert.equal((await resolveAllowed('rebind.example', lookup)).ok, false);
  assert.equal((await resolveAllowed('mixed.example', lookup)).ok, false);
  assert.equal((await resolveAllowed('v6.example', lookup)).ok, false);
  const missing = await resolveAllowed('nowhere.example', lookup);
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? '' : missing.reason, /does not resolve/);
  // a literal never reaches the resolver
  assert.deepEqual(await resolveAllowed('8.8.8.8', async () => { throw new Error('not called'); }), { ok: true, address: '8.8.8.8', family: 4 });
});
