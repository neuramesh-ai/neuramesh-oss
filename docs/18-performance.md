# 18 — Performance: budgets, measurements, and the memory hot path

Budgets are doctrine ([05 §speed](05-engineering-philosophy.md)); this doc is where they meet
measured reality. First full review 2026-07-07 (Apple Silicon dev machine, Docker pg16,
pgvector 0.8.2; prod probes against api.neuramesh.app). Update the tables when a change
moves a number — a budget without a current measurement is a claim, not a contract.

## 1. The budgets and where they stand

| Budget (docs/05) | Measured 2026-07-07 | Enforced by |
|---|---|---|
| send < 50ms | not instrumented — path is local-first (SQLite insert → optimistic render; upload drains async) | nothing (deferred: dev-build timing) |
| view switch < 100ms | 10–16ms (shot harness, docs/12). Web, 2026-09-25 (§9), at 4x CPU: switch threads 135 ms (was 939 ms), open a 401-message thread 1,075 ms (was 1,212 ms) | log only |
| cold start < 2s | `coldstart_ms` log, single checkpoint. Web, 2026-09-25 (§9): a typed key accepted at 1,137 ms on a cold fast 4G load (was 3,440 ms), the first synced row at 5,977 ms (was 9,973 ms) | `scripts/perf/web` by hand |
| **recall < 200ms** | **p50 67ms / max 113ms** warm semantic (10-call sweep, dev stack) | dev-stack e2e throws >200ms (`sync.ts`) + `/v1/recall` returns `ms` |
| agent overhead < 10% | first gauge 2026-08-18 (§2a): static instruction payload measured per turn kind; real turns from activity.db | `promptbudget.test.ts` prints the table every test run; prompts-ratchet budgets pin it (shrink-only) |
| 60fps lists | 2026-09-24 (§8): a 200-message thread at 4x CPU scrolls at a p95 frame of 16.8 ms (was 233 ms), no main-thread block (was 18 s a run). Rows memoized on their data, no virtualization | nothing (the harness probes in §8 are manual) |
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
- The browser client: `scripts/perf/web/README.md`. `run-compare.sh` alternates two builds round
  by round, and `aggregate.mjs` folds the runs into medians (§9).

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

## 7. The browser replica (measured 2026-09-24)

The browser client reads a wa-sqlite replica on OPFS (`OPFSCoopSyncVFS`, one dedicated worker,
multi-tab off). Each replica row is JSON in `ps_data__<table>`, and each column is a
`json_extract` over it. The numbers come from headless Chrome on a production build against the
dev stack: Acme Robotics, 1,698 synced messages, 224 threads, 12.1 MB of first sync. The API
had 150 ms of added delay. Other work shared the machine, so each row is the median of runs that
alternate before and after.

| Path | Before | After | The change |
|---|---|---|---|
| Reload, first Home row | 778 ms | 496 ms | bootstrap answers from the last membership list |
| Reload with the API blocked | splash, no rows | 375 ms, 72 rows | the same |
| Reload offline (network emulation) | splash, no rows | 519 ms, 72 rows | the same |
| Open a room | 733 ms | 18 ms | client-schema indexes |
| Open a task thread of 439 messages, first message | 1,346 ms | 56 ms | indexes, shared watches |
| Idle with that thread open, main thread blocked | 79% | 2% | polled reads and polled state keep their identity |
| `/v1` requests in one idle minute | 81 | 6 | a 15 s window on the membership read |
| Replica time for one session (boot, room, thread, 2 min idle) | 9.96 s | 0.85 s | indexes |

These numbers give three rules.

- A query that filters, joins or correlates on a replica column needs a client-schema index in
  `packages/client-core/src/tables/`. Without one, each lookup decodes every row, and a
  correlated subquery does that once for each outer row.
- A `CASE`, or an `OR` over different columns, in a `WHERE` makes the planner ignore every
  index. Write one branch for each shape and take the `max` over a `union all`.
- A read that the renderer polls returns the same object while its answer stays the same. A new
  object with the same content renders the whole shell again.

Two gates stay open. In a build with Clerk, `main.tsx` waits for the Clerk restore (three round
trips) before it opens the replica. The first sync also carries every workspace of the member
(2.4 MB here) and every large column (skill bodies, inline artifact content, post media and
whiteboard scenes: 8.2 MB of the 11.4 MB of row data), and no first screen reads them.

## 8. The thread render: streaming, landing and scroll (measured 2026-09-24)

The founder asked for replies that stream as smoothly as claude.ai and threads that scroll without
jank. This round measured the thread view in the preview harness, then changed it.

**Method.** The production build of the harness with `?perf=1` (`preview/mock-perf.ts`: a
200-message thread of real markdown, and a 6.9 KB reply with a 40-line code fence and a table that
streams at about 40 deltas a second, then lands after a 350 ms sync gap). Headless Chrome 153 on
the arm64 slice, GPU raster on (Apple M2 Max), a 2x display, CPU 1x and 4x
(`Emulation.setCPUThrottlingRate`). Five runs a cell, the two builds alternated run by run,
medians shown. The machine carried other agents' work (load average 11 to 180), so read the
ratios, not the last digit.

**What was wrong.**

1. Every delta re-rendered the shell. The daemon sends the whole growing text on every delta, on
   the room key and the thread key. `App` held the room key in React state for its typing bar, so
   each delta re-rendered the shell, the open thread and every message in it, and each message
   parsed its markdown again.
2. The typewriter stalled. `useTypewriter` stepped on a 48 ms timer, and each delta reset the
   timer. A live stream sends a delta every 15 to 40 ms, so the reveal moved only in the pauses.
3. The reply vanished at the end. `done` removed the bubble one sync hop before the synced message
   arrived. The thread showed nothing, then the ghost again, then the message rose in whole.
4. The conversation yanked the reader. It set `scrollTop` to the bottom on every delta.
5. Rows were not memoized. A keystroke in the composer, a roster heartbeat or a run tick
   re-rendered every row and parsed all its markdown again.

**What changed.** One store holds the stream outside React, and surfaces read presence only
(`thread/streamstore.ts`). Markdown renders as top-level blocks, each parsed once and cached
(`md/blocks.ts`, `md/MdBody.tsx`). The reveal is paced by the frame against a deadline for each
arrival (`thread/reveal.ts`). The bubble stays until its row arrives, and the row takes the slot
with no rise (`.msg[data-landed]`). One stick-to-bottom rule serves both threads
(`thread/useStickToBottom.ts`). Rows are memoized on their data (`thread/rowmemo.ts`).

| Scenario (4x CPU) | Before | After |
|---|---|---|
| Stream: frames over 16.7 ms | 31% | 0.2% |
| Stream: dropped frames a run | 310 | 3 |
| Stream: reveal lag, median / p95 | 8.7 s / 16.9 s | 62 ms / 98 ms |
| Stream: characters not shown when the stream ends | 6,097 of 6,930 | 0 |
| Stream in the 200-message thread: main-thread block a run | 133 s | 0 |
| Stream in the 200-message thread: reveal lag, median | 67 s | 51 ms |
| Landing: frames with nothing in the slot | 20 | 0 |
| Landing: frames with the ghost back | 23 | 0 |
| Landing: the reply's top moves | 2,044 px | 0 |
| Landing: layout shift in the thread (CLS) | 0.146 | 0 |
| Reader scrolls up mid-stream: frames yanked back down | 675 | 0 |
| 200 messages: open, click to painted | 1,133 ms | 783 ms |
| 200 messages: steady scroll, p95 frame | 233 ms | 16.8 ms |
| 200 messages: steady scroll, main-thread block a run | 18.0 s | 0 |
| 200 messages: keystroke to paint, median / p95 | 553 / 739 ms | 24 / 35 ms |

At 1x the same changes take keystroke to paint from 65 ms to 13 ms and the reveal lag from 5.3 s to
62 ms. One reveal step of the 6.9 KB reply costs 2.14 ms of markdown work as one pass over the
whole text and 0.32 ms as the tail block alone (node, 1x, the mean over 406 steps).

**What did not help, measured.** `content-visibility: auto` on the rows did not change the open
time or the layout time. Without all 17 `:has()` rules, the style time per update did not change
beyond the noise. The two `.md pre:has(...)` rules match nothing now, because the cards left the
`pre` renderer long ago.

**Still open.** The reveal paints every frame, so the stream's paint time per update went up while
its script time went down (at 1x: script 8.1 to 3.0 ms, paint 1.3 to 3.0 ms). Three orbs and two
pulses in the chrome already force a full paint every frame while an agent works. The open of a
200-message thread still spends most of its time on the first render. A first mount of the newest
rows, with the rest in idle time, would help more than virtualization.

## 9. The web boot (measured 2026-09-25)

The browser client waited for three slow starts in a row: the Clerk session restore, then the
replica (a worker, the wasm and OPFS), then the App chunk. Nothing painted until the App chunk ran,
and the first script carried the Clerk library (71% of it) whether or not the page used it. Now:

- **A static first frame.** `web/index.html` paints the frame, the rail and a real composer before
  any script arrives. It is a copy of React's first frame (the same markup and classes), shown only
  for a signed-in person on Home in the default layout. React takes the typed text, the caret and
  the focus when its composer mounts (`lib/staticshell.ts`). The theme is set before the first
  paint too, so a light theme no longer shows the dark default first.
- **Three starts at once.** `main.tsx` starts the session restore, the replica and the App download
  together. It still installs `window.nm` before App runs and renders only after the restore.
- **Code on demand.** Clerk and the terminal load when they are needed. The first script went from
  759 KB to 180 KB (gzip), and the App chunk from 442 KB to 361 KB.
- **Immutable assets.** `vercel.json` gives hashed files under `/assets` a one-year immutable
  cache. Production sent `max-age=0, must-revalidate`, so every warm load revalidated every file.
- **The sync stream over HTTP.** PowerSync compresses an HTTP sync stream with zstd (service
  1.23.3 and later). The first sync on the dev stack was 5.56 MB on the WebSocket (deflate with a
  4 KB window) and 2.76 MB over HTTP. `VITE_NM_SYNC_METHOD=websocket` brings the WebSocket back.

**Measured** with `scripts/perf/web` (`run-compare.sh`, 5 alternated rounds on an Apple M2 Max,
Chrome 153 on arm64). The before build ran with production's headers today, the after build
with the branch's `vercel.json`. Fast 4G is 9 Mbps, an 85 ms round trip and 4x CPU. Broadband is
20 Mbps and 40 ms. A proxy shapes every byte, the sync stream included. Medians:

| Milestone | Profile | Before | After | Change |
|---|---|---|---|---|
| The composer on screen (the static frame) | fast 4G, cold | 3,159 ms | 693 ms | 4.6x |
| A typed key accepted | fast 4G, cold | 3,440 ms | 1,137 ms | 3.0x |
| React's own composer ready | fast 4G, cold | 3,159 ms | 1,410 ms | 2.2x |
| First synced row | fast 4G, cold | 9,973 ms | 5,977 ms | 1.7x |
| A typed key accepted | broadband, cold | 1,613 ms | 627 ms | 2.6x |
| First synced row | broadband, cold | 4,903 ms | 3,134 ms | 1.6x |
| A typed key accepted | broadband, warm | 912 ms | 345 ms | 2.6x |
| First synced row | broadband, warm | 970 ms | 372 ms | 2.6x |
| A typed key accepted | fast 4G, warm | 1,735 ms | 793 ms | 2.2x |
| First synced row | fast 4G, warm | 1,728 ms | 1,012 ms | 1.7x |
| JS, CSS and WASM over the wire (brotli) | cold | 1.81 MB | 1.17 MB | 1.5x smaller |
| JS, CSS and WASM over the wire | warm | 4,028 B (revalidations) | 0 B | none sent |

And in a session, at 4x CPU with no network shaping (the frame journeys, 5 alternated runs):

| Journey | Before | After | Change |
|---|---|---|---|
| A synced agent reply on screen after its post | 23.1 s | 515 ms | 45x |
| Switch from the long thread to another thread | 939 ms | 135 ms | 7.0x |
| Switch back to the long thread (401 messages) | 4,668 ms | 453 ms | 10x |
| Open the long thread from Home | 1,212 ms | 1,075 ms | 1.1x |
| Scroll the long thread, p95 frame | 1,033 ms | 33 ms | 31x |
| Fling the long thread, p95 frame | 1,667 ms | 33 ms | 50x |
| Scroll the long thread, frames over 16.7 ms | 95% | 36% | 2.6x fewer |
| Scroll the long thread, main thread blocked (long animation frames) | 24.5 s | 0 ms | gone |

Opening the long thread from Home barely moved (1,212 ms to 1,075 ms at 4x CPU): it renders all 401 messages at once, and the first render is the cost. A first mount of the newest rows, with the rest in idle time, is the next step.

The first synced row is the slow part of a cold load now. The first sync carries every workspace
of the member and every large column (§7), and no first screen reads them.

## 10. Live replies on the web (measured 2026-09-25)

The web showed no reply until the agent finished. `emitStream` sent the live bubble only to
Electron windows, so a cloud machine dropped every token, and the reply appeared whole when the
final message synced. Two changes fix that.

- **The relay's `stream` lane** (docs/42) carries the machine's live bubble to the browser as
  deltas, at most 30 frames a second for each key. On an isolated local stack, with the
  integrated build, the first reply text showed 29 ms after the machine had the first token
  (median of 3 runs). Today's production client took 4,180 ms. Each update painted 6 to 9 ms after
  the machine sent it (p50). A 1,008-character reply cost 33.6 KB on the lane, against 110.5 KB for
  the same updates as whole text. A real Starter reply painted its first text 22 and 26 ms after
  the machine had the first token (2 calls).
- **The brains stream tokens.** The Starter proxy streams (docs/10 §15.9): on the real model the
  first words showed at 615 to 793 ms, where the whole-reply door showed the full reply at
  1,615 ms. A watched Claude turn asks the Agent SDK for partial messages.

In the same harness as §9, at 4x CPU, a synced agent reply appeared 515 ms after its post
(was 23.1 s). Before, the row took 17.7 s to reach the replica, because the replica
worker was busy with unindexed queries, and then every message in the thread rendered again. Now
the row is in the replica after 487 ms. The indexes (§7) and the render store (§8) removed
both waits.

