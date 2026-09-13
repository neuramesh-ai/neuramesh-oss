// The semantic recall path against the REAL schema: with the embedder on (mocked
// here — deterministic vectors, no model download, CI stays hermetic) the vector
// legs surface hits that FTS's AND-semantics miss, backfillEmbeddings heals rows
// written while the embedder was off, and migration 0063's database-level
// hnsw.iterative_scan holds for every fresh connection (the ACL-filtered ANN
// recall-collapse guard). Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import { afterAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';

// Deterministic 384-dim "embeddings": a marker word pins the direction, so
// semantic closeness is fully under the test's control — ALPHA-texts cluster,
// BRAVO-texts cluster, everything else points far away. The *VEC markers build
// vectors at exact cosines to BASEVEC for the reconcile-threshold test.
vi.mock('../src/embedder', () => {
  const unit = (i: number) => {
    const v = new Array(384).fill(0);
    v[i] = 1;
    return v;
  };
  // cosine to unit(i) is exactly c; the remainder leaks onto axis j
  const mix = (i: number, c: number, j: number) => {
    const v = new Array(384).fill(0);
    v[i] = c;
    v[j] = Math.sqrt(1 - c * c);
    return v;
  };
  const assign = (t: string) =>
    t.includes('NEARVEC') ? mix(2, 0.96, 4)   // distance 0.04 to BASEVEC: true paraphrase
    : t.includes('TOPICVEC') ? mix(2, 0.85, 3) // distance 0.15 to BASEVEC: same topic, different norm
    : t.includes('BASEVEC') ? unit(2)
    : t.includes('ALPHA') ? unit(0)
    : t.includes('BRAVO') ? unit(1)
    : unit(300);
  return {
    embedderEnabled: () => true,
    embed: async (texts: string[]) => texts.map(assign),
    warmEmbedder: async () => 1,
  };
});

import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const GEO = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
// raw client for direct row surgery/assertions — the store keeps its pool private
const raw = DB ? postgres(DB, { max: 1, prepare: false, onnotice: () => {} }) : null;

const cmd = (body: Record<string, unknown>) =>
  app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(GEO) },
    body: JSON.stringify({ workspace: WS, channel: 'dev', ...body }),
  });

afterAll(async () => {
  await store?.close();
  await raw?.end();
});

describe.skipIf(!DB)('semantic recall (embedder on, deterministic vectors)', () => {
  it('vector leg surfaces a fact FTS AND-semantics misses', async () => {
    const r = await cmd({ type: 'memory.upsert_fact', content: 'the ALPHA release train ships from main every merge' });
    expect(r.status).toBe(200);

    // zero shared non-marker terms with the fact → websearch_to_tsquery (AND) misses;
    // the mocked vectors make them nearest neighbours → the vec leg must carry it
    const hits = await store!.recall(WS, null, 'ALPHA deployment cadence policy', 8);
    expect(hits.some((h) => h.body.includes('ALPHA release train'))).toBe(true);

    // Ranking control: recall is rank-fused with NO absolute relevance floor — at
    // small corpus sizes the nearest-N vector legs always fill, so an unrelated
    // fact MAY appear. The contract to pin is ORDER: the semantically-near fact
    // must outrank the unrelated one (RRF puts the vec-rank-0 hit first).
    await cmd({ type: 'memory.upsert_fact', content: 'the office coffee grinder wants cleaning on fridays' });
    const hits2 = await store!.recall(WS, null, 'ALPHA deployment cadence policy', 8);
    const alphaRank = hits2.findIndex((h) => h.body.includes('ALPHA release train'));
    const coffeeRank = hits2.findIndex((h) => h.body.includes('coffee grinder'));
    expect(alphaRank).toBeGreaterThanOrEqual(0);
    if (coffeeRank !== -1) expect(alphaRank).toBeLessThan(coffeeRank);
  });

  it('backfillEmbeddings heals rows written while the embedder was off', async () => {
    const r = await cmd({ type: 'memory.upsert_fact', content: 'BRAVO capacitor sizing is settled in the power doc' });
    expect(r.status).toBe(200);
    const { factId } = (await r.json()) as { factId: string };

    // simulate a flag-off write: strip the embedding, then let the boot job heal it
    await raw!`update facts set embedding = null where id = ${factId}::uuid`;
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const n = await store!.backfillEmbeddings(32);
      total += n.messages + n.facts;
      if (n.messages === 0 && n.facts === 0) break;
    }
    expect(total).toBeGreaterThanOrEqual(1);
    const [row] = await raw!`select embedding is not null as filled from facts where id = ${factId}::uuid`;
    expect(row!['filled']).toBe(true);

    // …and the healed row is now vector-recallable on a lexically-disjoint query
    const hits = await store!.recall(WS, null, 'BRAVO thermal budget question', 8);
    expect(hits.some((h) => h.body.includes('capacitor sizing'))).toBe(true);
  });

  it('0063: hnsw.iterative_scan=relaxed_order holds on a fresh connection', async () => {
    const [row] = await raw!`select current_setting('hnsw.iterative_scan') as v`;
    expect(row!['v']).toBe('relaxed_order');
  });

  // The 0.246 incident (2026-07-07, the embedder's first live run): two DISTINCT
  // same-topic lessons sat at cosine distance 0.246 and the old < 0.25 reconcile
  // threshold superseded one. Topical closeness must NOT read as contradiction —
  // only near-paraphrase (≤ ~0.1 for bge-small) supersedes.
  it('reconcile vector threshold: paraphrase supersedes, same-topic-different-norm stays valid', async () => {
    const f1 = await cmd({ type: 'memory.upsert_fact', content: 'BASEVEC deploys gate on the canary checklist' });
    const j1 = (await f1.json()) as { decision: string; factId: string };
    expect(['add', 'noop']).toContain(j1.decision); // noop on re-runs against a persistent dev DB

    // distance 0.15: same topic, different norm — must ADD, never supersede
    const f2 = await cmd({ type: 'memory.upsert_fact', content: 'TOPICVEC rollbacks require a signed incident note' });
    const j2 = (await f2.json()) as { decision: string };
    expect(['add', 'noop']).toContain(j2.decision);
    const [base] = await raw!`select valid_until is null as valid from facts where id = ${j1.factId}::uuid`;
    expect(base!['valid']).toBe(true);

    // distance 0.04: a true paraphrase — supersedes the base fact bitemporally
    const f3 = await cmd({ type: 'memory.upsert_fact', content: 'NEARVEC canary gating protects each rollout' });
    const j3 = (await f3.json()) as { decision: string; factId: string };
    expect(j3.decision).toBe('update');
    const [after] = await raw!`select valid_until is null as valid, superseded_by from facts where id = ${j1.factId}::uuid`;
    expect(after!['valid']).toBe(false);
    expect(after!['superseded_by']).toBe(j3.factId);
  });
});
