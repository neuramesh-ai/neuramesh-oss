// The desktop sign-in handoff lives fifteen minutes on the REAL table (source release 2026-09,
// unit U1b): a session polled at ten minutes is still pending, at sixteen it is gone. The
// clock is moved by shifting the row, since expires_at is set by the database. Run via
// scripts/test-pg.sh — skipped without DATABASE_URL.
import { DESKTOP_AUTH_TTL_MS } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const poll = (nonce: string, pollSecret: string) => app!.request('/auth/desktop/poll', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce, pollSecret }),
});

afterAll(async () => { await sql?.end(); await store?.close(); });

describe.skipIf(!DB)('the desktop handoff window (postgres)', () => {
  it('is fifteen minutes: pending at ten, gone at sixteen', async () => {
    const { nonce, pollSecret, expiresIn } = await j(await app!.request('/auth/desktop/start', { method: 'POST' }));
    expect(expiresIn).toBe(DESKTOP_AUTH_TTL_MS / 1000);
    const [row] = await sql!`select extract(epoch from (expires_at - created_at))::int as ttl from desktop_auth_sessions where nonce = ${nonce}`;
    expect(Number(row!['ttl'])).toBe(900);

    await sql!`update desktop_auth_sessions set created_at = created_at - interval '10 minutes', expires_at = expires_at - interval '10 minutes' where nonce = ${nonce}`;
    expect(await j(await poll(nonce, pollSecret))).toEqual({ status: 'pending' });

    await sql!`update desktop_auth_sessions set created_at = created_at - interval '6 minutes', expires_at = expires_at - interval '6 minutes' where nonce = ${nonce}`;
    expect(await j(await poll(nonce, pollSecret))).toEqual({ status: 'gone' });
  });
});
