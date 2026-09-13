# Engineering OS — implemented relay-backed vertical slice

Status: implemented and locally validated; uncommitted pending product approval
Date: 2026-08-31
Neuramesh baseline: `02795c07`
Cline contract reviewed: `@cline/core` / `@cline/sdk` `0.0.81` at `48d63852`

## What is implemented

- `Code` is a first-class left-navigation destination and workspace surface. Cline remains an
  internal runtime detail and is never named by product-owned UI.
- The landing combines the animated Neuramesh mark, a compact connection state, recent Code
  threads, and the same composer used by an active task. History and new-task actions live in this
  column rather than spending editor width on a second permanent thread rail.
- The composer column is horizontally resizable. Its project and Model selectors reuse the shared
  Neuramesh picker/chip vocabulary, open upward, match the Plan/Act control height, and truncate
  independently at the minimum width.
- The selected project determines both the repository eligible for a new thread and the inherited
  developer model. A thread can override that one execution model through a direct catalog picker;
  configured providers are enabled, unavailable providers stay visible and disabled, and Connect
  opens Workspace provider settings. A project/repository mismatch fails closed in the browser and
  on the machine.
- Creating a Code task applies a navigation request only once, so a stale All threads selection
  cannot reclaim focus from the newly created task.
- Code messages accept staged files and images. Attachments are chunked over the relay, assembled
  outside the repository with count/size/total limits, passed to the SDK as user files/images, and
  removed from machine temp storage after the turn.
- An active thread uses the implementation-harness layout model: conversation/composer left, code
  evidence right.
- Plan and Act are session-owned modes. Plan is structurally unable to edit or execute commands.
- When a Plan turn reaches a write or command, the machine emits a typed mode-block event. A completed Plan creates the same handoff when the model correctly stops before requesting a forbidden tool. A contextual gate above the composer can switch to Act and submit the continuation in one click; workspace policy denials remain separate and cannot be bypassed by this handoff.
- Session permissions expose Read files, Edit files, Execute commands, Fetch web content, and Use MCP servers at the composer.
- Recommended defaults auto-approve repository reads and ask before every side effect.
- The effective decision is made on the machine and intersects the mode ceiling, machine-loaded workspace/locked policy, the thread preference, and the machine sandbox contract. Browser preferences can narrow access but cannot widen machine policy.
- Act shows the complete multi-file patch before approval, then gates verification commands separately.
- Applied files, a durable Work Plan, and coordinated checkpoints are visible in the editor pane.
- Code requests provider-native reasoning at the SDK's portable low/default-thinking posture,
  avoiding routine-task latency from heavier reasoning defaults. Provider-supported reasoning
  streams into one live disclosure; unsupported providers continue with ordinary text. The
  disclosure collapses when a tool or answer begins, remains reopenable after the turn, and never
  renders provider-redacted reasoning payloads. Assistant prose streams in the same transcript
  entry rather than duplicating the final answer.
- The Code transcript adapts the MIT interaction patterns from AI CSS' Thinking + Reasoning and
  Task List components to Neuramesh's controlled data model. The package demos' sample sentences,
  timers, and typewriter are deliberately not mounted: the relay's accumulated deltas drive the
  live text, relay timestamps drive the folded thought duration, and machine tool receipts drive
  progress rows. Completed activity folds into a compact summary; failures stay expanded. The
  durable Work Plan renders numbered steps as neutral todos and honors only explicit Markdown
  checked/in-progress markers, so the presentation never guesses task completion.
- Checkpoint restore rewinds the harness file state and conversation cursor.
- The UI works in Graphite and Cream Oak. Decisive actions use the constant Neuramesh brand/ink
  pair in every theme, including hover; selection/status surfaces retain the theme-local accent.
- At phone widths, explicit code-workspace and return-to-conversation controls accompany the horizontally snapped panes; the editor is not gesture-only.
- Production web opens a dedicated JSON lane over the existing authenticated, reconnecting relay socket; terminal relay behavior is unchanged.
- The connected machine hosts Cline Core, resolves the selected repository inside the authenticated machine workspace, and assigns every Engineering thread a retained Git worktree and `nm/engineering/<actor>/<thread>` branch.
- Existing Cline history is discovered only when authenticated actor, repository, and Neuramesh thread identity all match. One active mutating relay channel owns an actor/thread at a time. Browser session presentation is retained locally while the machine-side Cline transcript and worktree remain authoritative for execution continuity.
- Workspace API-key credentials are resolved machine-side. Provider secrets, unrestricted command output, and repository contents are not persisted by the browser adapter.
- The code pane is reconciled from the authoritative machine worktree Git diff after Cline tool completion and checkpoint restore, so formatter/script changes and new/deleted files do not depend on reconstructing tool arguments in the browser.

The local harness is intentionally labeled. It is active in the preview renderer, or in the web client with:

```text
?engineeringHarness=1
```

Without that explicit flag, web uses the real Cline relay. If no eligible machine, repository remote, or Anthropic/OpenAI/Gemini API-key credential is available, Engineering renders the relay's actionable unavailable/error state and does not simulate execution.

## Runtime boundary

[`engineering-protocol.ts`](../../../apps/desktop/src/engineering-protocol.ts) is the shared browser-to-machine wire contract. The machine host maps:

| Neuramesh operation | Cline Core operation |
|---|---|
| create session | `ClineCore.start` |
| send turn | `ClineCore.send` |
| session events | Core subscription/events |
| mode + permissions | session config + complete `toolPolicies` manifest |
| approve/deny | Core `requestToolApproval` result |
| checkpoint restore | Core checkpoint APIs with workspace and message restoration |

The manifest and Neuramesh approval callback are deny-by-default: every registered native tool is classified, unknown tools are disabled, Plan mode rejects writes and commands at the machine boundary, and the recommended defaults auto-approve only repository reads. Cline's VS Code state service and webview are not imported.

## Relay guarantees in this slice

The implemented boundary provides:

1. authenticated browser and machine attachment through the shared relay socket;
2. an opaque Engineering JSON lane isolated from terminal byte streams;
3. commands buffered until the relay channel is attached, avoiding first-prompt loss;
4. Plan mutation attempts rejected by the machine-side approval decision;
5. unknown tools disabled even when Cline adds a new runtime tool;
6. complete edit proposals surfaced before approval and commands approved independently;
7. per-thread retained worktrees so relay disconnects cannot destroy uncommitted work;
8. Cline checkpoint restore coordinating workspace files and transcript messages;
9. provider credentials resolved and consumed on the connected machine;
10. the relay overwrites client-authored actor identity with the authenticated browser principal;
11. repository selection is scoped to the machine workspace before clone/open;
12. projected Cline snapshots and 128 KiB newline-framed chunks keep large events below the relay's 1 MiB frame limit without losing event boundaries;
13. authoritative Git changes are emitted after every completed tool call, including command-driven mutations.
14. project-repository membership is published into the machine replica and asserted by the local
    harness before the first Code prompt.

Cross-device discovery of Engineering thread cards is deliberately still browser metadata; reopening a known thread rehydrates its machine-side Cline history. Promoting thread discovery and presentation history into Neuramesh's cloud thread index is the next collaboration increment, not a hidden fallback in this slice.

## Current evidence

- focused domain/navigation tests cover recommended defaults, Plan immutability, complete
  pre-approval patches, separate edit/command gates, auto-approval, policy precedence,
  decline/resume, checkpoint restore, one-shot nav selection, tool classification, and unknown-tool
  denial;
- focused protocol, policy, host, workspace, reducer, and domain tests pass, including locked-policy enforcement, foreign-workspace rejection, exact checkpoint restoration, and command-created files;
- real browser → hub → machine-edge tests cover terminal and Engineering JSON channels, authenticated actor injection, duplicate thread leases, and a 1.1 MB Cline event without disconnecting the machine;
- desktop TypeScript typecheck passes;
- production web and shared preview builds pass;
- a real OpenAI Core (`gpt-5.5`) browser flow exercised Code home → model selection → Pomodoro
  Plan → one-click Act continuation → edit/command approval → three passing Python tests on the
  Docker-backed PowerSync web stack. The authoritative final worktree contained only
  `src/pomodoro.py` and `test/test_pomodoro.py`; the unrelated greeting fixture was not modified;
- `engineeringHarness=1` was verified as an explicitly labeled, deterministic local mode; ordinary web is wired only to the production relay adapter;
- Graphite and Cream Oak were visually inspected at 1200px, the three-pane layout at 1600px, the compact split at 850px, and the snapped conversation/editor controls at 650px, with no document/body overflow.
- the full desktop suite passes (1,124 tests), TypeScript typecheck passes, desktop and web
  production builds pass, and the live PowerSync sync configuration validates against the Docker
  service.

The repository has a pre-existing Vite CSS minifier warning around the marketing scroll-point block. It is not introduced by Engineering OS and remains visible in build output; it should be fixed in its own scoped change rather than normalized as noise.

## The desktop client (2026-09-04)

The desktop app composes the same relay bridge the browser uses (`src/bridge/desktop-relay.ts`,
docs/42 "The desktop is the second client"), so Code reaches a machine from the app you downloaded
the way it reaches one from a browser. The runtime hook awaits the bridge's readiness before
deciding, and its reasons are per client: no relay configured, no cloud machine yet, or the
machine's own sentence when it has no engineering host. Making the desktop a Code *host* is the
next slice (`docs/design/desktop-code-bridge-2026-09/plan.md`, slice B).
