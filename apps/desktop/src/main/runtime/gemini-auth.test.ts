import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geminiAuth, geminiLogin } from './gemini-auth';

const profile = (auth_method: string, token: Record<string, unknown>) => JSON.stringify({ auth_method, token });
const renewable = profile('gcp', { refresh_token: 'fixture' });
const keychain = (raw: string) => `go-keyring-base64:${Buffer.from(raw).toString('base64')}`;

test('agy Keychain encoding supports personal and Enterprise profiles', () => {
  for (const method of ['consumer', 'gcp']) {
    assert.deepEqual(geminiLogin(keychain(profile(method, { refresh_token: 'fixture' }))), { present: true, usable: true });
  }
  for (const raw of ['go-keyring-base64:', 'go-keyring-base64:broken', keychain('{}')]) {
    assert.deepEqual(geminiLogin(raw), { present: false, usable: false });
  }
});

test('active Keychain profile takes precedence over the legacy file, including expired logins', async () => {
  for (const [raw, expected] of [
    [renewable, { present: true, usable: true }],
    [profile('gcp', { access_token: 'fixture', expiry: '2000-01-01T00:00:00Z' }), { present: true, usable: false }],
    [profile('unknown', { refresh_token: 'fixture' }), { present: false, usable: false }],
  ] as const) {
    const result = await geminiAuth({
      keychain: async () => keychain(raw),
      file: async () => { assert.fail('must not read stale file when Keychain profile exists'); },
    });
    assert.deepEqual(result, expected);
  }
});

test('missing or unavailable Keychain falls back to agy file storage on headless machines', async () => {
  for (const keychain of [async () => null, async () => { throw new Error('unavailable'); }]) {
    assert.deepEqual(await geminiAuth({ keychain, file: async () => renewable }), { present: true, usable: true });
    assert.deepEqual(await geminiAuth({ keychain, file: async () => null }), { present: false, usable: false });
  }
});
