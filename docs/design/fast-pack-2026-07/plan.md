# Fast pack — research + plan (for review)

> **Status:** proposed, not built. Market research + seat selection dated **2026-07-17**; seats
> revised same day per founder direction: **no mini/lite-tier models — full-strength brains only.**
> Amends [docs/10-model-packs.md](../../10-model-packs.md) (a §3 row + a dated note) once approved.
> Mockup: [mockups/fast-pack.html](../../../mockups/fast-pack.html).

## 1. Goal

A sixth curated pack, **`fast`** — the fastest *full-strength* brain per role, across providers —
alongside `ultracode` / `balanced` / the three `-core` packs. For workspaces that want the loop to
feel quick without dropping to the small tier: intake routed in ~7s instead of ~23s, reviews back
in ~2s, plans in ~26s instead of ~45–50s.

**Litmus:** speed is non-negotiable #2 ("speed you can feel") and no pack optimizes for it.
Measured on our own bench, this roster runs the four benched working-role turns in **44.7s vs
79.0s on Ultracode and 80.7s on Balanced (~1.8× faster than either)** at **$0.044/loop (6× cheaper
than Ultracode, ~3× than Balanced)** — with every benched working seat at q≥92. A clear yes.

**Founder constraint (2026-07-17):** mini/lite-tier models (`gpt-5.4-mini`,
`gemini-3.1-flash-lite`) are excluded from working seats — not strong enough for real work,
whatever their bench sprints say. The pack's identity is *fastest capable*, capable first.

## 2. Market research (2026-07-17) — fastest per supported provider

Catalog was last verified 2026-07-10. One catalog event since:

| Provider | Fastest full-strength today | Status | Notes |
|---|---|---|---|
| **Anthropic** | `claude-sonnet-5` ($3/$15) · `claude-haiku-4-5` ($1/$5) below it | unchanged | Haiku 4.5 is the fast/small tier (~90 tok/s); Sonnet 5 is the fastest full-strength Claude (near-Opus coding at Sonnet cost). Lineup: Haiku 4.5 · Sonnet 4.6/5 · Opus 4.8 · Fable 5. |
| **OpenAI** | — (nothing fast-and-strong, measured) | **NEW: GPT-5.6 family GA'd 2026-07-09** | Sol (in catalog) + **Terra** ($2.50/$15) + **Luna** ($1/$6, "fastest and lowest-cost in the family", 1M ctx, GA across ChatGPT/Codex/API). `gpt-5.5` measured q57 architect / q86 reviewer — fails quality floors; Sol/Luna unbenched; Luna is small-tier anyway. |
| **Google** | `gemini-3.5-flash` ($1.5/$9) | unchanged | Google's fast *agentic flagship* (their stated best for agentic/coding, GA). `gemini-3.1-flash-lite` is the small tier (excluded by rule). No 3.5 Flash-Lite exists. |

Sources: Anthropic model docs + artificialanalysis.ai/providers/anthropic · openai.com/index/gpt-5-6
+ simonwillison.net/2026/Jul/9/gpt-5-6 (pricing/ctx/GA) · blog.google Gemini 3.5 + 3.1 Flash-Lite
posts, ai.google.dev models · artificialanalysis.ai speed leaderboard via benchlm.ai/llm-speed.

**Catalog consequence — REVISED at build time (2026-07-17 smoke):** the planned `gpt-5.6-luna`
catalog-add was **dropped on evidence**. Smoke (`codex exec --model gpt-5.6-luna` on the machine's
ChatGPT login, codex-cli 0.140.0) returned `400 invalid_request_error: "The 'gpt-5.6-luna' model
requires a newer version of Codex"` — and the app's `ensureCli` runs whatever codex is on the
user's PATH, so an offered Luna would hit `runResilient`'s model fallback and silently downgrade
to the account default. Luna re-enters the catalog when the app's codex path verifiably serves it
(and is then the headline docs/11 bench candidate). **Terra stays out** — no seat would take it
over `gpt-5.5`, and unseated ids bloat the picker.

## 3. Seat selection — fastest full-strength, measured first (bench 2026-07-02)

Method: per role, the **fastest non-mini/lite seat with quality ≥ 90** from the docs/11
leaderboards (measured wall-clock per real task, 5 runs); the **cross-family reviewer** doctrine
holds; designer/shipper have no bench dimension → curated per the docs/10 EXCEPTION rules.

| Role | Seat | Measured | Why / runner-up |
|---|---|---|---|
| orchestrator | `gemini-3.5-flash` | **6.6s** · q97 · $0.0041 | Fastest full-strength orchestration seat — and it beats Balanced's Sonnet 4.6 seat on *both* axes (23.1s, q88). Runner-up `gpt-5.5` (8.8s, q99): slower, and would drag in a third provider for one seat. |
| architect | `gemini-3.1-pro-preview` | **25.8s** · q94 · $0.0182 | Fastest ≥90 planner by far. Runner-up `claude-opus-4-8` (45.3s, q96): +2q for 1.8× the wall-clock and 4.6× the cost. Preview-as-default is the *existing* evidence-superseded exception (gemini-core architect, same seat, same measurement — not a new exception class). |
| developer / worker | `claude-sonnet-5` | **10.2s** · 100% pass · $0.0209 | Fastest full-strength dev (also Balanced's measured dev seat). Runner-ups: Opus (11.4s, 100%, 1.4× cost) · `gpt-5.5` (14.2s, 100%). |
| reviewer | `gemini-3.5-flash` | **2.1s** · q92 · $0.0010 | Fastest ≥90 **cross-family vs the Anthropic developer** — the same independent-judgment seat Ultracode/Balanced use. Haiku 4.5 (1.4s, F1 1.00) is faster+stronger but same-family as the dev → rejected; Opus (2.6s, q100) same-family + cost. |
| designer | `claude-sonnet-5` | curated | No bench dimension (docs/10 EXCEPTION). Anthropic leads design taste (docs/10); Sonnet 5 is the Balanced/Claude-Core designer and the fastest full-strength Claude. |
| shipper | `claude-sonnet-5` | curated | docs/23 tiering ("at/near the architect line", risk-weighted, low-volume): the Balanced/Claude-Core shipper seat. |
| sales · curator | `claude-haiku-4-5` | — | Support roles (light chat/curation, no FSM party) keep the small tier **by design across every pack** — same seats as Balanced/Claude Core. **Assumption to confirm:** the no-mini rule is about *working* seats; if Haiku should go too, both flip to `gemini-3.5-flash` (one-line change). |

```ts
fast: {
  id: 'fast', name: 'Fast', tagline: 'Fastest full-strength brain per role — mixes providers',
  roles: {
    orchestrator: 'gemini-3.5-flash', architect: 'gemini-3.1-pro-preview',
    developer: 'claude-sonnet-5', worker: 'claude-sonnet-5',
    reviewer: 'gemini-3.5-flash', designer: 'claude-sonnet-5', shipper: 'claude-sonnet-5',
    sales: 'claude-haiku-4-5', curator: 'claude-haiku-4-5',
  },
},
```

`PACK_ORDER`: `['ultracode', 'balanced', 'fast', 'claude-core', 'openai-core', 'gemini-core']`
(cross-provider packs first, per the existing ordering rule). **`defaultPackForProviders` is
unchanged** — Fast is an opt-in identity, never an onboarding default.

**vs Balanced, honestly:** the two packs share dev/designer/shipper; Fast differs in exactly two
working seats — orchestrator (Sonnet 4.6 → 3.5 Flash: 23.1s→6.6s *and* q88→q97) and architect
(Opus → 3.1 Pro: 45.3s→25.8s at q96→q94). That's the identity: Balanced-class quality, ~1.8×
faster where the loop is felt. *(Side observation, out of scope: 3.5-flash dominating Sonnet 4.6
on orchestration suggests a Balanced orchestrator reseat at the next bench pass.)*

## 4. Resolved decisions & flagged assumptions

- **Provider gate — resolved by the no-mini rule.** No OpenAI model earns a working seat on
  evidence (gpt-5.5 fails the architect/reviewer floors; Sol/Luna unbenched), so the gate lands on
  **anthropic + gemini** — identical to Ultracode/Balanced. The 3-provider question from the first
  draft is moot.
- **Preview id as a default** (architect): reuses the one existing evidence-superseded exception
  (gemini-core architect, docs/10 §3). Revisit when a GA Gemini 3.x Pro ships.
- **Haiku on support roles** (sales/curator): assumed in-scope for "avoid minis" = working seats
  only. Confirm or flip to 3.5-flash.

## 5. Implementation plan (the docs/10 mirror set — zero schema, zero PowerSync)

Pack ids are code-validated (no DB `check()`), `active_model_pack` already holds arbitrary ids, and
every picker/apply/hire/seed surface iterates `PACK_ORDER`/`resolvePackRoles` — so this is **pure
data + tests + docs**. Confirmed: no pack-id hardcodes outside the catalog (failover.test.ts /
mock-nm.ts key off `PACKS[...]`; the pg suite is catalog-derived since the v0.9.0 lesson).

1. **`packages/shared/src/model-packs.ts`** — the `fast` pack (+ its `latency` toks map);
   `PACK_ORDER` insert; seat-rationale comment (EXCEPTION 4: measured 2026-07-02 under the
   no-mini/lite founder rule); a dated Luna-exclusion note on the codex catalog (see §2 —
   dropped on smoke evidence, not added).
2. **`packages/shared/src/failover.ts`** — no change shipped (Fast's seats all have existing
   chains or are termini; the planned Luna chain went with the Luna add).
3. **`packages/shared/test/model-packs.test.ts`** — lock-in describe: Fast seats via
   `packModelForRole`, the no-small-tier working-seat rule, cross-family reviewer, gate =
   `['anthropic','gemini']`, PACK_ORDER position, `defaultPackForProviders` never returns
   `'fast'`, the latency map; plus a Luna-exclusion lock (neither offered nor accepted).
4. **`apps/desktop/src/renderer/src/App.tsx`** — `RUNTIME_OPTS` derives from `CURRENT_MODELS`
   — no catalog edit. Pack pickers are data-driven — the new card appears everywhere (Settings
   grid, onboarding, Brain-pill popup). The one UI addition (mockup §1): `PackRoster` + the pill
   roster render muted latency toks for packs carrying `latency` (benched roles show the tok,
   curated working roles show *curated*); `.packlat` in tokens.css.
5. **Bench mirror** — `apps/web/src/benchmarks.v1.json` packs section gains `fast`
   (hand-mirrored in report.ts's emitted shape); bench PRICING/LABELS untouched (no new ids).
6. **`pnpm --filter @neuramesh/control-api build:vercel`** — regen the bundle (the server
   allow-list inlines shared; a stale bundle would 400 Luna and reject `fast` on apply).
7. **docs/10** — §3 table row + dated "Fast pack + Luna catalog (2026-07-17)" note + Last-verified
   bump. **Version bump** root + desktop matched.

**Verification (evidence, per doctrine):** shared + failover unit suites green; pg suite via
`scripts/ci-db-bootstrap.sh` (it only runs in CI otherwise); dev-stack e2e — `nm:apply-pack('fast')`
re-materializes non-pinned agents then persists the id, a pinned agent survives; **Codex smoke for
`gpt-5.6-luna` on a real ChatGPT subscription** (the codexsdk silent-downgrade trap — verify the
served model string, exactly the Sol precedent); both-theme screenshots of the Brains grid + pill
popup via the shoot.cjs harness (`?pack=fast&clicktext=Brain ·,Fast`).

**Deploy notes:** none — no migration, no PowerSync rules, no env vars. (State it explicitly in the
PR's `## Deploy notes`.)

**Non-goals:** no default-pack change; no Terra; no re-seat of existing packs (the Balanced
orchestrator observation and any Luna seat wait for the docs/11 re-run); no new tables or commands.
