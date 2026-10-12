// run from apps/desktop:  pnpm exec tsx --test src/renderer/src/wtabs/tab-owner.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabOwner } from './tab-owner';

test('a tab belongs to the session that asked for it, even when another session is in front', () => {
  assert.equal(tabOwner({}, 'thread:a', 'thread:b'), 'thread:a');
  assert.equal(tabOwner({}, undefined, 'thread:b'), 'thread:b', 'no captured owner: the session in front');
  assert.equal(tabOwner({ owner: null }, 'thread:a', 'thread:b'), null, 'a spec that names no owner keeps it');
  assert.equal(tabOwner({ owner: 'task:7' }, 'thread:a', 'thread:b'), 'task:7');
});
