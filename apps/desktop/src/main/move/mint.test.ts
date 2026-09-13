// The deterministic mint. Run from apps/desktop:
//   pnpm exec tsx --test src/main/move/mint.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOVE_NAMESPACE, mintFor, uuidV5 } from './mint';

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('uuidV5: RFC 4122 shape, version 5, variant 10xx', () => {
  assert.match(uuidV5('anything'), UUID_V5);
  // the RFC's own vector: v5 of "www.example.com" under the DNS namespace
  assert.equal(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
});

test('mintFor: the same importId and old id mint the same new id, every time, in any process', () => {
  const a = mintFor('0f0f0f0f-0000-4000-8000-000000000001');
  const b = mintFor('0f0f0f0f-0000-4000-8000-000000000001');
  assert.equal(a('11111111-0000-4000-8000-000000000007'), b('11111111-0000-4000-8000-000000000007'));
  assert.match(a('11111111-0000-4000-8000-000000000007'), UUID_V5);
  // pinned: a change here would make every retry plan NEW ids and double every row on the target
  assert.equal(a('11111111-0000-4000-8000-000000000007'), uuidV5('0f0f0f0f-0000-4000-8000-000000000001:11111111-0000-4000-8000-000000000007', MOVE_NAMESPACE));
});

test('mintFor: a different importId or a different old id mints a different new id', () => {
  const a = mintFor('0f0f0f0f-0000-4000-8000-000000000001');
  const b = mintFor('0f0f0f0f-0000-4000-8000-000000000002');
  assert.notEqual(a('x'), b('x'));
  assert.notEqual(a('x'), a('y'));
});
