// The update card's visibility rules — the same two functions the shell and the sign-in screen
// read, so a signed-out user sees exactly what a signed-in one would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateKey, updateVisible } from '../renderer/src/shell/updatecard-state';

test('idle never shows, whatever was dismissed', () => {
  assert.equal(updateVisible({ phase: 'idle' }, null), false);
  assert.equal(updateVisible({ phase: 'idle' }, 'available:0.122.1'), false);
});

test('an available update shows until its own key is dismissed', () => {
  const s = { phase: 'available' as const, version: '0.122.1', notes: null };
  assert.equal(updateVisible(s, null), true);
  assert.equal(updateVisible(s, updateKey(s)), false);
  assert.equal(updateKey(s), 'available:0.122.1');
});

test('the same version reaching ready shows again after an earlier dismissal', () => {
  const dismissed = updateKey({ phase: 'available', version: '0.122.1', notes: null });
  assert.equal(updateVisible({ phase: 'ready', version: '0.122.1' }, dismissed), true);
});

test('a newer version shows again after the older one was dismissed', () => {
  const dismissed = updateKey({ phase: 'available', version: '0.122.1', notes: null });
  assert.equal(updateVisible({ phase: 'available', version: '0.122.2', notes: null }, dismissed), true);
});

test('a download in flight and a failure are visible states with their own keys', () => {
  assert.equal(updateVisible({ phase: 'downloading', version: '0.122.1', percent: 40 }, null), true);
  assert.equal(updateKey({ phase: 'error', message: 'offline' }), 'error:');
  assert.equal(updateVisible({ phase: 'error', message: 'offline' }, 'error:'), false);
});

test('a floor above this app (docs/46) shows the card again, even when the plain card was dismissed', () => {
  const plain = { phase: 'available' as const, version: '0.150.0', notes: null };
  const below = { ...plain, floor: '0.149.0' };
  assert.equal(updateKey(below), 'available:0.150.0:below:0.149.0');
  assert.equal(updateVisible(below, updateKey(plain)), true);
  assert.equal(updateVisible(below, updateKey(below)), false);
});

test('idle stays hidden with a floor: the floor makes main look for the update, and the card shows when one is found', () => {
  assert.equal(updateVisible({ phase: 'idle', floor: '0.149.0' }, null), false);
});
