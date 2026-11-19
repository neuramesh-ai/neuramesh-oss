import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { connectorRedirectUri } from '../src/connector-redirect';
import { MemoryStore } from '../src/store';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('connector callback origin behind Cloud Run and HQ', () => {
  it('uses one configured HTTPS callback during both grant and token exchange', async () => {
    vi.stubEnv('NM_API_URL', 'https://api.neuramesh.app/');
    vi.stubEnv('NM_CONNECTOR_KEY', 'local-test-key');
    vi.stubEnv('X_CLIENT_ID', 'local-client');
    vi.stubEnv('X_CLIENT_SECRET', 'local-secret');
    const app = createApp(new MemoryStore());
    // the start is the signed-in POST since the security lane (NM-011, connect-social.ts): the server
    // answers the provider's page, and the public GET start answers 410
    const start = await app.request('http://nm-cr-api-test.run.app/v1/connect/x/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: 'george' }), 'x-forwarded-host': 'attacker.invalid', 'x-forwarded-proto': 'http' },
      body: JSON.stringify({ workspace: 'ws_acme', channel: 'ch_marketing' }),
    });
    expect(start.status).toBe(200);
    const grant = new URL(((await start.json()) as { url: string }).url);
    expect((await app.request('http://nm-cr-api-test.run.app/connect/x/start?workspace=ws_acme&actor=george')).status).toBe(410);
    expect(grant.searchParams.get('redirect_uri')).toBe('https://api.neuramesh.app/connect/x/callback');
    expect(grant.searchParams.get('code_challenge_method')).toBe('S256');
    const exchanges: URLSearchParams[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/oauth2/token')) {
        exchanges.push(new URLSearchParams(String(init?.body)));
        return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' });
      }
      if (url.endsWith('/users/me')) return Response.json({ data: { username: 'synthetic_qa' } });
      throw new Error('Unexpected provider request');
    });
    const callback = await app.request('http://internal.run.app/connect/x/callback?' + new URLSearchParams({ code: 'synthetic-code', state: grant.searchParams.get('state')! }));
    expect(callback.status).toBe(200);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]!.get('redirect_uri')).toBe(grant.searchParams.get('redirect_uri'));
    expect(exchanges[0]!.get('code_verifier')).toBeTruthy();
  });
  it('keeps unconfigured local development on its actual origin', () => {
    vi.stubEnv('NM_API_URL', '');
    expect(connectorRedirectUri('http://127.0.0.1:8927/connect/x/start', 'x')).toBe('http://127.0.0.1:8927/connect/x/callback');
  });
  it('does not put configured credentials or an arbitrary protocol into callback URLs', () => {
    vi.stubEnv('NM_API_URL', 'https://user:secret@example.invalid');
    expect(() => connectorRedirectUri('http://localhost/start', 'x')).toThrow('public API origin');
    vi.stubEnv('NM_API_URL', 'javascript:bad');
    expect(() => connectorRedirectUri('http://localhost/start', 'x')).toThrow('public API origin');
  });
});
