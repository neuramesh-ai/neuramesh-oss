# 06 — Runtimes

**Status:** 🟡 partial — the seam ships today; the harness **narrows** it
**Owns:** the provider matrix · the adapter contract · seat resolution · credential resolution
**Depends on:** [03 Tools](03-tools.md) (delivery), [01 Brain](01-brain.md) (the ledger it writes through)

---

## 1. Scope

Which AI runs a turn, how that is chosen, how it authenticates, and what an adapter is allowed to do.

---

## 2. Motivation — the seam is right, and it leaks

`runtime/adapter.ts` is a genuine success: one interface, three implementations, selected per agent by
`runtimeFor(agent.runtime)`. It shipped, it works, and it made heterogeneous teams possible.

But the interface grew into a **19-positional-parameter** method (`runQuery`, `adapter.ts:86`), six of
whose parameters are tools that two of the three adapters ignore. That is not a leaky abstraction by
accident — it is an interface that asks each adapter to *re-implement the harness*, and two of them
declined:

| Parameter | claude-code | codex | gemini |
|---|---|---|---|
| `proposeSkill` | ✅ | ✗ ignored | ✗ ignored |
| `recordLesson` | ✅ | ✗ | ✗ |
| `addBacklogItem` | ✅ | ✗ | ✗ |
| `beats` | ✅ native TodoWrite | ⚠️ stdout markers | ⚠️ stdout markers |
| `permissionGate` | ✅ | ✗ **not in signature** | ✗ **accepted and discarded** |
| `protectedPaths` | ✅ | ✗ (self-sandboxed) | ✅ Seatbelt |

The harness's answer is not a better `runQuery` signature. It is to **move all six concerns out of the
adapter** — tools to [the bus](03-tools.md), permissions to the gate, progress to
[envelopes](02-communication.md) — leaving the adapter with the one thing only it can do.

---

## 3. Design — the narrowed contract

```ts
export interface RuntimeAdapter {
  readonly name: RuntimeName;
  readonly capabilities: RuntimeCapabilities;

  /** Invoke the model for one turn. Tools arrive already resolved and already gated. */
  invoke(req: InvokeRequest): Promise<InvokeResult>;
}

export interface InvokeRequest {
  seat: Seat;                  // agent, model, systemPrompt
  prompt: string | Content[];  // assembled by the harness (05 §3.7) — the adapter builds NOTHING
  tools: BoundTool[];          // from the bus; each already wraps gate + hooks + ledger
  cwd?: string;                // the worktree or brain workspace
  signal: AbortSignal;         // the turn's one controller
  onEvent: (e: RuntimeEvent) => void;   // text deltas, tool intents, usage — straight to the ledger
  env: NodeJS.ProcessEnv;      // from providerEnv() — unchanged, already correct
}

export interface RuntimeCapabilities {
  agenticLoop: boolean;        // can it drive a multi-turn file/bash loop?
  inlineImages: boolean;       // can it see an image?
  nativeSandbox: boolean;      // does it self-sandbox? (codex: yes, Seatbelt workspace-write)
  toolTransport: 'in-process' | 'mcp-loopback';
  resumable: boolean;          // can a thread be resumed? (codex: yes)
}
```

**Three rules an adapter must obey**, and they are what the current interface fails to state:

1. **An adapter builds no prompts.** Prompt assembly is the harness's ([05 §3.7](05-execution.md)).
   Today `buildCodingPrompt` and `chatSystemPrompt` are called *inside* adapters, which is why the CLI
   and Claude prompts drift.
2. **An adapter never decides a permission.** It receives `BoundTool`s that are already gated. There is
   no `permissionGate` parameter to ignore, because there is no ungated path.
3. **An adapter reports, it does not interpret.** `onEvent` streams facts; the harness decides what a
   beat, a deliverable, or a failure is. No stdout marker scraping.

`capabilities` replaces scattered `if (agent.runtime === 'codex')` checks with a declared property the
harness can branch on honestly — and makes honest degradation visible instead of implicit (the
`deepWorkQuery` comment *"honest degradation: those adapters expose no web tools through our seam"* becomes
`capabilities.agenticLoop === false`).

---

## 4. The matrix

| | `claude-code` | `codex` | `gemini` |
|---|---|---|---|
| SDK / binary | `@anthropic-ai/claude-agent-sdk` (in-process) | `@openai/codex-sdk` (in-process, shells `codex`) | Antigravity `agy` CLI |
| Auth | BYOK `ANTHROPIC_API_KEY` or subscription login | `OPENAI_API_KEY`/`CODEX_API_KEY` or ChatGPT login | Google OAuth (**no key**); `GEMINI_API_KEY` powers only the SDK paths |
| Default model | `claude-opus-4-8` | `gpt-5.5` | `gemini-3.5-flash` |
| Agentic loop | ✅ | ✅ | ✅ via `agy --print` |
| Inline images | ✅ base64 blocks | ✅ `local_image` by path | ✅ SDK path only; `agy` is text-only |
| Sandbox | our Seatbelt wrapper (L1b) | **native** `workspace-write` | our Seatbelt wrapper |
| Tool transport | in-process | MCP loopback | MCP loopback (stdio shim) |

### 4.1 Two hard-won constraints that must not be "cleaned up"

**`agy` argv must be exactly `--print <prompt>`.** Any additional flag leaks into the model's context and
trips agy's own `antigravity_guide` skill, derailing the run into explaining the flag. Verified per flag:
`--dangerously-skip-permissions` makes it lecture about the flag (exit 0, zero edits — a silent no-op);
`--model` makes it announce the model and stop. Consequences: no per-agent model on the OAuth path (agy
uses its own configured default), and the Seatbelt wrapper's flags must precede the binary so agy's own
argv is untouched.

**`agy` stdin must be `'ignore'`.** Spawned headless with a piped stdin it blocks waiting for EOF and never
starts the turn (~4s with stdin ignored vs. >45s hanging).

These are recorded here because both look like tidy-up targets and both cost a debugging session to
rediscover.

### 4.2 Codex is the one runtime we do not double-sandbox

Codex self-sandboxes via native Seatbelt `workspace-write`. Wrapping it in our own `sandbox-exec` fights
its profile. Its residual gap — broad filesystem *reads* — is de-fanged by L0 (no secret env to read) and
L1a (a read it cannot exfiltrate past the egress allowlist). Deliberate, documented, and not an oversight.

---

## 5. Seat resolution

A **seat** is the resolved `(agent, model, systemPrompt)` for one turn, and it is resolved identically for
level-1 agents and subagents ([04 §2.3](04-subagents.md)):

```
agent.role ─┬─→ project's active model pack ──→ resolvePackRoles(packId)[role]
            ├─→ thread BrainOverride[role]      (a deliberate per-conversation exception)
            ├─→ agent.model                     (an explicit per-agent choice)
            └─→ DEFAULT_MODEL[runtime]          (the floor)
```

Precedence is most-specific-wins, and the server's model allow-list validates the result — which is why
`parseBrainOverride` drops a model outside that list rather than storing it. Full specification:
[docs/10](../10-model-packs.md) and [docs/08](../08-model-routing.md).

## 6. Credential resolution

`resolveToken` + `runtime/authpolicy.ts`, unchanged by the harness:

1. a workspace/agent **BYOK** key wins
2. else a local **subscription/OAuth login**, detected by `runtime/detect.ts`
3. else **nothing** — the "no silent billing" policy refuses to fall back to a stub, and the turn posts
   an actionable auth card instead

Keys never leave the machine, are never in [the brain](01-brain.md), and are stripped from every agent
child process by the L0 allowlist ([07](07-security.md)).

---

## 7. Invariants

| # | Invariant | Enforced where |
|---|---|---|
| R1 | An adapter builds no prompt | `InvokeRequest.prompt` is pre-assembled; no builder is imported by an adapter |
| R2 | An adapter cannot reach an ungated tool | it receives only `BoundTool`s; the raw registry is not exported to adapters |
| R3 | An adapter reports events, never interprets them | `onEvent` is the only channel; no marker parsing in adapter code |
| R4 | A missing capability degrades visibly | `capabilities` is declared, and the harness logs the degradation it causes |
| R5 | No provider key reaches a child process except the one it needs | `agentBaseEnv` allowlist + `providerEnv` injection |
| R6 | A turn's model passed the server allow-list | validated at seat resolution |

---

## 8. Failure modes

| Failure | Behaviour |
|---|---|
| the runtime CLI is missing | `ensureCli` surfaces an actionable error naming the install/login step |
| the model is unavailable on the plan | codex retries once with the account default and logs the substitution (`runResilient`) — keeps per-agent model selection working on subscriptions |
| a usage cap is hit | the failover card path ([docs/22](../22-capacity-failover.md)); with a ledger, the turn can continue on another runtime instead of restarting |
| the packaged app cannot spawn the native CLI | `claudeExecutablePath()` remaps into `app.asar.unpacked`; returns `undefined` in dev so the SDK's own resolution runs |
| an adapter throws mid-stream | the turn settles `failed` with the partial in the ledger |

---

## 9. Open questions

1. **Should `capabilities` gate turn kinds?** A `gemini`-seated agent on the OAuth path cannot honour a
   per-agent model, and `agy` cannot see images. Rather than degrade silently, the dispatcher could refuse
   to seat certain kinds on certain runtimes. *Leaning: log and degrade in P1, refuse only where the
   output would be misleading.*
2. **Warm pools.** Codex threads are resumable, which makes a warm pool feasible and would cut the
   cold-start floor that dominates short turns. *Deferred — measure first ([docs/18](../18-performance.md)).*
3. **A fourth runtime** (local models via Ollama, or a hosted OpenAI-compatible endpoint). The narrowed
   contract makes this cheap, which is the point of narrowing it. *No demand yet.*

---

## 10. Change log

| Date | Change |
|---|---|
| 2026-07-31 | Created. Documents the shipped matrix and specifies the **narrowed** adapter contract (`invoke` + `capabilities`), moving tools, permissions, prompts, and interpretation out of adapters. Records the `agy` argv/stdin constraints and the codex no-double-sandbox decision. |
| 2026-08-02 | `capabilities.gatesNativeTools` shipped (v0.73.0). Verified against the vendors: per-call policy over a runtime's own Read/Write/Bash is `claude-code` ONLY — `@openai/codex-sdk` exposes `approvalPolicy` as a policy string with no approval event, and agy admits no hook. The limit is declared in the capability matrix rather than implied away. |
