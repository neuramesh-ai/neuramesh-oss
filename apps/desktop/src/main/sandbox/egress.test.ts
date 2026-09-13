// Containment L1: the egress proxy's decision logic — the metadata floor + policy allowlist.
// Run: pnpm exec tsx --test src/main/sandbox/egress.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultBaselineRules, mergePolicies, type PolicyRule } from '@neuramesh/shared';
import { egressAllowedByPolicy, isMetadataOrLinkLocal, parseConnectTarget } from './egress';

test('isMetadataOrLinkLocal blocks cloud metadata + link-local, not loopback or RFC1918', () => {
  // the SSRF credential-theft sinks — always blocked
  for (const ip of ['169.254.169.254', '169.254.0.1', '169.254.255.255', '100.100.100.200', '168.63.129.16',
    '::1', 'fe80::1', 'fc00::1', 'fd00:ec2::254', 'fd20:ce::254', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe']) {
    assert.equal(isMetadataOrLinkLocal(ip), true, `${ip} must be blocked`);
  }
  // legitimate destinations agents reach — never blocked here (allow-by-default; tighten via policy)
  for (const ip of ['8.8.8.8', '140.82.112.3', '127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.2', 'not.an.ip']) {
    assert.equal(isMetadataOrLinkLocal(ip), false, `${ip} must not be blocked`);
  }
});

test('parseConnectTarget handles host:port, bare host, IPv6, and rejects malformed', () => {
  assert.deepEqual(parseConnectTarget('api.anthropic.com:443'), { host: 'api.anthropic.com', port: 443 });
  assert.deepEqual(parseConnectTarget('example.com'), { host: 'example.com', port: 443 }); // CONNECT default
  assert.deepEqual(parseConnectTarget('registry.npmjs.org:80'), { host: 'registry.npmjs.org', port: 80 });
  assert.deepEqual(parseConnectTarget('[2606:4700::1]:443'), { host: '2606:4700::1', port: 443 });
  assert.equal(parseConnectTarget(''), null);
  assert.equal(parseConnectTarget('host:0'), null);
  assert.equal(parseConnectTarget('host:99999'), null);
  assert.equal(parseConnectTarget('host:abc'), null);
});

test('egressAllowedByPolicy: allow-by-default; a workspace that cuts off egress is enforced', () => {
  const base = defaultBaselineRules();
  // egress-allowed-by-default: any host passes the proxy layer
  assert.equal(egressAllowedByPolicy('github.com', base), true);
  assert.equal(egressAllowedByPolicy('anything.example.com', base), true);

  // workspace tightens net.egress to deny (mergePolicies replaces the {any} baseline) → proxy refuses all
  const cutOff = mergePolicies(base, [{ id: 'ws.egress-deny', scope: 'workspace', capability: 'net.egress', selector: { kind: 'any' }, verdict: 'deny' }]);
  assert.equal(egressAllowedByPolicy('github.com', cutOff), false);
  assert.equal(egressAllowedByPolicy('exfil.evil.com', cutOff), false);

  // a more-specific scope carves an allowed exception back out (task scope beats the workspace deny)
  const carve: PolicyRule[] = [...cutOff, { id: 'task.allow-gh', scope: 'task', capability: 'net.egress', selector: { kind: 'host', glob: 'github.com' }, verdict: 'allow' }];
  assert.equal(egressAllowedByPolicy('github.com', carve), true);
  assert.equal(egressAllowedByPolicy('exfil.evil.com', carve), false);

  // ask (an upstream tool-gate concern) still passes the proxy — the proxy is the deny + metadata floor
  const asked = mergePolicies(base, [{ id: 'ws.egress-ask', scope: 'workspace', capability: 'net.egress', selector: { kind: 'any' }, verdict: 'ask' }]);
  assert.equal(egressAllowedByPolicy('github.com', asked), true);
});
