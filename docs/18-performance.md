# 18 — Performance: budgets, measurements, and the memory hot path

Budgets are doctrine ([05 §speed](05-engineering-philosophy.md)); this doc is where they meet
measured reality. First full review 2026-07-07 (Apple Silicon dev machine, Docker pg16,
pgvector 0.8.2; prod probes against api.neuramesh.app). Update the tables when a change
moves a number — a budget without a current measurement is a claim, not a contract.

## 1. The budgets and where they stand

| Budget (docs/05) | Measured 2026-07-07 | Enforced by |
|---|---|---|
| send < 50ms | not instrumented — path is local-first (SQLite insert → optimistic render; upload drains async) | nothing (deferred: dev-build timing) |
| view switch < 100ms | 10–16ms (shot harness, docs/12) | log only |
| cold start < 2s | `coldstart_ms` log, single checkpoint | log only |
| **recall < 200ms** | **p50 67ms / max 113ms** warm semantic (10-call sweep, dev stack) | dev-stack e2e throws >200ms (`sync.ts`) + `/v1/recall` returns `ms` |
| agent overhead < 10% | first gauge 2026-08-18 (§2a): static instruction payload measured per turn kind; real turns from activity.db | `promptbudget.test.ts` prints the table every test run; prompts-ratchet budgets pin it (shrink-only) |
| 60fps lists | no virtualization (full render + memoized grouping) | nothing (deferred) |
| motion ≤ 150ms | CSS only | nothing |

Agent-side response floors (2026-06-23, unchanged): trivial architect plan ≈ 4min; agent
cold-start ≈ 2.75min; complex plans are generation-bound — infra work does not move them.

## 2a. The instruction surface (first measured 2026-08-18)

The agent-overhead budget finally has a gauge, in two halves.

**Static payload per turn kind** — measured from the BUILT registries + composed contracts by
`apps/desktop/src/main/promptmeter.ts` (printed by `promptbudget.test.ts` on every test run;
tokens ≈ chars/4, the assemble.ts convention). Baseline at the audit commit, pre-diet:

| Surface | Baseline (chars ≈ tok) |
|---|---|
| orchestrator contract (channel+powers+style, composed) | 26,915 ≈ 6.7k |
| orchestrator registry, `triage` | 43 tools · 31,854 ≈ 8.0k |
| orchestrator registry, `own` | 42 tools · 31,425 ≈ 7.9k |
| orchestrator registry, `sweep` | 41 tools · 29,918 ≈ 7.5k |
| CLI worker bus (DEFS + whiteboards) | 18 tools · 11,743 ≈ 2.9k |
| worker contract (system+turn+where.repo+nm_tools) | 2,808 ≈ 0.7k |

The assembler's `contextBudget()` governs only the dynamic user-message blocks; everything in
this table rides OUTSIDE it, on every wake. The skills list (~8.5k chars in a seeded #build
room) and per-turn notes (marketingNote et al.) ride on top of these.

**Real turns** — the daemon already records the SDK's own usage per turn in
`~/.neuramesh/state/activity.db` (`agent_logs`, `kind='result'`, `detail` = raw usage JSON,
including cache reads — the true prompt size). Recipe:

```sql
SELECT agent_name, COUNT(*) turns,
       ROUND(AVG(json_extract(detail,'$.input_tokens')))                    AS avg_in,
       ROUND(AVG(COALESCE(json_extract(detail,'$.cache_read_input_tokens'),0)))     AS avg_cache_read,
       ROUND(AVG(COALESCE(json_extract(detail,'$.cache_creation_input_tokens'),0))) AS avg_cache_write,
       ROUND(AVG(json_extract(detail,'$.output_tokens')))                   AS avg_out
FROM agent_logs WHERE kind='result' AND detail LIKE '%input_tokens%'
GROUP BY agent_name ORDER BY turns DESC;
```

Baseline (2026-08-18, this dev machine, 58 rex turns): **avg 304 fresh + 81,095 cache-read +
16,779 cache-write input tokens per orchestrator turn** (out: 1,641). The agentic loop re-reads
the static prefix on every tool-use iteration, so every KB of static payload is paid N× per
turn — while the assembled DYNAMIC context measured 47–897 tokens (`phase='inject'` rows).
The static surface is the overhead; the diet (2026-08-18 audit) attacks exactly it.

## 2. Recall latency decomposition (measured)

The 200ms budget is spent almost entirely OUTSIDE Postgres:

| Stage | Measured | Note |
|---|---|---|
| Hybrid SQL (4 legs + RRF), 100k facts | **0.45ms warm / 2.2ms cold** | synthetic corpus, real index shapes (HNSW cosine + GIN + partial btree); HNSW build at that scale: 6.8s serial |
| Query embed (bge-small ONNX, CPU) | **~65–95ms** | fastembed, untuned; the dominant hot-path cost |
| Embedder first call (model init) | **4,862ms** | now paid at boot (`embedder_ready` log), never on a live recall |
| End-to-end `/v1/recall`, FTS-only | 2–3ms warm | what Vercel prod serves (no embedder in the bundle — intentional) |
| End-to-end `/v1/recall`, semantic | **67–113ms** | dev stack, embedder warm |
| Network floor to api.neuramesh.app | ~150ms TTFB | from a west-coast machine; function now pinned `cle1` next to the us-east-2 Supabase |

Reference points (mid-2026 state of the art): Mem0 reports search p50 148ms / p95 200ms
(arXiv 2504.19413); Zep reports sub-200ms typical / p95 300ms; the ~200ms chat-agent recall
budget is the industry norm. The read-path pattern here — hybrid vector+FTS, RRF (k=60),
no LLM calls at retrieval, bitemporal supersession, async write-path intelligence — is the
same pattern those systems publish. Treat vendor benchmark scores (LoCoMo) skeptically:
its judge accepts 63% of intentionally-wrong answers.

## 3. What shipped 2026-07-07 (the "light the semantic layer" pass)

Recall was FTS-only in EVERY environment before this: the embedder is gated on `NM_EMBED=on`,
nothing set it, Vercel strips fastembed structurally (`--no-optional` + esbuild external),
and rows written while the flag was off kept NULL embeddings forever.

- **Embedder on where the API runs local**: `scripts/dev-app.sh`, `scripts/cloud-app.sh`
  (dev-cloud DB), `NM_EMBED` passthrough in `scripts/dev-e2e.sh` (gate stays hermetic;
  `NM_EMBED=on pnpm e2e` covers the semantic path on demand). Vercel stays FTS-only by design.
- **Warm at boot** (`startMemoryMaintenance`): the ~5s ONNX init happens at server start
  (`embedder_ready ms=…`), never on a live recall.
- **Backfill**: `backfillEmbeddings` batches (32/round, 50ms pacing) heal every NULL-embedding
  row at boot — `embed_backfill messages=53 facts=4 done` on the dev stack, coverage 0→100%.
  Message embeds on send remain fire-and-forget behind the txn (sends never wait).
- **Migration 0063**: database-level `hnsw.iterative_scan = relaxed_order` — ACL-scoped ANN
  legs (workspace/channel/validity filters) post-filter through the HNSW graph and can starve
  the LIMIT without it (AWS measured filtered recall 10%→100% with this on).
- **Recall hits in task context packets** (docs/03 §6's promise, now real): fan-out runs one
  hybrid `/v1/recall` (k=8 → ≤5 injected lines, deduped against the lessons block) so workers
  start warm instead of spending an in-loop tool turn — an agent tool call costs an LLM
  round-trip (5–40s), not the tool's milliseconds. Formatting is pure (`recallnote.ts`).
- **Vercel region pinned** (`regions: ["cle1"]`): the function was in iad1 (us-east-1) with
  Supabase in us-east-2; every request pays the API→DB gap 1–3×.
- **Reconcile threshold calibrated 0.25 → 0.1** (`upsertFact`): found during validation —
  the embedder's first live run made two DISTINCT same-topic lessons (cosine distance
  0.246) supersede each other. Topical closeness is not contradiction; only near-paraphrase
  (≤ ~0.1 for bge-small) supersedes. Regression-pinned with controlled-distance vectors in
  `recall-semantic.pg.test.ts`.

Semantic A/B on the dev stack (same DB, same query — a paraphrase sharing zero keywords
with the target, `"night theme appearance preference decision"`):

| Path | Result |
|---|---|
| FTS-only (prod behavior) | 0 hits, 26ms |
| Semantic hybrid | 4 hits, 130ms — top hit: the dark-mode-toggle design thread |

Evidence: `docs/evidence/lessons-{dark,cream-oak}.png` (Memory view, both doctrine themes,
both same-topic lessons valid side-by-side + a retired row), pg suite 40/40 (semantic leg,
backfill heal, GUC, threshold), desktop suite 102/102, `maintenance.test.ts` 4/4.

## 4. Reproduction

- SQL at scale: seed a scratch DB with 100k synthetic 384-dim rows + the three index shapes,
  time the channel-scoped RRF hybrid (this review's numbers were warm-cache, random vectors —
  a cost floor, not a prod p95).
- End-to-end: `NM_EMBED=on` + `PORT=8799 DATABASE_URL=… pnpm exec tsx src/server.ts` in
  `packages/control-api`, then POST `/v1/recall` — the response carries `ms`.
- Semantic path under test: `bash scripts/test-pg.sh` (mocked embedder, hermetic) or
  `NM_EMBED=on pnpm e2e` (real model, downloads ~30MB once).

## 5. Known characteristics (accepted, documented)

- **No relevance floor**: recall is rank-fused; the vector legs return the nearest N
  regardless of absolute distance, so small corpora always fill the top-k. The contract is
  ordering, not presence — consumers cap and dedupe (the packet note takes ≤5 lines).
- **FTS is AND-semantics** (`websearch_to_tsquery`): multi-word queries often return zero
  keyword hits; the vector legs are what make paraphrase queries land.
- Embedding writes are additive and idempotent; the vector columns are NOT synced
  (PowerSync ships messages without `embedding`/`fts`).

## 6. Deferred (decided direction, not yet built)

- **Local-first daemon recall** — the P0 architectural follow-up: sync `facts` (small),
  embed + search on the daemon machine (agents are the hot consumers and live there), keep
  `/v1/recall` as the cross-machine fallback. Kills the ~150ms cloud floor, works offline.
  Needs a PowerSync rule deploy + a desktop embedding runtime.
- Per-leg timing (embed ms vs SQL ms) + recall p50/p95 telemetry to PostHog.
- CI perf gate at synthetic 100k scale; `statement_timeout` on recall queries.
- SQL-side fact reconcile (today `upsertFact` loads all valid channel facts into JS — O(N)
  per write; fine at 10², a tail at 10⁴).
- `halfvec` (−50% index/storage, <1% recall cost) once vector volume warrants.
- Send-path instrumentation; message-list virtualization; the agent-overhead (<10%) harness.
- Prod (Vercel) semantic recall — superseded by local-first recall if that lands first;
  hosted embedding APIs stay rejected for the hot path (independent p90 ≈ 500ms).
