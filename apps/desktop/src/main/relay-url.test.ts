// Which relay the desktop client dials (main/relay-url.ts): NM_RELAY_URL wins; under Clerk auth the
// production relay is the default; on a dev or supabase stack unset means NO relay, said plainly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRelayShards, shardUrlFor } from '@neuramesh/relay';
import { PROD_RELAY_URL, relayUrlFor } from '../main/relay-url';

test('NM_RELAY_URL wins on every stack', () => {
  assert.equal(relayUrlFor({ NM_RELAY_URL: 'ws://127.0.0.1:8791' }, 'dev'), 'ws://127.0.0.1:8791');
  assert.equal(relayUrlFor({ NM_RELAY_URL: 'wss://relay.example.test' }, 'clerk'), 'wss://relay.example.test');
});

test('under Clerk auth the production relay is the default', () => {
  assert.equal(relayUrlFor({}, 'clerk'), PROD_RELAY_URL);
  assert.equal(relayUrlFor({ NM_RELAY_URL: '   ' }, 'clerk'), PROD_RELAY_URL, 'blank is unset');
});

test('a dev or supabase stack with no relay says so — unset is the honest answer (docs/42)', () => {
  assert.equal(relayUrlFor({}, 'dev'), '');
  assert.equal(relayUrlFor({}, 'supabase'), '');
});

test('the relay shards: a list passes through whole, and production is one shard (N=1)', () => {
  // the client picks each machine's shard from the list (@neuramesh/relay-client), so the setting is not cut here
  assert.equal(relayUrlFor({ NM_RELAY_URL: 'wss://r0.test,wss://r1.test' }, 'clerk'), 'wss://r0.test,wss://r1.test');
  assert.deepEqual(parseRelayShards(PROD_RELAY_URL), [PROD_RELAY_URL]);
  for (const id of ['m-e2e', 'a', '0f0f0f0f-0000-4000-8000-000000000001']) assert.equal(shardUrlFor(PROD_RELAY_URL, id), PROD_RELAY_URL);
});
