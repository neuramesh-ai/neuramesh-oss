# Starter brain, web sign-in, and credits — build inventory

> **Status:** research + inventory, 2026-08-28. Answers George's four-part ask of the same date.
> Companion to [plan.md](plan.md) (the round's design contract), [architecture.md](architecture.md)
> (the platform/credential contract), and [rollout.md](rollout.md) (what is actually deployed).
> **Nothing here is built.** Every "exists" claim carries a `file:line`; every price and policy
> claim carries a source and an access date; anything I could not verify says so and says how.

---

## 1. The four asks, restated precisely

**Ask 1 — provider sign-in that a BROWSER user can complete.**
Today a member connects their Claude Pro/Max or ChatGPT Plus subscription by running a CLI
command *on the machine that will use it* (`claude setup-token`, `codex login --device-auth`,
`gh auth login`). A browser user has no terminal, so on the web this step is currently
**impossible to finish** — the wizard records the *intent* and defers
(`OnboardingKeys.tsx:29-31`, decided in the round-4 mockup). The ask: what flow closes that
loop, and does any of it exist? The short answer, developed in §3: **the answer is different per
vendor** — OpenAI can be closed with a web panel and no terminal at all, Anthropic can only be
closed with a terminal, and Google's consumer lane no longer exists to close.

**Ask 2 — a skippable brain step, and a starter brain behind it.**
A user with no subscription and no API key must be able to (a) finish onboarding and (b) get a
*real* first reply — not the echo stub — running on a cheap platform-provided Google model
called with **our** Google key, **server-side**. Two separable things: unblocking the step, and
supplying a brain for the workspace that skipped it.

**Ask 3 — an onboarding-items tracker.**
A persistent component (George: "likely bottom-right") listing what is left to do *after* the
wizard ends. "Connect a brain" is item one. This is the shipped surface for what plan.md calls
"progressive setup cards" (plan.md:357-359) and what the approved mockup draws as the
setup-cards row (`mockups/onboarding-cloud-first.html:441-455`).

**Ask 4 — a credit system.**
New users get a base allocation. Usage of the platform model draws it down; later, machine-hours
and storage draw from the same balance. Recorded as the meter's destination in plan.md:361-369.

**The one sentence that ties them together:** asks 2 and 4 are the same feature seen from two
ends — you cannot honestly give away a platform model without a meter, and you cannot build a
meter without deciding *where the model call happens*. That decision (§5.2) is the single
highest-leverage fork in this document.

---

## 2. What already exists

### 2.1 Capability table

| Capability | Where it lives (`file:line`) | What it does | What it does **not** do |
| --- | --- | --- | --- |
| **Credential resolve (server)** | `packages/control-api/src/app.ts:794-799` | `GET /v1/credentials/resolve?workspace&provider&agentId` → `{ token, authMode, source, autoFailover }`. Returns the **raw** key. | **No workspace-membership check.** Any actor that passes the `/v1/*` gate can resolve any workspace's key by uuid. Contrast `fleet-lifecycle.ts:125`, which *does* check. No plan/quota guard. No metering. |
| **Credential storage** | `pgstore.ts:2645-2673`; schema `supabase/migrations/0006_provider_credentials.sql`, `0037_provider_auth_mode.sql` | `provider_credentials` (workspace- or agent-scoped, `provider` is free-form `text`, `auth_mode ∈ {apikey, subscription}`, token nullable for subscription markers). Not in the PowerSync publication. | No notion of a *platform-owned* credential. No per-credential quota, no usage counter, no expiry. |
| **Credential write** | `packages/control-api/src/handler/credential.ts:43-69` | `credential.set` command, **human-only** (`:44`); token never enters the events log (`:52`). | Cannot be set by a machine or agent — so no self-service "give this workspace the starter key" path exists. |
| **Credential → machine** | `apps/desktop/src/main/agents.ts:254-293` (`resolveToken`) | Daemon fetches the workspace/agent credential over HTTP, merges it with this machine's CLI-login detection and env keys. | Sends `x-nm-actor` as the *owner human* (`:267`) — not a machine token — so the call is indistinguishable from a human's. |
| **Auth decision (pure)** | `apps/desktop/src/main/runtime/authpolicy.ts:45-69` (`decideAuth`) | The policy: prefer subscription; never silently bill a key; `blocked` when a preferred subscription is down and failover is manual. | Has **no** "platform/starter" auth mode. Its three outcomes are `subscription`, `apikey`, `none`. |
| **Key → child process** | `apps/desktop/src/main/runtime/adapter.ts:209-216` (`providerEnv`), allowlist at `:149-158` | Child env is built from an **allowlist**, so no provider key leaks by inheritance; exactly one key is injected (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`). | Is a *machine-side* mechanism by construction. Anything routed through it **is on the machine**. |
| **The no-brain fallback** | `apps/desktop/src/main/host/wake.ts:234-235`; `agents.ts:299-302` (`echoTurn`) | `mode = cred.authMode !== 'none' ? 'claude' : 'echo'`. With no credential the agent posts *"set an Anthropic key … for real replies."* | This is exactly the experience ask 2 exists to delete. |
| **"Free Gemini" today** | `apps/desktop/src/main/host/orchturn.ts:49-53`; `agents.ts:2021-2034` | The in-process Gemini orchestrator transport falls back to `process.env.GEMINI_API_KEY` **of the daemon** when no credential resolved. | This is *the operator's own env var on the box*, not a platform-held, per-workspace, metered key. It is **unmetered, uncapped, and invisible to the server**. It also only serves the **in-process** transport: `agentBaseEnv` strips it from every spawned CLI (`adapter.ts:149-158`), so a Gemini *worker* cannot use it. |
| **Machine-minute meter** | `packages/control-api/src/fleet-lifecycle.ts` (whole file); `supabase/migrations/0128_machine_usage.sql` | `machine_usage (workspace_id, day, minutes)`, PK `(workspace_id, day)`, RLS deny-all, **not** in the PowerSync publication. `machineSweep` (`:63-89`) meters → cap-stops → idle-stops in that order; `bumpMachineWake` (`:38-52`) refuses to wake a free workspace at/over the cap; `GET /v1/machines/usage` (`:120-132`) reads today's minutes + the applicable cap. | Meters **only wake-minutes**. No tokens, no storage, no money, no balance, no grant, no rollover. Cap is a hard daily integer from `FREE_STARTER_MINUTES_PER_DAY` (default 60, `:30-33`). |
| **The sweep's cadence** | `packages/control-api/vercel.json` (`/internal/machine-sweep`, `*/5`) + `sweepIntervalMin()` `fleet-lifecycle.ts:23-26` | Cron and env must agree or the meter drifts (said out loud at `:21-22`). | — |
| **Plan truth + billing** | `packages/control-api/src/billing.ts`; `supabase/migrations/0045_workspace_plan.sql:10-16` | `workspaces.plan ∈ {free, cloud}`; the Stripe webhook is the **only** writer (`billing.ts:5`, `app.ts:329`); `planPatchFromEvent` (`billing.ts:71-111`) is pure and unit-tested. | Two plans only. No usage-based line item, no metered Stripe price, no balance, no overage. |
| **Plan limits** | `packages/shared/src/entitlements.ts:24-27, 42-59` | Attachment limits + `FREE_SEAT_CAP = 3`, one module so client/server/main never drift. | Explicitly scoped to attachments; the note at `:6-7` says the project/machine/teammate caps stay at their call sites. |
| **Where limits are ENFORCED** | `handler/project.ts:55-56` (3 projects) · `handler/workspace.ts:82-86` + `pgstore.ts:527` (seats, incl. pending invites) · `handler/schedule.ts:49` (schedules are Cloud-only) · `pgstore.ts:3172, 3179` + `store/memory.ts:217-219` (attachments) · `fleet-lifecycle.ts:43, 79` (machine minutes) | All server-side, all raising `PLAN_LIMIT` → HTTP 402 (`errors.ts:37, 97`). **The doctrine holds today.** | Nothing meters or limits *model usage*. |
| **Token counts** | `apps/desktop/src/main/host/turnkit.ts:70-72, 152`; `runtime/codexsdk.ts:69` | Per-turn `input_tokens`/`output_tokens` are read from the SDK and written to the **machine-local** `agent_logs` activity feed (machine-local per `supabase/migrations/0058_beats.sql:3`). | **They never reach the server.** There is no column, table, endpoint, or aggregate for model usage anywhere in `supabase/migrations/`. A credit system metering tokens starts from zero. |
| **Machine identity** | `packages/control-api/src/machine-auth.ts:15-20, 68-80`; `app.ts:469-478`; `supabase/migrations/0127_machine_tokens.sql` | `nmm_` bearer, sha-256 at rest, resolves to `{ actor, machine: { id, workspaceId, kind } }`. | The middleware **discards `resolved.machine`** — `app.ts:476` sets only the actor. No endpoint can bind its answer to the calling machine's workspace today. |
| **Cloud machines** | `supabase/migrations/0126_cloud_machines.sql` | `machines.kind ∈ {local, member, runner}`, `lifecycle`, `desired_replicas`, `resources jsonb`, `idle_stop_min`, one runner per workspace (partial unique). Synced to clients (`dev/stack/powersync/sync-config.yaml:26`). | `resources` is unused for billing. No storage-size column is metered. |
| **Runner autoprovision** | `handler/workspace.ts:58-68` | `FLEET_AUTOPROVISION=on` → `workspace.create` births the runner row. | **Held off deliberately** until starter limits exist (rollout.md:267-269). This document is that blocker. |
| **nm-relay (the browser terminal's transport)** | `packages/relay/**` (hub, protocol, machine-client, validate); `packages/control-api/src/relay.ts:20-63`, registered at `app.ts:425` | Stateless WSS hub. Protocol already speaks `open{cols,rows} · data · resize · close` (`protocol.ts:1-26`) — the exact vocabulary the desktop terminal uses. Machine edge auths with `nmm_`, browser edge with a Clerk bearer + membership check. | **SHIPPED 2026-08-30 — this column is history.** The relay is deployed (`nm-relay` in `nm-system`, public at `relay.neuramesh.app`), the machine edge spawns a real node-pty behind a bash jail (`apps/desktop/src/main/relay/`), the browser client is wired (`relay-client.ts`, behind `VITE_NM_RELAY_URL`), and `RELAY_SECRET` is set on Vercel and matched by `nm-relay-secret` in-cluster. See [docs/42](../../42-browser-terminal-and-relay.md). |
| **The desktop terminal being re-homed** | `apps/desktop/src/main/sync/ipc/terminals.ts:42` (`nm:terminal-open`, jailed zsh PTY); client `apps/desktop/src/renderer/src/wtabs/guests.tsx:79-100` | xterm.js ↔ bridge, `open/data/resize/close`. `@xterm/xterm` v6 + fit addon already in `apps/desktop/package.json:116-117`. | Electron-only (`ipcMain`). The web bridge does not implement it. |
| **The machine image** | rollout.md:114 | Ships `claude-code 2.1.233 · codex 0.146.1 · gemini-cli 0.38.2 · gh`, linux/amd64. | — |
| **Onboarding wizard** | `apps/desktop/src/renderer/src/views/Onboarding.tsx`; steps in `views/Onboarding*.tsx`; web order at `:37` | Five steps; web order `Workspace · Machine · Keys · Team · Launch`. Workspace is minted at its own step on web (`:112-128`). | **The Keys step gates.** `canContinue` is `anyReady` on that step (`:234`), and the Launch effect refuses to create anything without `anyReady` (`:137`). The comment at `:228-229` claiming "Step 2 (providers) no longer gates: the orchestrator runs free on Gemini out of the box" is **stale and contradicts the code three lines below it.** The hint text already promises the fix: *"a curated free pack is coming soon"* (`OnboardingKeys.tsx:57`). |
| **Model catalog** | `packages/shared/src/model-packs.ts:20-33` (`CURRENT_MODELS`), `:36-45` (`LEGACY_MODELS`, `MODEL_ID_SET`), `:135-176` (`PACKS`); labels `apps/desktop/src/renderer/src/lib/modelcatalog.ts:14-18`; server allow-list derives at `commands.ts:22` | One closed set of model ids; `providerForModel`/`runtimeForModel` derive by family prefix (`:48-63`); packs are role→model maps with an activation predicate. | Offers **no current cheap Google model**. `CURRENT_MODELS.gemini` is `['gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite']` — and 3.1-flash-lite already has a **published shutdown date of 2027-05-07** (§4). Neither `gemini-2.5-flash-lite` nor `gemini-3.5-flash-lite` is offerable today. |
| **Pack activation gate** | `pgstore.ts:2691-2694` (`enabledProviders`) | Returns the providers with a workspace-scoped credential row. | **Dead code server-side** — its only callers are `store/contract.ts:454` and a test (`test/model-packs.pg.test.ts:106`). Pack activatability is enforced **client-side only** (`isPackActivatable`, `Onboarding.tsx:100`). A starter pack must not rely on it. |
| **Derived-not-stored queue** | `packages/shared/src/needsyou.ts:1-30` | Home's needs-you queue is derived from synced rows + timestamps so every client agrees and nothing is stored. | The precedent ask 3 should follow. |
| **Bottom-right chrome** | `apps/desktop/src/renderer/src/shell/chrome.tsx:198-219` (`.dockbarproc` / `DockBar`); CSS `tokens.css:5149, 5159` | A right-anchored dock cluster with an upward popover. | **Only mounts in top-dock nav mode** (`chrome.tsx:210-212`; docs/33:39-42 — "the bottom dock strip retired"). There is no universal bottom-right slot. Floating precedents: `.updatecard.floating` (`tokens.css:3613`, bottom-**left**) and `.wtpeek` (`tokens.css:5023`, bottom-right but whiteboard-scoped). |
| **Setup-flow idiom** | `packages/shared/src/setupflows.ts` (registry + `SetupProgress`); docs/39 | An abandonable wizard becomes a `kind='setup'` task; progress is *derived from the profile*, never from UI state. | Keyed by **channel kind**. There is no workspace-level flow, so ask 3 cannot be a data entry in this registry as it stands. |

### 2.2 The two findings that change the design

**(a) plan.md's starter-credential sentence contradicts itself.** plan.md:352-356 says the first
reply runs on *"a platform-held key resolved through the existing `/v1/credentials/resolve`
lane"* and, in the same paragraph, that this is *"server-side only, never on machines."*
Those cannot both be true. `/v1/credentials/resolve` exists **to hand the raw token to a daemon**
— `app.ts:797-798` returns `token`; `agents.ts:266` fetches it; `adapter.ts:211-214` injects it
into the agent child's env; architecture.md:109-111 states the contract explicitly ("the key
rides `providerEnv` into the child process env"). Route the platform key through that lane and
the platform key **is on the machine**, in a process the customer's agent controls, on a box we
provision but whose workload is user-directed. It is also, at that point, **unmeterable** —
nothing downstream counts tokens (see the token-counts row above).

This is the fork in §5.2. It is not a nitpick: it decides whether ask 4 can be enforced
server-side at all, which the doctrine ("invariants live in the server, never in prompts")
requires.

**(b) `/v1/credentials/resolve` has no tenant check.** It reads `workspace` from the query
string and returns the raw stored key to any caller that clears the `/v1/*` gate
(`app.ts:794-799`). Today that is a pre-existing tenant-isolation gap on *users' own* BYOK keys.
Put a platform key behind the same endpoint and it becomes **free model access for anybody with
an account and a workspace uuid**. The fix is small and independent: the middleware already
computes `{ machine: { id, workspaceId, kind } }` (`machine-auth.ts:76-79`) and throws it away
(`app.ts:476`); stash it, then require *either* human membership (the `fleet-lifecycle.ts:125`
pattern) *or* `machine.workspaceId === workspace`.

---

## 3. The policy constraint on item 1

### 3.1 Verdict

Two *different* shapes get confused under "browser sign-in", and the vendors treat them
differently. **Shape A** — we run the OAuth client and a token reaches our servers (even if we
then forward it to the user's machine). **Shape B** — the user completes the vendor's own flow
on the vendor's own domain, and the resulting token lands only on the user's machine, never
touching us.

| Vendor | Shape A (platform-hosted OAuth) | Shape B (user-completed, token only on their machine) | Mechanism that exists |
| --- | --- | --- | --- |
| **Anthropic** (Pro/Max) | **PROHIBITED**, by name | **PERMITTED in principle** — the carve-out explicitly covers a platform *hosting* Claude Code | **No device-code flow exists.** `claude login` uses a hardcoded `localhost:54545` loopback; the only headless variant is the browser-shows-a-code / **paste-into-the-terminal** fallback → **needs a terminal** |
| **OpenAI** (ChatGPT plans) | **PROHIBITED** (general credential-sharing clause; nothing Codex-specific) | **PERMITTED** — built, documented, and exposed as an SDK call | `codex login --device-auth`: the code is entered **in the browser**, and the Codex SDK exposes it programmatically (`verification_url` + `user_code` + `wait()`) → **needs no terminal** |
| **Google** (AI Pro/Ultra) | **PROHIBITED**, by name, enforced with account bans | **PROHIBITED** — no carve-out of any kind exists | Moot: the consumer path was **shut off 2026-06-18** |

**Sources, all accessed 2026-08-28.** Anthropic: [legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)
(§Authentication and credential use; §Can customers offer Claude Code in their products?),
[authentication](https://code.claude.com/docs/en/authentication),
[Agent SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart),
[Consumer Terms](https://www.anthropic.com/legal/consumer-terms) (eff. 2025-10-08),
[Commercial Terms](https://www.anthropic.com/legal/commercial-terms) (eff. 2025-06-17);
[claude-code#22992](https://github.com/anthropics/claude-code/issues/22992) (device flow requested
2026-02-04, still open), [#42765](https://github.com/anthropics/claude-code/issues/42765) (loopback
host hardcoded). OpenAI: [Codex auth docs](https://learn.chatgpt.com/docs/auth),
[Codex SDK](https://github.com/openai/codex/tree/main/sdk/python),
[Terms of Use](https://openai.com/policies/row-terms-of-use/) (eff. 2026-01-01),
[Service Terms](https://openai.com/policies/service-terms/) (upd. 2026-06-12),
[account-sharing policy](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy).
Google: [Code Assist individuals deprecation](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals),
[Antigravity Additional ToS §6](https://antigravity.google/terms),
[Gemini CLI ToS](https://geminicli.com/docs/resources/tos-privacy/),
[API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy).

Operative wording below is **paraphrased** — read the sources for the exact clauses before
relying on them commercially. The one clause worth quoting verbatim, from Anthropic's
legal-and-compliance page: developers *"may not collect, store, or intermediate Claude.ai
credentials or session tokens."*

### 3.2 Anthropic — the carve-out is real, and it has conditions

Anthropic's legal page prohibits a third party collecting, storing, or intermediating Claude
credentials or session tokens, and requires that signing in to a Claude account complete through
Anthropic's own flow. It then carves out, in terms, an end user signing in to the **unmodified**
Claude Code binary with their own subscription — and says this holds *including where a platform
hosts Claude Code*. The conditions attached: the binary must not be modified; the host may not
remove, disable, or restrict any authentication method built into it; the host may not pay for,
resell, or intermediate Claude usage on end users' behalf; and hosting requires agreeing to the
Commercial Terms. (Whether that acceptance is self-serve or a signed agreement is **not stated —
verify with Anthropic.**)

Three consequences that change our build:

1. **There is no device-code flow to use.** `claude setup-token` prints a one-year OAuth token
   to a terminal; `claude login` opens a browser to a hardcoded `localhost:54545` callback,
   unreachable from a cloud pod; the documented headless fallback is the browser showing a code
   that the user **pastes into the terminal**. Anthropic's own devcontainer/Codespaces guidance
   prescribes exactly this. **So the relay PTY is not one option among several — it is the only
   mechanism that exists.**
2. **"Paste your `setup-token` into our web form" is dead.** That is collection and storage by
   us — the prohibited shape. Note the tension worth flagging: Anthropic's docs bless storing
   that same token as a *Codespaces secret*, presumably because GitHub is not offering Claude as
   its product. **Unclear for a product like ours.**
3. **Relaying the authorization code through our web terminal is the gray zone.** The relay does
   not *store* the token, but it does *transport* the code. No document answers whether that
   counts as intermediating. plan.md:249-253 asserts the browser terminal satisfies the rail;
   that assertion is **reasonable but unblessed**. This is the specific question the W4
   written-confirmation thread (plan.md:327-329) should put to Anthropic, in writing, before GA.

**And a correction plan.md owes itself.** plan.md:255 calls the rail *"the unmodified binary"* —
but the harness drives Anthropic through **`@anthropic-ai/claude-agent-sdk`** (verified call
sites: `host/orchturn.ts:91`, `chatturn.ts:106`, `turnkit.ts:6, 128, 167`, `deepwork.ts:61, 99`,
`marketing-research.ts:40`, `chattools.ts:32-33`), while the machine image installs the actual
CLI (`infra/images/machine/Dockerfile:15-18`, `@anthropic-ai/claude-code@2.1.233`). Anthropic's
Agent SDK quickstart states that, absent prior approval, third-party developers may not offer
claude.ai login, and names Agent-SDK-built agents specifically — directing them to API keys.
**If subscription auth is the plan, the cloud machines must drive the `claude` binary for those
turns, not the SDK**, and plan.md:255 should say which it means. This is not hypothetical: the
2026-01 enforcement wave was server-side client fingerprinting, and a 2026-05 Agent-SDK billing
change was postponed (2026-06-16) — a postponement, not permission.

### 3.3 OpenAI — the one genuinely browser-completable lane

`codex login --device-auth` is documented for headless devices, and the code is entered **in the
user's browser on OpenAI's domain**, not in the terminal. The CLI polls; the token lands in
`~/.codex/auth.json` on that machine. Better still, the official Codex SDK exposes the flow
programmatically — `login_chatgpt_device_code()` returning a verification URL, a user code, and
a `wait()` — so **we can render the URL and code in our own web UI and never handle the token.**

OpenAI's terms carry no Codex-specific prohibition. The operative constraint is the general one:
do not share account credentials or make your account available to someone else. A device-code
login the user completes themselves, whose token resides only on their own machine, shares
credentials with nobody. **But note the asymmetry honestly: OpenAI's position is
permission-by-silence, not an explicit carve-out like Anthropic's. It could change without a
docs diff.**

Two operational gotchas: the flow is **beta**, and device-code login is **off by default** — the
user must enable it in ChatGPT → Settings → Security (workspace admins control it for teams). The
onboarding must detect and handle "device code login is disabled" rather than hanging.

**"Sign in with ChatGPT"** (launched 2026-08-02, beta, six partners) is an **identity** product —
name, email, profile picture. It conveys **no inference entitlement** and cannot run Codex on the
user's subscription. Do not build on it for this. *(Partner list and scopes are from press
coverage, not OpenAI's own developer page — unverified; check developers.openai.com.)*

### 3.4 Google — the premise is gone, and we have a live exposure

Google stopped serving Gemini CLI requests for all consumer tiers (Code Assist for individuals,
AI Pro, AI Ultra) on **2026-06-18**; the Login-with-Google option is gone. Separately,
Antigravity's Additional ToS §6 makes using third-party software, tools, or services to access
the Service a breach of the agreement, naming a third-party harness on Antigravity OAuth as the
example, with **no unmodified-binary or user-signs-in-themselves exception anywhere**. The Gemini
CLI ToS page says the same about third-party tools on Gemini CLI OAuth, calling it grounds for
suspension or termination. Enforcement is real: paying AI Ultra subscribers were banned in
Feb–Mar 2026.

**This implicates the shipped desktop product today, not just the cloud round.** The Google
runtime maps to Google's **`agy`** (Antigravity) binary — `runtime/cli.ts:17-20`, `bin: 'agy'`,
`pkg: ''` — spawned under the **user's own Google OAuth** with no API key, and NeuraMesh
persistently **merges an MCP shim into agy's global `~/.gemini/config/mcp_config.json`**
(`runtime/orchmcp.ts:129`, `runtime/gemini.ts:136`; designed and disclosed in
docs/decisions.md:83, caveat 4). That is precisely the shape §6 names. plan.md:258-260 already
routes Google to API-key/Vertex **on cloud machines**; the same reasoning applies to the desktop
path and currently does not. **This is a founder-level risk decision, not an engineering one.**

*(A smaller, unrelated bug found while verifying: the machine image installs
`@google/gemini-cli@0.38.2` (`Dockerfile:18`), but `ensureCli('gemini')` resolves the **`agy`**
binary (`cli.ts:17-20`, and `orchturn.ts:177`). On a cloud machine the Gemini CLI lane therefore
cannot resolve its binary at all — the image ships the wrong one. It reinforces §5.2's
conclusion: on cloud machines the Google lane is the in-process SDK or a proxy, never the CLI.)*

### 3.5 What that means, concretely

George's prior holds, sharpened: **no platform-hosted OAuth for any vendor** — but the *fallback
is not the same for all three*.

- **Anthropic → browser terminal, no alternative.** nm-relay is a hard prerequisite, and the
  gray-zone question above should be settled in writing.
- **OpenAI → no terminal required.** A plain web panel rendering the device-auth URL and code
  (SDK-driven, machine-side) is compliant, simpler, and could ship **before** the relay.
- **Google → neither.** API key / Vertex only, which is exactly why Google is the right
  *starter-brain* provider (§4): it is the one vendor whose sanctioned lane is a key we may
  legitimately hold.

The relay flow, as plan.md §3.6 and architecture.md §4 design it and the mockup draws it
(`mockups/onboarding-cloud-first.html:444`):

> browser → xterm.js → `nm-relay` WSS → the member's own machine → `claude` / `gh` completes the
> vendor's own flow → token lands on `/nm/home`, never on our servers.

**Prior art confirms there is no shortcut.** Every hosted product either tells you to run
`claude setup-token` on your own laptop and paste `CLAUDE_CODE_OAUTH_TOKEN` into a dashboard
(Coder's registry module, Depot), or accepts API keys only (E2B, Daytona, Cursor; Factory.ai's
BYOK works in CLI and desktop but *not* in its hosted web/mobile surfaces), or is first-party
(Claude Code on the web, Codex cloud). Zed — the closest analogue — tells subscription users to
run Anthropic's own CLI in a terminal inside Zed rather than through Zed's agent protocol. The
unmodified binary in a terminal is the industry's answer because it is the only answer.

**The nm-relay gap is bigger than the "landed" label suggests:**

| # | Gap | Evidence |
| --- | --- | --- |
| 1 | `RELAY_SECRET` unset on Vercel → `/internal/relay/validate-*` return 403 | rollout.md:249-251 |
| 2 | ~~Relay process not deployed~~ — **CLOSED 2026-08-30**: Deployment, Service, Gateway and managed cert all live; see [docs/42](../../42-browser-terminal-and-relay.md) | `infra/k8s/cluster/overlays/gke/relay-deployment.yaml`, `relay-gateway.yaml` |
| 3 | Machine edge is an **echo** pty, not a shell | `packages/relay/src/machine-client.ts:5, 27` |
| 4 | No browser terminal client (no `attach` handshake, no xterm mount on web) | only `webnm.ts:3` naming L3 as "later" |
| 5 | No surface that opens it (machine page / setup card) | — |

Items 3 and 4 are genuinely small: the protocol already carries the right frames
(`protocol.ts:1-26`) and both endpoints already exist in working form —
`ipc/terminals.ts:42` on the machine side, `wtabs/guests.tsx:79-100` on the client side. This is
a re-hosting, not a design.

**But the OpenAI lane does not need any of it.** Because the Codex SDK exposes the device-auth
flow programmatically, a machine-side call returning `{ verification_url, user_code }` plus a
plain web panel is a complete, compliant ChatGPT sign-in with **no terminal, no PTY, no relay**.
That is a materially smaller first slice than the browser terminal, and it should ship first —
it proves the surface, gives web users one real subscription lane, and de-risks the relay work.
(It rides the existing command/HTTP lane; the only new machine-side piece is the SDK call and a
poll.)

**One thing to check in P2 that no amount of reading settles:** whether a subscription sign-in
completes from a **datacenter IP**. It is already on the round's verify list
(architecture.md:219, "the round's existential check"). If a vendor rate-limits or blocks
datacenter-origin device flows, ask 1 fails on infrastructure rather than policy, and the
fallback is BYOK — which is exactly why the starter brain and the key lane must not depend on it.

---

## 4. Model choice for the starter brain

### 4.1 `gemini-1.5-flash` is gone

George named it; it is **shut down**, not deprecated. It no longer appears on Google's
deprecations table or models page — the shape Google uses *after* shutdown. `gemini-1.5-flash-002`
carried a discontinuation date of **2025-09-24**; live calls 404 with
`models/gemini-1.5-flash is not found for API version v1beta`, on paid tier and new projects
alike. The whole 2.0 generation (`gemini-2.0-flash`, `-flash-lite`) shut down **2026-06-01**.
Sources: [ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
and [/docs/models](https://ai.google.dev/gemini-api/docs/models), accessed 2026-08-28.

### 4.2 The live cheap lineup

Paid tier, per 1M tokens, from [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing),
accessed **2026-08-28**:

| Model | Input | Output | Cached input | Context | Shutdown announced |
| --- | ---: | ---: | ---: | --- | --- |
| **`gemini-2.5-flash-lite`** | **$0.10** | **$0.40** | $0.01 | 1M | none |
| `gemini-3.1-flash-lite` | $0.25 | $1.50 | $0.025 | 1M *(unverified)* | **2027-05-07** → 3.5-flash-lite |
| **`gemini-3.5-flash-lite`** | **$0.30** | **$2.50** | $0.03 | 1M in / 64K out | none |
| `gemini-2.5-flash` | $0.30 | $2.50 | — | 1M | none |
| `gemini-3.5-flash` | $1.50 | $9.00 | $0.15 | 1M | none |

Audio input is priced higher on several rows (irrelevant here). Batch is a flat 50% discount but
is async — useless for a first interactive reply. Context-length surcharges apply only to Pro
models, not to any Flash/Flash-Lite row.

### 4.3 The two candidates

| | `gemini-2.5-flash-lite` | `gemini-3.5-flash-lite` |
| --- | --- | --- |
| Input / output per 1M | $0.10 / $0.40 | $0.30 / $2.50 |
| TTFT · throughput | **0.28 s** · 312 tok/s | 9.11 s · 346 tok/s *(TTFT includes thinking)* |
| Artificial Analysis Intelligence Index | 7 | **37** |
| Agentic evals | none published — **unverified** | SWE-Bench Pro 54.2% · OSWorld-Verified 74.0% · Terminal-Bench 2.1 54% |
| Thinking default | **off** | **on ("minimal")** — thinking tokens bill at the **output** rate |
| Released | 2025-07-22 | 2026-07-21 |

Latency/intelligence from [artificialanalysis.ai](https://artificialanalysis.ai/models/gemini-3-5-flash-lite),
benchmarks from [deepmind.google/models/gemini/flash-lite](https://deepmind.google/models/gemini/flash-lite/),
thinking-token billing from [ai.google.dev/gemini-api/docs/thinking](https://ai.google.dev/gemini-api/docs/thinking)
(*"Response pricing is the sum of output tokens and thinking tokens"*) — all accessed 2026-08-28.

### 4.4 Recommendation

**`gemini-3.5-flash-lite`, pinned to `thinking_level: "minimal"`, with `gemini-2.5-flash-lite`
kept in the catalog as the cheap fallback.**

The starter brain is not a chat toy — it drives the **orchestrator tool loop**
(`orchturn.ts:54-83`: function declarations, up to 14 tool rounds, the whole `contents` array
re-sent every iteration). An Intelligence Index of 7 vs 37 is not a rounding difference at that
job, and 2.5-flash-lite has **no published function-calling score at all**. A model that
mis-calls tools costs *more* than the cheap one saves: each failed round re-sends ~12k tokens of
static payload (§4.5). Buy the model that lands the first turn.

Two guardrails on that recommendation:

- **Pin thinking to minimal and measure TTFT.** The 9.11 s TTFT figure includes the thinking
  phase. Our budget is *signup → first agent reply <60 s p95* (plan.md:313). If minimal thinking
  does not get first-token under a couple of seconds on our prompt, fall back to
  `gemini-2.5-flash-lite` **for the first reply only** and let the 3.5 seat take over once the
  conversation has a tool loop to run. Verify by instrumenting the proxy (§5) before GA.
- **Do not build on `gemini-3.1-flash-lite`**, cheaper output notwithstanding: it is the one
  Flash-Lite with a shutdown date already on the calendar. It is also the one currently in our
  catalog (`model-packs.ts:32`) — a separate, pre-existing thing to fix.

### 4.5 What it costs us per free user

**Grounded, not guessed.** The repo measures its own static prompt payload
(`apps/desktop/src/main/promptmeter.ts`, budgets in `prompts-ratchet.json`):

- orchestrator contract: **13,270 chars ≈ 3.3k tok**
- triage tool registry: **33,450 chars ≈ 8.4k tok**
- → **≈ 11.7k tokens of static payload per orchestrator model call**, before any transcript.
  (The ratchet's own doc line says the instruction surface had grown to *"~16k tokens per
  orchestrator wake"*.)

Model one "first reply" as a 3-call tool loop, with the full `contents` array re-sent each call
(which `orchturn.ts:59-82` does):

| | in (tok) | out (tok) |
| --- | ---: | ---: |
| call 1 (static + prompt) | 12,500 | 300 |
| call 2 (+ tool result) | 13,500 | 300 |
| call 3 (final text) | 14,500 | 500 |
| **total** | **40,500** | **1,100** |

| Model | per reply | 30 replies/mo | 100 replies/mo |
| --- | ---: | ---: | ---: |
| `gemini-3.5-flash-lite` (no thinking) | **$0.0149** | $0.45 | $1.49 |
| `gemini-3.5-flash-lite` (+1.5k thinking tok) | **$0.0186** | $0.56 | $1.86 |
| `gemini-2.5-flash-lite` | **$0.0045** | $0.14 | $0.45 |

**Assumptions, stated so they can be falsified:** 3 calls per reply and the output-token counts
are **estimates** — only the input side is measured. Instrument the proxy (§5) and replace this
table with real numbers before setting the grant size. Two levers exist if the number hurts:
**context caching** (cached input is $0.03 vs $0.30 on 3.5-flash-lite — a 10× cut on the ~12k
stable prefix, but cache storage bills **$1.00 per 1M tokens per hour**, so it only pays on hot
multi-turn sessions), and a **trimmed starter registry** (a starter workspace does not need the
full 33k-char triage belt on turn one).

Headline: **a free user costs well under a dollar a month in model spend at plausible volume.**
The expensive thing on the free tier is the machine (plan.md:415: ≈$9.9–14.9/member/mo, *"the
PVC dominates"*), not the brain. That asymmetry should shape the credit design (§5.5) and the
grant size.

### 4.6 Two terms constraints, both actionable

1. **Use the PAID tier, non-negotiably.** On unpaid Gemini API usage Google *"uses the content
   you submit … to provide, improve, and develop Google products"* and human reviewers may read
   it; on paid, it does not. We would be relaying customers' prompts and code. Free tier is
   disqualifying regardless of price. ([Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms), accessed 2026-08-28.)
2. **Auth-key migration lands ~September 2026 — days away.** Per the
   [API key docs](https://ai.google.dev/gemini-api/docs/api-key) (accessed 2026-08-28),
   unrestricted standard keys are already rejected and standard keys stop working entirely;
   auth keys are bound to a Google Cloud service account. **A platform-held key is exactly this
   migration's target.** Check what key type the account holds *before* building on it — this
   belongs in the PR's `## Deploy notes`.

Nothing in Gemini's Use Restrictions bars serving many end users from one platform key (the
restrictions cover competing-model development, reverse engineering, medical use, and safety
bypass), and the API-key docs positively recommend *"a backend proxy server to make the actual
API calls"* — the §5.2 architecture. The one narrow resale clause applies to **Grounding with
Google Search** results, so a starter brain that uses search grounding acquires a display
constraint that a plain-generation one does not.

---

## 5. The credit system

### 5.1 What the prior art says about vocabulary

(Sources accessed 2026-08-28: [Cursor's June-2025 pricing post](https://cursor.com/blog/june-2025-pricing) ·
[Replit effort-based pricing](https://replit.com/blog/effort-based-pricing-recap) ·
[GitHub Copilot premium requests](https://docs.github.com/copilot/concepts/copilot-billing/understanding-and-managing-requests-in-copilot) ·
[Devin session insights](https://docs.devin.ai/product-guides/session-insights) ·
[v0 pricing](https://vercel.com/blog/updated-v0-pricing).)

- **Abstraction is not the failure mode; unquotable conversion is.** Copilot's "premium request"
  is fully abstract and works, because the multiplier is a published integer **shown next to each
  model at the moment you pick it**. Replit's checkpoint is abstract and failed, because the
  agent decides the price and you learn it afterwards.
- **Dollar-anchoring won.** v0 moved *messages → token-metered dollar credits*; Cursor moved to
  raw dollars; Replit prices checkpoints in dollars. Keep the word "credits" (it lets you grant,
  discount, and expire without implying cash refundability) but **print the dollar equivalent**.
- **Don't blend meters into one unit.** Devin's ACU folds VM time + inference + bandwidth into
  one number, and the result is that nobody can tell *which* meter burned them — the one piece of
  information that lets a user change behaviour. Three named lines, one currency.
- **Never say "unlimited."** That single word cost Cursor a refund cycle and a public apology
  ("*not communicated clearly*", Michael Truell, 2025-07-04).
- **Default the overage budget to $0.** Copilot rejects rather than bills once the budget is
  unset — the strongest anti-surprise mechanism found.
- **Free tier: monthly refill, no rollover.** Every subscription product converged there and
  nobody's backlash was about no-rollover. A *one-time* signup grant reads as a trial
  (AWS/GCP/E2B) — correct if that is the message, wrong if the allocation is meant to feel like
  part of the product.

### 5.2 The fork that decides everything: where does the model call happen?

| | **A. Key ships to the machine** (plan.md's literal words) | **B. Metered proxy** (recommended) |
| --- | --- | --- |
| Mechanism | `/v1/credentials/resolve` returns the platform key → `providerEnv` → agent child | New `POST /v1/starter/generate`; control-api holds the key and calls Google; the daemon never sees it |
| Change on the machine | none (it already works this way) | the Gemini transport (`orchturn.ts:52`) points at our endpoint instead of `GoogleGenAI` directly |
| Metering | **impossible server-side.** Tokens land in machine-local `agent_logs` and stop there. Only self-reported counts could exist. | **exact.** Usage comes back in the same response we return; the meter write is the same transaction. |
| Key custody | the platform key sits in a user-directed agent process | key never leaves control-api |
| Blast radius if abused | an unbounded Google bill on our account | a 402 |
| Doctrine fit | violates "invariants live in the server, never in prompts" — the cap becomes a client-side promise | matches every existing guard (`PLAN_LIMIT` at the write path) |
| Matches plan.md's stated intent (*"server-side only, never on machines"*) | **no** | **yes** |

**Recommend B.** It is also what Google's own docs recommend for a platform key ("run a backend
proxy server"), and it makes ask 4 enforceable rather than aspirational. The cost is one new
endpoint and one branch in the daemon's Gemini transport — genuinely small, because the daemon
already has a provider-dispatch seam (`agents.ts:2025-2034`).

Note what B does **not** need: no change to `provider_credentials`, no change to `providerEnv`,
no change to `decideAuth`'s three modes for BYOK users. The starter lane is additive.

### 5.3 Proposed schema

Next free migration number is **0129** (`0128_machine_usage.sql` is the highest; never renumber).

```sql
-- 0129_credits.sql

-- the balance. one row per workspace, read on every metered write, so it is a PK lookup
-- and never an aggregate over the ledger.
create table workspace_credits (
  workspace_id   uuid primary key references workspaces (id) on delete cascade,
  granted_micros bigint      not null default 0,   -- lifetime granted, µUSD (1e-6 USD)
  spent_micros   bigint      not null default 0,   -- lifetime spent, µUSD
  period_start   date        not null,             -- the monthly-refill anchor
  updated_at     timestamptz not null default now(),
  check (granted_micros >= 0 and spent_micros >= 0)
);
alter table workspace_credits enable row level security;   -- deny-all (0100 posture)

-- every grant, auditable. "why does this workspace have credits" must always have an answer.
create table credit_grants (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid   not null references workspaces (id) on delete cascade,
  micros       bigint not null check (micros > 0),
  kind         text   not null check (kind in ('signup','monthly','promo','manual','purchase')),
  rate_version text,                                -- the rate card in force when granted
  note         text,
  created_at   timestamptz not null default now()
);
create index credit_grants_ws on credit_grants (workspace_id, created_at desc);
alter table credit_grants enable row level security;

-- the DAILY ledger stays exactly where it is: machine_usage is already (workspace, day).
-- storage_gb_hours is defined now and written later, so the meter is not designed as if
-- minutes were the only axis (plan.md:361-369).
alter table machine_usage
  add column model_calls      int    not null default 0,
  add column model_in_tokens  bigint not null default 0,
  add column model_out_tokens bigint not null default 0,
  add column model_micros     bigint not null default 0,
  add column machine_micros   bigint not null default 0,
  add column storage_gb_hours numeric not null default 0,
  add column storage_micros   bigint not null default 0;
```

**Why reuse `machine_usage` rather than invent a ledger:** it is already the per-(workspace, day)
row, already written by one owner (the sweep), already RLS-deny-all, already out of the PowerSync
publication, and its comment already says it is *the* meter. plan.md:366-367 predicted exactly
this ("a per-(workspace, day) ledger that a storage column joins naturally"). The daily row is the
**breakdown**; `workspace_credits.spent_micros` is the **running total** the guard reads. One
worth renaming later; not in this round.

**Units.** Internal: `bigint` **micro-dollars** — integer math, no float drift, one unit for three
meters. User-facing: **1 credit = $0.01**, printed with the dollar equivalent beside it (§5.1).

### 5.4 The rate card

A versioned data module in `packages/shared`, mirroring `entitlements.ts` and `model-packs.ts`
so client, server, and daemon cannot drift:

```ts
// packages/shared/src/rates.ts  (sketch — shape, not final numbers)
export const RATE_CARD_VERSION = '2026-09';
export const MICROS_PER_CREDIT = 10_000;            // 1 credit = $0.01
export const STARTER_MODEL = 'gemini-3.5-flash-lite';
export const MODEL_RATES: Record<string, { inPerMTok: number; outPerMTok: number }>; // µUSD
export const SIGNUP_GRANT_MICROS: number;
export const MONTHLY_GRANT_MICROS: number;
export function priceModelCall(model: string, inTok: number, outTok: number): number;
```

Every rate change is a version bump plus a dated line in this doc — the "pre-announce every rate
change" lesson from §5.1.

**What a credit buys, concretely**, at `gemini-3.5-flash-lite` list price and 1 credit = $0.01:

| 1 credit ($0.01) buys | |
| --- | --- |
| input tokens | ~33,000 |
| output tokens | ~4,000 |
| **starter replies** (§4.5 model) | **~0.67** — i.e. **a reply ≈ 1.5 credits** |

So a **$5 / 500-credit** signup grant ≈ **~330 starter replies**, costing us ~$5 in the worst
case where every credit is spent. A **$2 / 200-credit** grant ≈ ~130 replies. Pick against the
funnel, not against the cost — the model spend is not the expensive part (§4.5).

### 5.5 What a credit buys across all three meters — and why v1 should meter only one

| Meter | Cost basis | v1 |
| --- | --- | --- |
| **Model tokens** (platform brain) | Google list price, known exactly, priced per call | **draws credits.** This is ask 4's first meter. |
| **Machine minutes** | Real cost is ≈$9.9–14.9/member/mo, and **the PVC dominates** (plan.md:415) — it bills while the pod is scaled to zero. A per-minute rate derived from compute would *under-price it by design*. | **keeps its existing daily minute cap** (`FREE_STARTER_MINUTES_PER_DAY`, enforced at `fleet-lifecycle.ts:43, 79`). Shown in the same three-line panel, in minutes, honestly labelled as a separate allowance. |
| **Storage GB-days** | Unmeasured today; `machines.resources` holds no billed size. | **named, columns added, not written.** |

This is the honest v1 and it is exactly what George asked for ("usage of the platform model (and
**later** machine-hours + storage)"). Converting machine time into credits before P2 telemetry
exists would mean inventing a rate — the thing this document refuses to do. The columns land now
so the meter is not *designed* as if minutes were the only axis.

### 5.6 Where enforcement lives

Three chokepoints, all server-side, all raising the existing `PLAN_LIMIT` → 402:

1. **`POST /v1/starter/generate`** (new) — refuses when `granted_micros - spent_micros <= 0`;
   meters the call it just served. This is the *only* place the platform key exists, so it is
   the only place model credit can be spent. A guard here cannot be routed around, which is the
   whole point of choosing option B.
2. **`bumpMachineWake`** (`fleet-lifecycle.ts:38-52`) and **`machineSweep`**'s cap-stop
   (`:72-80`) — already enforce the minute cap; when the machine meter joins credits (later),
   the same two statements learn the balance predicate. No new enforcement surface.
3. **`GET /v1/usage`** (extend `/v1/machines/usage`, `fleet-lifecycle.ts:120-132`) — returns the
   three named lines + balance + rate-card version, with its existing membership check
   (`:125`) intact. Read-only; it enforces nothing and must never be the thing a client trusts
   to stop itself.

And one **fix that is a prerequisite, not a nicety**: the tenant check on
`/v1/credentials/resolve` (§2.2b). Whatever else happens, a platform-owned credential must never
sit behind an endpoint that hands raw tokens to any authenticated caller.

### 5.7 What the user sees

Following §5.1's lessons and the approved mockup (`mockups/onboarding-cloud-first.html:448-452`,
already drawn as *"Starter compute · 23 min used of 60 today"* with a bar and a zero-guilt
upgrade link):

- **Three named lines, never one blended number:** Brain (credits) · Machine (minutes) ·
  Storage (when it lands).
- **The rate at the point of choice** — the Copilot pattern: the model picker shows what the
  starter brain costs per reply, in credits.
- **Cost stamped after the fact** on the run, not only in a dashboard — the repo already carries
  per-turn token counts to the activity log (`turnkit.ts:152`); surfacing them is a short hop.
- **Balance + run-rate + days-remaining**, because a balance alone cannot express a leak.
- **At the limit: replies queue with an honest line, never a hard wall mid-conversation** —
  the mockup's own words, and the "surfaced kindly, never as a mid-conversation wall" contract
  in plan.md:334-335.

---

## 6. Build inventory

Ordered so slice 1 ships alone and unblocks `FLEET_AUTOPROVISION`.

### Slice 1 — the starter brain and its meter (unblocks free signup)

| # | What | New/change | Size | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **Tenant guard on `/v1/credentials/resolve`** — stash `resolved.machine` in the `/v1` middleware (`app.ts:476`) and require human membership *or* `machine.workspaceId === workspace` | change | **S** | — (ship first, independently) |
| 2 | **Rate card** `packages/shared/src/rates.ts` — versioned µUSD rates, `STARTER_MODEL`, grant sizes, `priceModelCall` | new | **S** | — |
| 3 | **Migration 0129** — `workspace_credits`, `credit_grants`, the `machine_usage` columns (§5.3). Not in the PowerSync publication (operator data, the `/v1/workspaces` doctrine) | new | **S** | 2 |
| 4 | **`POST /v1/starter/generate`** — the metered proxy: platform key server-side, balance guard → 402, meter write in the same transaction, `x-nm-credits-remaining` on the response | new | **M** | 1, 2, 3 |
| 5 | **Signup grant** — `credit_grants` row at `workspace.create` (the `FLEET_AUTOPROVISION` hook's neighbour, `handler/workspace.ts:58-68`) | change | **S** | 3 |
| 6 | **Daemon: route the starter lane through the proxy** — a branch in `dispatchOrchestrator` (`agents.ts:2025-2034`) / `geminiOrchestratorTurn` (`orchturn.ts:52`) that calls `/v1/starter/generate` with the machine token instead of `GoogleGenAI` with a local key. **Delete the `process.env.GEMINI_API_KEY` fallback** (`orchturn.ts:52`) on cloud machines — it is the unmetered hole | change | **M** | 4 |
| 7 | **Starter auth mode** — a fourth outcome in `decideAuth` (`authpolicy.ts:45-69`) so `wake.ts:235` stops choosing `echo` for a starter workspace, and `authBlockedCard` never fires for it | change | **S** | 6 |
| 8 | **Catalog: add the starter model** — `CURRENT_MODELS.gemini` (`model-packs.ts:32`) + a `MODEL_LABELS` entry (`modelcatalog.ts:17`); server allow-list derives free (`commands.ts:22`). Also retire `gemini-3.1-flash-lite` from `CURRENT_MODELS` into `LEGACY_MODELS` (published shutdown 2027-05-07) | change | **S** | — |
| 9 | **Starter pack** — a `starter` entry in `PACKS` seating the starter model on the roles a brand-new workspace actually wakes (orchestrator first), so the Team step has real brains to show | change | **S** | 8 |
| 10 | **Un-gate the Keys step** — `canContinue` at `Onboarding.tsx:234` and the launch guard at `:137`; a "Continue on the starter brain" affordance; fix the stale comment at `:228-229`; replace `OnboardingKeys.tsx:57`'s "coming soon" with the real thing | change | **S** | 9 |
| 11 | **`GET /v1/usage`** — extend `/v1/machines/usage` (`fleet-lifecycle.ts:120-132`) to the three named lines + balance + rate version, membership check intact | change | **S** | 3 |
| 12 | **Starter meter UI** — the mockup's meter strip (`onboarding-cloud-first.html:448-452`), reading item 11 over HTTP (not PowerSync — `machine_usage` is deliberately unsynced) | new | **S** | 11 |
| 13 | **Monthly refill** — a cron pass (the `cron-routes.ts` / `machine-sweep` idiom, `vercel.json`) writing a `kind='monthly'` grant and moving `period_start`; no rollover | new | **S** | 3 |

### Slice 2 — the onboarding-items tracker (ask 3)

| # | What | New/change | Size | Depends on |
| --- | --- | --- | --- | --- |
| 14 | **`onboardingItems()` — a pure derivation** in `packages/shared` (the `needsyou.ts:1-30` precedent): from synced rows + `/v1/usage`, derive `{ id, label, done, action }` for *connect a brain · connect your subscription · invite teammates · connect GitHub · install desktop*. Derived, never stored, so every client agrees | new | **M** | 11 |
| 15 | **Tracker component** — renders item 14. **Placement is a genuine fork** (§7 Q4): the approved mockup draws it as an in-page setup-cards row after the first reply (`onboarding-cloud-first.html:441-455`), while George asked for bottom-right; the shell's bottom-right dock only mounts in top-dock nav mode (`chrome.tsx:210-212`, docs/33:39-42). Both themes | new | **M** | 14 |
| 16 | **docs/33 entry** for whatever floating idiom item 15 lands (design-system contract, same PR) | change | **S** | 15 |

### Slice 3 — browser provider sign-in (ask 1)

**3a — OpenAI first, no relay needed** (§3.3, §3.5):

| # | What | New/change | Size | Depends on |
| --- | --- | --- | --- | --- |
| 17 | **Machine-side device-auth start/poll** — call the Codex SDK's `login_chatgpt_device_code()` on the target machine, return `{ verification_url, user_code, expiresAt }`, poll to completion; the token lands in `~/.codex/auth.json` and never transits control-api | new | **M** | — |
| 18 | **Web sign-in panel** — renders the URL + code, polls for completion, handles the *"device code login is disabled"* case by walking the user to ChatGPT → Settings → Security (it is **off by default**) | new | **S** | 17 |

**3b — the browser terminal (Anthropic's only path, and `gh`):**

| # | What | New/change | Size | Depends on |
| --- | --- | --- | --- | --- |
| 19 | **`RELAY_SECRET` on Vercel** + the relay Deployment/Service/WSS Gateway in `infra/k8s/` | change | **S** | — |
| 20 | **Real PTY on the machine edge** — replace `connectEchoMachine`'s echo (`packages/relay/src/machine-client.ts:27`) with the node-pty spawn re-homed from `ipc/terminals.ts:42`, keeping the ZDOTDIR jail machine-side | change | **M** | 19 |
| 21 | **Browser terminal client** — xterm mount + `attach` handshake + `open/data/resize/close`; implement `openTerminal`/`openTerminalCwd` in the web bridge (`webnm.ts`). `@xterm/xterm` v6 already a dependency; `wtabs/guests.tsx:79-100` is the client to mirror | new | **M** | 19 |
| 22 | **The sign-in surface** — the setup card / machine page that opens the terminal preloaded with `claude` (code-paste fallback) or `gh auth login`, plus the copy the mockup already wrote (`onboarding-cloud-first.html:444`) | new | **S** | 15, 21 |
| 23 | **Anthropic written confirmation** — put the §3.2 gray-zone question (does relaying the authorization code through our web terminal count as intermediating?) and the Commercial-Terms acceptance question to Anthropic. plan.md:327-329 already owns this thread | verify | **S** | — (open now) |
| 24 | **Drive the `claude` binary, not the Agent SDK, for subscription turns on cloud machines** (§3.2) — and correct plan.md:255 to say which it means | change | **M** | 23 |
| 25 | **Datacenter-IP verification** — confirm each vendor's flow completes from a pod (architecture.md:219). Evidence, not assumption; if it fails, ask 1 falls back to BYOK and §4's starter lane carries more weight | verify | **S** | 20 |

**3c — the Google exposure that already exists** (§3.4, not part of ask 1 but surfaced by it):

| # | What | New/change | Size | Depends on |
| --- | --- | --- | --- | --- |
| 26 | **Decide the `agy` posture.** Antigravity ToS §6 has no third-party carve-out and Google has banned paying subscribers over this shape; NeuraMesh spawns `agy` under the user's Google OAuth (`runtime/cli.ts:17-20`) and merges an MCP shim into agy's global config (`runtime/orchmcp.ts:129`). Options: keep and accept the risk · disclose harder · retire the OAuth lane to API-key/Vertex (what plan.md:258-260 already does for cloud) | **founder decision** | — | — |
| 27 | **Machine-image CLI mismatch** — the image installs `@google/gemini-cli` (`Dockerfile:18`) but `ensureCli('gemini')` resolves `agy` (`cli.ts:17-20`). Fix or drop the Google CLI lane on cloud machines | change | **S** | 26 |

### Slice 4 — the remaining meters

| # | What | New/change | Size | Depends on |
| --- | --- | --- | --- | --- |
| 28 | **Machine minutes → credits** — price minutes from measured P2 per-member cost, not from a guess; fold the balance predicate into `bumpMachineWake`/`machineSweep` | change | **M** | 13, P2 telemetry |
| 29 | **Storage meter** — write `storage_gb_hours` from PVC size × uptime; price it | change | **M** | 28 |
| 30 | **Overage / purchase** — a metered Stripe price and `kind='purchase'` grants; **default the overage budget to $0** (§5.1) | new | **M** | 13 |

### Deploy notes this round will owe its PRs

- Migration 0129 (auto-applies on prod deploy).
- New Vercel env: the platform Google key + `RATE_CARD_VERSION`-adjacent config; `RELAY_SECRET`
  for slice 3b.
- **Verify the Google key is an *auth key*, not a standard key** — standard keys stop working
  ~September 2026 (§4.6).
- `FLEET_AUTOPROVISION` may flip to `on` once slice 1 lands — that is the gate rollout.md:267
  names.
- No sync-rule change (nothing new is synced). If that changes, confirm the
  `Deploy sync rules … → success` **step**, never the check's ✓.

---

## 7. Open questions for George

**Q1 — the metered proxy vs shipping the key (§5.2).** Do we accept a new
`/v1/starter/generate` endpoint, or do we ship the platform key to the machine as plan.md's
sentence literally reads? *Recommend the proxy.* It is the only version where the credit cap is
a server invariant rather than a client promise, it matches plan.md's own "never on machines"
intent, it is what Google's docs recommend, and it turns "unbounded bill" into "a 402". Cost: one
endpoint, one daemon branch.

**Q2 — starter model: `gemini-3.5-flash-lite` or `gemini-2.5-flash-lite`?** *Recommend
3.5-flash-lite pinned to minimal thinking*, at ~3× the price of 2.5-flash-lite and ~$0.019 per
reply — because the starter brain drives a tool loop and 2.5-flash-lite has no published
function-calling score. The fork is real if TTFT disappoints: measure first-token latency against
the <60 s onboarding budget on our actual prompt, and keep 2.5-flash-lite catalogued as the
fallback.

**Q3 — grant size and shape.** *Recommend a monthly refill, no rollover, ~200–500 credits
($2–$5)* ≈ 130–330 starter replies. A monthly refill reads as part of the product; a one-time
signup grant reads as a trial. Both are defensible — the question is what message you want the
free tier to send. The model spend is not the constraint (§4.5); the machine is.

**Q4 — where the tracker lives (§6 item 15).** You said bottom-right; the approved round-4
mockup draws it as an in-page setup-cards row after the first reply, and the shell has no
universal bottom-right slot (the bottom dock strip was retired in the shell round; only top-dock
mode keeps one). *Recommend: honour the approved mockup for the first-run row **and** add a
persistent, dismissible floating card* — the `.updatecard.floating` idiom, mirrored to the right —
that reappears until the list is done. That is a docs/33 addition and therefore a design-gate
question, not a build decision.

**Q5 — does the starter brain serve only the orchestrator, or the whole crew?** The cheap
answer is orchestrator-only (chat replies, triage) with real work still requiring a real brain;
the generous answer seats the starter model across the pack. *Recommend orchestrator-only for
v1*: it delivers the first reply the ask is about, keeps the burn predictable, and makes
"connect a brain" a genuine next step rather than an upsell for something already working.

**Q6 — the machine meter's vocabulary.** Credits and minutes coexist in v1 (§5.5). *Recommend
keeping them visibly separate* until P2 telemetry can price a machine-minute honestly. Blending
them early would be the Devin-ACU mistake: one number nobody can act on.

**Q7 — the Anthropic thread now has two specific questions, not a posture.** plan.md:327-329
carries this as W4's open thread. §3.2 turns it into concrete asks: (a) does relaying the
authorization code through our hosted web terminal count as *intermediating*, given that
Anthropic's own devcontainer guidance prescribes the same paste over a browser-rendered terminal?
(b) is the Commercial-Terms acceptance that hosting requires self-serve or a signed agreement?
*Recommend opening it now* — it does not block slices 1, 2, or 3a, but it gates 3b's value and
item 24 (SDK vs binary), and written answers take weeks.

**Q8 — ship OpenAI sign-in before the relay?** §3.3 found that the Codex SDK exposes device auth
programmatically, so a ChatGPT sign-in needs a web panel and no terminal at all. *Strongly
recommend yes.* It is the smallest possible slice that makes ask 1 partly true, it gives web
users one real subscription lane immediately, and it de-risks the relay work by proving the
surface first. The only cost is that Anthropic — the priority subscription (plan.md:443) — still
waits for the terminal.

**Q9 — the `agy` / Antigravity exposure (§3.4).** This is the one item here that is not about
the cloud round: the shipped desktop product drives Google's Antigravity CLI under the user's
own consumer OAuth and writes into its global MCP config, against a ToS §6 that names that shape
as a breach with no carve-out, enforced with bans on paying subscribers. *Recommend retiring the
Google OAuth lane to API-key/Vertex* — the same call plan.md:258-260 already made for cloud
machines — and treating the desktop divergence as an oversight rather than a decision. It is
your call, not an engineering one, which is why it is here and not in the inventory as a task.

---

## Appendix — what I could not verify

| Claim | Status | How to verify |
| --- | --- | --- |
| §3's vendor-terms table | Verified against primary sources **2026-08-28** (URLs in §3.1), and consistent with the round's own 2026-08-26 pass. Still **volatile** — vendor auth policy moved three times in 12 months | Re-fetch the §3.1 URLs before GA and before quoting externally. |
| Whether relaying an auth code through our web terminal is "intermediating" | **Not addressed by any document.** The single most consequential unknown in this doc | Ask Anthropic in writing (their legal page routes auth questions to sales). Inventory item 23. |
| Whether hosting Claude Code needs a *signed* Commercial Terms agreement or self-serve acceptance | Not stated | Same conversation. |
| OpenAI's permissiveness | **Permission-by-silence**, not an explicit carve-out. Weaker than Anthropic's written exception and could change without a docs diff | Re-read OpenAI's Terms of Use / Service Terms before GA. |
| "Sign in with ChatGPT" partner list and scopes | From press coverage, not OpenAI's developer docs | developers.openai.com. Irrelevant to this design either way — it conveys no inference entitlement. |
| Antigravity Additional ToS version | The page prints **no date** | Wayback, or ask Google for the versioned document. |
| `sk-ant-oat01-*` tokens reportedly rejected with "OAuth authentication is currently not supported" ([claude-code#28091](https://github.com/anthropics/claude-code/issues/28091), Feb 2026) while `setup-token` is still documented | Contradictory public signals | Mint one and use it before designing around it. |
| Output-token counts in §4.5 | **Estimated.** Only the input side is measured (`prompts-ratchet.json`) | Instrument `/v1/starter/generate` and log real `usageMetadata` per call for a week. |
| `gemini-3.1-flash-lite` context window | Google's models page no longer renders per-model limit tables in fetchable form | Check the model card in AI Studio. |
| Gemini free-tier RPM/TPM limits | Not published — the rate-limits page defers to AI Studio | Read them in AI Studio on the actual project. Irrelevant if we use paid tier, which §4.6 says we must. |
| Whether `gemini-2.5-flash-lite` can drive our tool loop | No published function-calling benchmark | Run our own orchestrator turn against it before adopting it as a fallback. |
| Subscription device-flow completion from a datacenter IP | Open on the round's own verify list (architecture.md:219) | P2, arm A. |
| Google's "for professional or business purposes, not for consumer use" line | Section placement **unverified** — surfaced in one pass of the terms page, not reproduced on targeted re-fetch | Worth a lawyer's eye before a consumer free tier launches. |


---

## 8. Settled (George, 2026-08-28)

| Question | Decision |
| --- | --- |
| Grant size | **500 credits ($5) at signup, refilling monthly, no rollover** |
| Starter model | **`gemini-3.5-flash-lite`**, pinned to minimal thinking |
| Where the model call happens | **Metered proxy** — the key stays in control-api; balance guard and meter write in one transaction |
| Credit vocabulary | Credits, with dollars beside them; micro-dollars internally |
| Meters | Three named lines (Brain · Machine · Storage), never one blended number |
| Starter brain scope | **Orchestrator only** — worker agents wait for a real brain |
| Tracker placement | **In-room card** this round; the floating pill only if it is earned |
| `agy` posture (item 26) | **Keep as-is (George, 2026-09-03).** Google is opening broader third-party-harness access, so the desktop lane stays exactly as it works today and users keep using their Gemini subscriptions. Cloud machines stay API-key/Vertex until `agy` is installed in the machine image (item 27 becomes "install agy", not "drop the lane"). |
| Anthropic open question | **CLOSED.** Subscriptions are per-user, never shared — that is the rail's core requirement, and the design already satisfies it (each member signs into their own machine through the vendor's own flow). The *separate* standing item — whether the Agent SDK lane needs written approval — is unchanged and unrelated to this round. |

**Round 2 of the mockup**, from George's review:
- the house-brain lane is **two lines**, value-first — the long explanation was doing the work
  a single sentence should
- **no per-reply pricing anywhere**: a per-message rate makes a free product feel like a taxi
  meter, and it is a number nobody can act on in the moment. The **balance** is the honest unit
- therefore the balance needs one **always-visible** home: a **credit ring in the nav's bottom
  bar**, left of the account avatar (the workspace's balance, beside the person spending it).
  It depletes visibly, warms below a fifth, and opens the three-line detail on click
