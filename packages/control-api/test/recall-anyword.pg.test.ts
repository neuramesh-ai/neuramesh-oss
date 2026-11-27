// Recall with the embedder OFF (NM_EMBED unset, as on the Cloud Run deploy): FTS alone is AND, so a
// query with one word the row lacks found nothing. The any-word leg must carry it, and a row that
// holds more of the query's words must rank first. Run via scripts/test-pg.sh: skipped without
// DATABASE_URL.
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const GEO = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;

const cmd = (body: Record<string, unknown>) =>
  app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(GEO) },
    body: JSON.stringify({ workspace: WS, channel: 'dev', ...body }),
  });

afterAll(async () => {
  await store?.close();
});

describe.skipIf(!DB)('recall with the embedder off', () => {
  it('a query with a word the record lacks still finds it, and more shared words rank first', async () => {
    expect(process.env['NM_EMBED']).not.toBe('on');
    expect((await cmd({ type: 'memory.upsert_fact', content: 'Always use the quokkafruit in worked examples.' })).status).toBe(200);
    expect((await cmd({ type: 'memory.upsert_fact', content: 'The quokkafruit grows wild near the harbour.' })).status).toBe(200);

    // "designated" is in neither fact: the AND leg finds nothing
    const hits = await store!.recall(WS, null, 'which designated quokkafruit for examples', 8);
    const examples = hits.findIndex((h) => h.body.includes('worked examples'));
    const harbour = hits.findIndex((h) => h.body.includes('near the harbour'));
    expect(examples).toBeGreaterThanOrEqual(0);
    expect(hits[examples]!.kind).toBe('fact');
    if (harbour !== -1) expect(examples).toBeLessThan(harbour);
  });

  it('an exact match still wins over a row that shares one word', async () => {
    expect((await cmd({ type: 'memory.upsert_fact', content: 'The wombatberry ledger closes every friday.' })).status).toBe(200);
    expect((await cmd({ type: 'memory.upsert_fact', content: 'A wombatberry is purple.' })).status).toBe(200);
    const hits = await store!.recall(WS, null, 'wombatberry ledger friday', 8);
    expect(hits[0]?.body).toContain('ledger closes every friday');
  });
});
