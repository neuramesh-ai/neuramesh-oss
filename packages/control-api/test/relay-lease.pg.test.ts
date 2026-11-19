import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
if (DB && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(DB).hostname)) throw Error('Relay lease tests require isolated loopback PostgreSQL');
const sql = DB ? postgres(DB, { max: 2, onnotice: () => {} }) : null;
const store = DB ? new PostgresStore(DB) : null;
let shard: number;
const a = randomUUID(), b = randomUUID();
describe.skipIf(!DB)('relay shard ownership on real SQL', () => {
  beforeAll(async () => {
    const used = new Set((await sql!`select name from fleet_leases`).map(row => row.name));
    shard = Array.from({ length: 32 }, (_, n) => n + 32).find(n => !used.has(`relay-${n}`))!;
    if (shard == null) throw Error('No isolated lease slot. Preserve existing leases.');
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => { if (sql) { await sql`delete from fleet_leases where name=${`relay-${shard}`} and holder in (${a},${b})`; await store!.close(); await sql.end(); } });
  it('allows only the relay credential and derived shard names, serializes owners, and rejects a stale owner', async () => {
    vi.stubEnv('RELAY_SECRET', 'fixture-relay-lease'); vi.stubEnv('FLEET_SECRET', 'fixture-fleet-lease');
    const app = createApp(store!);
    const post = (path: string, body: object, token = 'fixture-relay-lease') => app.request(path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/internal/relay/lease', { shard, holder: a }, 'fixture-fleet-lease')).status).toBe(403);
    expect((await post('/internal/relay/lease', { name: 'cloudrun', holder: a })).status).toBe(400);
    expect((await post('/internal/relay/lease', { shard: 64, holder: a })).status).toBe(400);
    const raced = await Promise.all([a,b].map(async holder => (await post('/internal/relay/lease', { shard, holder })).json() as Promise<{ held: boolean; holder: string }>));
    expect(raced.filter(answer => answer.held)).toHaveLength(1);
    const winner = raced.find(answer => answer.held)!.holder, other = winner === a ? b : a;
    expect(await (await post('/internal/relay/lease/release', { shard, holder: other })).json()).toEqual({ released: false });
    await sql!`update fleet_leases set expires_at=now()-interval '1 second' where name=${`relay-${shard}`}`;
    expect(await (await post('/internal/relay/lease', { shard, holder: other })).json()).toMatchObject({ held: true, holder: other, generation: 2 });
    expect(await (await post('/internal/relay/lease', { shard, holder: winner })).json()).toMatchObject({ held: false, holder: other });
    expect(await (await post('/internal/relay/lease/release', { shard, holder: other })).json()).toEqual({ released: true });
    expect(await sql!`select name from fleet_leases where name=${`relay-${shard}`}`).toHaveLength(1);
  });
});
