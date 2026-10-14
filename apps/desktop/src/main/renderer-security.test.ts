import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The packaged file renderer must reach the same hosted relay that the Vite renderer can reach.
const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1]!;
const directives = new Map(policy.split(';').map((part) => {
  const [key, ...sources] = part.trim().split(/\s+/);
  return [key, sources];
}));

test('packaged renderer permits hosted relay connections and confines cleartext to loopback', () => {
  const connect = directives.get('connect-src') ?? [];
  assert.ok(connect.includes('https:') && connect.includes('wss:'), 'cloud API and relay must be reachable');
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    for (const protocol of ['http', 'ws']) assert.ok(connect.includes(`${protocol}://${host}:*`));
  }
  assert.ok(!connect.includes('*') && !connect.includes('http:') && !connect.includes('ws:'));
  assert.deepEqual(directives.get('default-src'), ["'self'"], 'network access must not relax executable resource origins');
  assert.ok(!policy.includes("'unsafe-eval'"));
});
