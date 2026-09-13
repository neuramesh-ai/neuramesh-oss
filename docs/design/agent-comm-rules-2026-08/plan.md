# Agent communication rules — house style, workspace-configurable (design, for review)

> **Status: PROPOSAL (2026-08-21)** — George: "we need to improve the way agents communicate
> in neuramesh; two key rules for a start: (1) agents should avoid em-dashes; (2) agents
> should communicate in STE-100 writing style — applied to all content they produce: task
> naming, descriptions, replies, documents. It needs to be a superseding instruction for
> NeuraMesh agents but configurable at the workspace level (users can turn off STE-100 and
> the em-dash rule, or add more single-line agent rules)."
> Mockup: [mockups/agent-comm-rules.html](../../../mockups/agent-comm-rules.html)
> (two scenes, dark/cream toggle).
>
> **Status: BUILT (2026-08-21, merged via the workspace-voice PR) + validated live.** All
> three slices landed together: shared/commrules.ts + housestyle.ts with the five-composer
> sentinel test, workspaces.comm_rules + the workspace.update lane, the Settings → General
> Voice section (live-preview block), and the server-side em-dash scrub. Validated on the
> dev stack: the Voice panel renders the exact injected block; every agent message after
> the restart is dash-free (the six dashed rows in the window all predate the new API);
> the next-steps distill's own prose obeys the rules. Open decisions (a)-(c) stay open.

## 1. Where it lives — the answer to "what's the best place"

There is no single choke point today. The instruction surface is composed in three places,
each owning a family of turns:

| Composer | Turns it owns | Where |
|---|---|---|
| the orchestrator contract | triage · own-thread · sweeps | `host/orchestratorturn.ts` via `contractFor` (`main/contracts.ts`) |
| the shared chat-teammate system | every non-orchestrator `streamTurn` (chat replies, thread wakes) | `runtime/adapter.ts:267` (one string, shared by the CLI adapters) |
| the coding system prompt | worker + leg executions | `codingSystemPrompt(..., instructionsFor(agent))` in `runtime/claudecode.ts` (+ codex/gemini mirrors) |

Plus the bare-`complete()` utilities (the bootstrap's four docs, rec extraction, the coming
distill turn) which pass their own `system` strings.

**The design: one module, injected at those composition points, pinned by a test that cannot
fail silently.**

- **`apps/desktop/src/main/housestyle.ts`** — `houseStyleBlock(): string | null`. Reads the
  workspace's comm rules (cached at boot, refreshed on settings change), renders ONE block:

  ```
  HOUSE STYLE (workspace rule — supersedes any conflicting style guidance, including
  your own defaults):
  - Do not use em dashes (—) in anything you write. Use a comma, a period, or parentheses.
  - Write in STE-100 style: short sentences (at most 20 words). One instruction or idea
    per sentence. Active voice. Simple present tense where possible. No noun clusters of
    more than three words. Use the same word for the same thing every time.
  - <each custom workspace rule, verbatim, one line>
  ```

  Toggled-off rules drop out of the block; an empty rule set returns null and nothing is
  injected. The block is APPENDED LAST in every system composition — last position is what
  makes "supersedes" real to a model, and the wording says it out loud.

- **Injection sites (4):** the orchestrator contract tail, the chat-teammate system string,
  `codingSystemPrompt` (all three runtime mirrors take it from the one shared composer —
  the codingcontract test already pins that they agree), and a `withHouseStyle(system)`
  wrapper for the bare `complete()` call sites.

- **The cannot-fail test** (the selector-audit lesson): `housestyle.test.ts` builds each
  composer's output with a sentinel rule configured and asserts the sentinel appears in ALL
  of them — enumerated, so a new composer that forgets the block fails the list review, and
  a refactor that drops an injection fails the test.

**Why prompt-level and not output-scrubbing (mostly):** STE-100 is a writing discipline; only
the model can follow it. But the em-dash rule is mechanically checkable, so it gets teeth:

- **Slice 2 (enforced, not prompted):** when `noEmdash` is on, the daemon scrubs agent
  output at the post boundary — task titles, descriptions, and message bodies get `—`/`–`
  replaced with `, ` (mid-sentence) or `. ` (before a capital), OUTSIDE code fences and
  inline code. Documents/artifacts stay prompt-only in v1 (rewriting a report's quoted
  material or code samples is how a scrub corrupts a deliverable) — listed as open
  decision (b).

## 2. Storage + config lane

- **`workspaces.comm_rules jsonb`** (migration, auto-applies on deploy):
  `{ "ste100": true, "noEmdash": true, "custom": ["…", …] }`. **Defaults ON** — this is
  NeuraMesh's voice; the workspace toggle is the opt-out, exactly as George framed it.
- **`workspace.update`** grows the optional `commRules` field (HUMAN-gated in the handler,
  like autoFailover/activeModelPack). `workspaceSettings()` returns it; the daemon reads it
  at boot and on the settings IPC's refresh — the same lane every other workspace setting
  rides. **No PowerSync work** (workspaces aren't synced; settings travel over the API).
- Custom rules are single lines, max 200 chars, max 8 — a rule list, not a prompt editor.
  Each renders verbatim as one bullet in the block.

## 3. The UI — Workspace settings → "Voice"

A new section in the existing workspace settings panel (scene 01):
two toggles with one-line explanations + the custom-rules list (add box + per-row delete),
the model-packs list idiom. A muted preview of the exact block agents will receive sits
under the controls — what you toggle is what they read, no translation layer.

## 4. Honesty notes

- "STE-100 style" here means the PRINCIPLES of ASD-STE100 (sentence caps, one idea per
  sentence, active voice, consistent terms). Full STE-100 is a controlled dictionary
  (~900 approved words) — no prompt makes a model dictionary-compliant, and the settings
  copy must not claim it.
- The rules apply to what agents WRITE, not what they quote: report citations, code, and
  quoted competitor copy are exempt by construction in the scrub and by instruction in the
  block.
- Prompt budgets: the block is ~90 tokens with both rules on; the prompts-ratchet gains a
  named raise in the same commit that lands it.

## 5. Slices

1. **The block + the seam** — `housestyle.ts`, four injection sites, the cannot-fail test,
   hardcoded defaults (no config yet). Every agent turn immediately writes house style.
2. **The config** — migration + `workspace.update.commRules` + settings Voice section +
   daemon refresh. Toggles work end to end.
3. **Em-dash teeth** — the post-boundary scrub for titles/descriptions/bodies (code-fence
   aware), behind the same toggle, with tests for the fence exemptions.

## 6. Open decisions (confirm or correct — then I proceed)

(a) Should custom rules be per-workspace only, or also per-project (a project's voice can
differ)? Proposal: workspace-only v1 — the projects spine can inherit later.
(b) Does the em-dash scrub extend to delivered DOCUMENTS (reports, brand docs)? Proposal:
no in v1 — prompt-only for artifacts; revisit with evidence.
(c) Does house style apply to ECHO mode (deterministic dev turns)? Proposal: no — echo
output is fixtures, not communication.
