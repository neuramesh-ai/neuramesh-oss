import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geminiLogin } from './detect';

const now = Date.parse('2026-10-16T00:00:00Z');
const profile = (token: Record<string, unknown>) => JSON.stringify({ auth_method: 'consumer', token });

test('installing agy without a saved login never authenticates a machine', () => {
  for (const raw of ['', '{}', 'null', 'invalid', profile({}), profile({ access_token: '' })]) {
    assert.deepEqual(geminiLogin(raw, now), { present: false, usable: false });
  }
});

test('a valid or renewable Google profile is usable', () => {
  assert.deepEqual(geminiLogin(profile({ access_token: 'fixture', expiry: '2026-10-17T00:00:00Z' }), now), { present: true, usable: true });
  assert.deepEqual(geminiLogin(profile({ access_token: 'fixture', expiry: '2026-10-15T00:00:00Z', refresh_token: 'fixture' }), now), { present: true, usable: true });
});

test('an expired or unreadable expiry without refresh keeps the login but needs reconnection', () => {
  for (const expiry of ['2026-10-15T00:00:00Z', 'invalid']) {
    assert.deepEqual(geminiLogin(profile({ access_token: 'fixture', expiry }), now), { present: true, usable: false });
  }
});

test('API key and other profiles never claim a consumer subscription', () => {
  for (const auth_method of ['api_key', 'adc', undefined]) {
    assert.deepEqual(geminiLogin(JSON.stringify({ auth_method, token: { access_token: 'fixture' } }), now), { present: false, usable: false });
  }
});
