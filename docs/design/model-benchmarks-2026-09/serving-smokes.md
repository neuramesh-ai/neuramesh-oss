# Serving smokes, 2026-09-07

A model that a vendor calls GA is not a model this app can serve. The 2026-07 pass learned that from
`gpt-5.6-luna`, which the Codex CLI rejected while `runResilient` quietly retried the turn on the
account default. So every new catalog id is driven through the lane the product actually uses before
it earns a seat.

Machine: Node 22.0.0, macOS. `codex` on PATH was 0.145.0. `@openai/codex-sdk` 0.153.4 (this change).
Keys from `.env.benchmark`.

## Codex lane (`apps/desktop/src/main/runtime/codexsdk.ts`)

`new Codex({ apiKey, env }).startThread({ model, sandboxMode: 'read-only' }).runStreamed(...)`

| model | result | wall clock |
|---|---|---|
| `gpt-6-astra` | SERVED | 7.6 s |
| `gpt-5.6-sol` | SERVED | 3.8 s |
| `gpt-5.6-terra` | SERVED | 3.0 s |

Astra needs codex-cli 0.153.0 or newer. The SDK bundles its own matching binary, but the app passes
`codexPathOverride: await ensureCli('codex')`, which is whatever is on the user's PATH. A 0.145.0
PATH binary would therefore have failed the model and downgraded the turn silently. That is why this
change adds `CODEX_MIN_VERSION` to `ensureCli`: it upgrades the CLI, then re-probes, then fails
loudly if the machine is still too old.

## Claude worker lane (`runtime/claudecode.ts`)

`query({ options: { model, maxTurns: 1, allowedTools: [] } })`

| model | result | wall clock |
|---|---|---|
| `claude-fable-5-1` | SERVED | 37.1 s |
| `claude-opus-5` | SERVED | 5.2 s |
| `claude-sonnet-5` | SERVED | 4.1 s |

Fable 5.1 took 37 seconds for a one-word answer through the agent harness. It thinks by default and
cannot be told not to. That is a real cost of seating it on a chatty role, and the benchmark's
latency column is where the decision should be made.

## Claude chat lane (`host/turnkit.ts`)

`client.messages.stream({ model, max_tokens, system, messages })`

| model | result | stop_reason | wall clock |
|---|---|---|---|
| `claude-fable-5-1` | SERVED | end_turn | 3.6 s |
| `claude-opus-5` | SERVED | end_turn | 1.2 s |
| `claude-sonnet-5` | SERVED | end_turn | 1.4 s |

## Gemini lane (`runtime/gemini.ts`)

`ai.models.generateContent({ model, contents, config })`

| model | result | wall clock |
|---|---|---|
| `gemini-3.8-flash` | SERVED | 0.9 s |
| `gemini-3.1-pro-preview` | SERVED | 2.2 s |
| `gemini-3.1-flash-lite` | SERVED | 0.5 s |

The `agy` CLI is the other Gemini lane. It never receives a `--model` flag
(`runtime/gemini.ts`), so it runs whatever the user's agy is configured for and needs no smoke here.
For the record, agy added Gemini 3.8 Flash to its catalog in 1.1.25, and this machine has 1.1.10.

## Structured output, all three providers

The benchmark asks for a schema-shaped JSON object. Anthropic used to get that by forcing a tool
call, which Fable 5.1 rejects with a 400. Every current Claude model answers `output_config.format`
instead, so the forced call is gone rather than branched.

| provider | request | models checked |
|---|---|---|
| Anthropic | `output_config: { format: { type: 'json_schema', schema } }` | haiku-4-5, sonnet-5, opus-5, fable-5-1 |
| OpenAI | `response_format: { type: 'json_schema', ... strict: true }` | astra, sol, terra, gpt-5.5 |
| Google | `responseMimeType` + `responseSchema` | 3.8-flash, 3.5-flash, 3.1-pro, 3.1-flash-lite |

All twelve returned a valid object. One number is worth keeping: Gemini 3.8 Flash spent 286 thinking
tokens to produce 33 output tokens on that call. The harness used to count only the 33, so every
Gemini cost on the public page was understated. It now counts both.


## What the benchmark pre-flight found

`--smoke` runs every model in every role at one task and one run, writes nothing, and costs a few
dollars. It ran twice, because the first run found two failures that would each have published a
leaderboard that looked complete.

**The Anthropic judge was rejecting every rubric it was asked to grade.** The rubric schema bounded
each score with `minimum: 0` and `maximum: 3`, and Anthropic's structured outputs do not accept
numeric bounds on an integer. The Anthropic judge is the one that grades OpenAI and Gemini
candidates, so all eight of them lost their research and planning rows while the four Anthropic
candidates scored normally. Under the old harness this was eight grey "skipped" lines.

The range now lives in the field description and the system prompt, and `clamp03` still enforces it.
`packages/bench/test/schema.test.ts` locks the class rather than the instance: it walks every schema
the harness sends and fails on any keyword outside the intersection of what the three providers
accept.

**GPT-6 Astra could not finish a coding task inside 6000 output tokens** and returned a 400. Its
reasoning consumed the budget before a line of code was written. Ceilings are now one table with the
reasoning attached, raised for a generation that thinks for thousands of tokens before it writes:
coding 32000, review and planning and orchestration 16000, judge 8000. Astra passes at the new
ceiling. A model that still cannot finish fails that sample and the count rides the row as
`truncations`, rather than losing the whole row.

Two things were checked and cleared rather than fixed:

- **Gemini's coding output format.** Both Gemini models label the file with a comment or a bare line
  inside the block rather than in the fence info string, which `parseFileBlocks` does not match. The
  single-file fallback catches it, and four out of four runs through the real runner passed.
- **A zero on the coding task.** Gemini 3.8 Flash scored 0% once with a suspiciously cheap call. Six
  probe runs and four runner runs found no repeat, so it is a rare short response rather than a
  harness artifact. Repeated samples in the measured run absorb it.

## Seat smoke: every model this reseat seats, on a real query

Run after the seats landed, before the PR. Each model is driven through the lane the product uses
for its role, and asked a real question: *"A checkout bug charges full price when a discount code is
applied. In one sentence, what do you check first?"*

| Model | Lane | Seats it holds | Wall clock | Answered |
|---|---|---|---|---|
| claude-sonnet-5 | agent SDK | 20 | 4.3s | yes |
| claude-fable-5-1 | agent SDK | 3 | 7.9s | yes |
| claude-opus-5 | agent SDK | 3 | 4.2s | yes |
| claude-haiku-4-5 | agent SDK | 6 | 11.3s | yes |
| gpt-6-astra | codex SDK | 4 | 3.9s | yes |
| gpt-5.6-sol | codex SDK | 5 | 3.0s | yes |
| gpt-5.6-terra | codex SDK | 2 | 3.1s | yes |
| gpt-5.4-mini | codex SDK | 2 | 4.9s | yes |
| gemini-3.8-flash | genai | 9 | 2.7s | yes |
| gemini-3.1-pro-preview | genai | 4 | 7.3s | yes |
| gemini-3.1-flash-lite | genai | 2 | 1.1s | yes |

Eleven of eleven. Every answer named the discount calculation or the amount sent to the payment
processor, which is the right first check, so these are real answers and not just non-empty strings.

The point of this pass is not quality, which the benchmark already measured. It is that a seat
nobody has watched serve is a guess. This is the check that would have caught `gpt-5.6-luna` in July.

## End-to-end in the app, and the bug only that could find

The seat smoke proves each model answers. It does not prove the PRODUCT shows the right thing, so
the preview harness was built and driven the way a person drives it: open the workspace menu, click
Settings, click Brains. Both themes captured in `evidence/`.

That check found something no test had:

**The page declared a seat the product does not give.** The starter brain was added to the board
after the seats were decided, tied GPT-6 Astra on review at F1 1.00, and the automatic value
tiebreak handed it the seat. Same for GPT-5.4 mini in three more roles. So the page said "Gemini 3.5
Flash-Lite takes the code review seat" while every pack seated Astra, in four of five roles.

The page's winner was a pure value tiebreak; the product's seat obeys the founder rule that mini and
lite tiers hold no working seat. `pickWinner` now only considers models that could actually take the
seat, and those rows stay on the board with their real scores, because the numbers are worth seeing.
Locked by `packages/bench/test/schema.test.ts`.

It also found that the published `packs` block was **stale**: it is derived from the live catalog
rather than from the measurement, so a seat change makes the cards wrong while every number stays
right. There was no way to refresh it except re-running the whole suite, which spends real money to
recompute something that needs no model. `--report-only` re-assembles the report from the rows it
already holds.

The desktop screenshots confirm the seats as shipped: all six packs render the new models, the Fast
pack shows its re-stamped latencies (5.4s, 15.0s, 11.8s, 2.5s), and **Ultracode and OpenAI Core both
show "Connect ChatGPT" rather than Apply**, which is the gate change from the deploy note behaving
correctly on a workspace with no OpenAI credential.

### Electron is broken in this worktree (environment, not this change)

`pnpm install` fails at electron's postinstall: `@electron/get@5` is ESM and electron 41's
`install.js` still `require()`s it, so the binary never downloads and `scripts/shoot.cjs` cannot run.
The screenshots above were taken by serving `apps/desktop/out/preview` over HTTP and driving headless
Chrome, which memory records as the documented fallback. Worth fixing separately.

## Live in the real app, against the local dev stack

The preview harness renders mock data. It proves the seats DISPLAY, not that an agent wakes and runs
on one. So the real app was built and run against the local stack (`dev/stack` pg + PowerSync, the
control-api on 8788, Electron with BYOK keys), and driven over CDP.

What was proven, in order:

1. **The Brains tab shows the new seats** on a live workspace, not a fixture.
2. **Applying a pack re-seats real agents.** Claude Core was applied from the UI, and the `agents`
   rows moved: reviewer to `claude-fable-5-1`, orchestrator and developer to `claude-sonnet-5`,
   architect to `claude-fable-5-1`, shipper to `claude-opus-5`.
3. **A human's manual pin survived the re-seat**, which is the behaviour `model_source='manual'`
   exists for. One orchestrator stayed on its pinned model while its five pack-managed siblings moved.
4. **An agent answered for real.** rex replied "17 × 23 = 391" in the app.
5. **GPT-6 Astra answered for real.** rex, pinned to `gpt-6-astra`, replied "The capital of Japan is
   Tokyo, and 40 + 2 = 42". The Codex rollout log for that minute records `model: gpt-6-astra`, so
   the turn went through the Codex CLI on the new model rather than falling back.

### The version floor fired, and then revealed a second bug

Before the CLI was upgraded, the wake failed loudly, which is the whole point:

```
agent_wake agent=rex failed: the "codex" CLI is 0.145.0, but this model needs 0.153.0 or newer.
```

No silent downgrade. But the auto-upgrade behind that message did not work, and the message was
wrong for this machine. `codex` here is a STANDALONE install symlinked from `~/.local/bin`, and
`~/.local/bin` sits ahead of npm's prefix on PATH. So `npm i -g @openai/codex@latest` installed a
second copy that nothing would ever run, the re-probe still saw 0.145.0, and the human was told to
run the command that had just failed to help.

Fixed: the floor now upgrades the install it actually resolved. It tries the binary's own
`codex update` first, falls back to npm only when the binary really is inside npm's prefix, and the
error names the resolved path and both upgrade routes. `codex update` took this machine to 0.153.4,
after which Astra ran. Locked by `cliversion.test.ts`.

### Environment notes for whoever runs this next

- `pnpm install` fails at electron's postinstall in a fresh worktree: `@electron/get@5` is ESM and
  electron 41's `install.js` still `require()`s it, so the binary never downloads. Copying `dist/`
  and `path.txt` from a working checkout is the fastest way around it. Worth fixing separately.
- The dev workspace was on the free plan, which caps a workspace at one machine and therefore starts
  no agent host. Set `plan='cloud'` on the local row to run a second machine.
