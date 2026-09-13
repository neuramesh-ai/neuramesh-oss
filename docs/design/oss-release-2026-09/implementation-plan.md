# Source release: implementation plan

> **Status: ready to start, 2026-09-12. George answered yes to the five questions the same day (D10 to
> D14), named the repo `neuramesh-ai/neuramesh-oss` (D15), asked for a Local to Cloud move (D16, unit
> U7), and ruled that the app installs the container runtime itself, never a compose command in the UI
> (D17).** This is [plan.md](plan.md) with the amendments from
> [review.md](review.md) applied, cut into plan-first units (docs/41) with legs, files, tests, evidence,
> and deploy notes, on a calendar from Monday 2026-09-14 to Sunday 2026-09-27. The founder cap is 22
> hours and this plan spends about 17.5. The visual contract is the canvas beside this file: run
> `node build.mjs`, open `index.html` (or serve the folder). Every unit that draws a pixel names the
> artboards it builds to. Nothing here is built.

## 0. The one-paragraph version

Seven units, stacked. **U1a** stops the bill on day one and touches no existing user. **U2** ships the
local stack as an image plus a compose file with a real identity: a per-install bearer for the human,
machine tokens for the agents, and the header lane closed. **U3a** puts Local mode in the desktop with
one foreground connection and every connection live, the six stack states, the Upgrade to Pro sheet,
and Settings › Connections. **U4** makes the tree publishable. **U1b** is the hosted write gate, merged
behind a flag and flipped on after the notice period, with the export beside it. **U5** is the words on
the site and in the app. **U6a** is the snapshot. **U3b**, the rail with LOCAL and CLOUD bands, is the
one stretch, unlocked only if U3a lands by Wednesday 2026-09-23.

## 1. Amendments adopted from the review

| Finding | Change in this plan |
|---|---|
| F1 Local identity forgeable | Header lane closed everywhere. `nmh_` human bearer minted at seed, moved to the keychain by the desktop. Agents on `nmm_`. `nm-config` carries no ids. New `GET /v1/me`. (U2, U3a) |
| F2 D9 sized 10 plus 27, is 236 | One foreground connection, every connection live. Handlers read `connections.current()`. The rail unions. Opening a row on another connection swaps the foreground in place. (U3a, U3b) |
| F3 Docker Desktop is not free for everyone, and D17 no compose in the UI | Use a running engine when there is one. Otherwise ask which runtime and install it: Colima by default, unattended, no password. Start a stopped runtime without asking. Manual setup stays in Settings and `docs/local-mode.md`. Local mode labelled alpha until L2. (U3a, U4, U5) |
| D16 A local workspace moves to Cloud | A batched import into an existing Pro workspace through the export lane, storage-gated, idempotent by client-minted ids. (U7) |
| F4 Export promised, absent. Legal page contradicts | `GET /v1/workspaces/:id/export`. Notice email 14 days before the gate flips. `legal.tsx` with an effective date. Gate flag flips 2026-09-29. (U1b, U5) |
| F4b Seats never reach Stripe | Invite accept and member removal update the subscription quantity. (U1a) |
| F5 Window | S3 split into U3a (release gate) and U3b (stretch). Calendar in §3. |
| F6 Typed messages vanish in a shell | The composer is replaced by the gate card on a `free` hosted workspace. Artboard E. (U3a) |
| F7 Version skew | Compose rendered with the app's version as the image tag. Pull and up on tag change. `nm-config` returns `version` and `schemaVersion`. Sixth state, Update. Artboard A6. (U2, U3a) |
| F8 Invisible data | Bind mounts under `~/.neuramesh/local`. Show in Finder in Settings. Never `down -v`. (U2, U3a) |
| F9 Three containers forever | `compose stop` on quit, default. Toggle in Settings. The shell renders from the replica first. Artboard D. (U3a) |
| F10 Image and `launch.json` leak | GHCR package private until U6a. `public-scan.sh` greps `/Users/`. (U2, U4, U6a) |
| F11 Words | "Source available", never "open source". `TRADEMARK.md`. README in our words. (U4, U5) |
| F12 Mirror lag | Dispatch-first mirror, five-minute schedule fallback, a comment on the mirrored PR. `pr-land.sh` names the remote. (U6a) |
| F13 Cloud-shaped wizard | Keys step without the starter door. Tracker without cloud rows. No credit ring on Local. Artboard G. (U3a) |
| F14 Stale facts | Fixed in the file:line references below. |

## 2. Units

Every unit is a board task born in `plan_review` with this section as its implementation plan, anchored
to the release thread. Legs are `build → review` unless a design leg is named. Repo-backed, so review
is non-declinable and the PR merges on the human's word. Each PR carries `## Deploy notes`. Agents'
working files go in `.nm-evidence/`.

### U0 · Decisions (founder, Monday morning)

Five one-line answers from review §3, written as lines under the 2026-09-12 entry in `docs/decisions.md`.
Approve the canvas (§4) in the same sitting so U3a and U5 build to a contract. **Founder: 1.5 h.**

### U1a · The bill stops, and Pro is named

**Legs:** build → review. **Owner:** developer, control-api. **Founder: 1 h review plus the deploy.**

Change:
- `packages/shared/src/entitlements.ts:35` `PLAN_LABELS = { free: 'Free', cloud: 'Pro' }`. Callers keep
  `planLabel()`. The in-app sentences that hard-code Individual and Team move in U5.
- `packages/control-api/src/handler/workspace.ts:59-66` no signup grant. `:72-83` no runner at create.
  `member-machines.ts:17` `fleetOn()` stays for dev stacks.
- Webhook `app.ts:324-347` and `billing.ts:79-118`: read the previous plan with `workspacePlan()` before
  `setWorkspacePlan`. When the plan flips `free → cloud`: resolve the owner from `workspace_members`
  where `role = 'owner'`, mint the runner only when no live `kind = 'runner'` row exists, grant
  `CLOUD_SEAT_MONTHLY_CREDITS * seats` once with `grantCredits(..., 'promo', subscriptionId)`. The
  existing pack grant at `:341-346` is untouched.
- `credit-ledger.ts:205-212` refill worklist filters `plan = 'cloud'`. `credits.ts:215` and
  `rates.ts:108` gain a free branch (no `monthlyGrant`, no `nextRefillOn`).
- Seats (F4b): on invite accept (`handler.ts:265`) and on member removal, when `billingEnabled()` and the
  plan is `cloud`, call `stripe.subscriptions.update` with `quantity = memberCount` and prorations. The
  webhook's inbound `quantity` stays the writer of `seats`.
- Enable `invoice.payment_failed` in the Stripe dashboard (docs/07:39).
- Admin script `scripts/tombstone-free-runners.mjs`: parked `runner` rows on `free` workspaces are
  removed so the operator deletes their PVCs (`packages/fleet/src/plan.ts:115`).

Tests (pg lane, each test sets `plan = 'free'` first, because `97-dev-plan.sql` seeds `cloud`):
a new workspace has no machine row and no grant. A `checkout.session.completed` flip mints one runner
and grants once. A redelivered event mints and grants nothing. The refill skips `free` rows. Invite
accept on `cloud` with the Stripe client mocked makes one `subscriptions.update` call with the new
count. `planLabel('cloud') === 'Pro'`.

Deploy notes: Vercel none. Stripe: enable `invoice.payment_failed`. Migration none. Before deploy:
our own workspace is `cloud` and its runner has balance (`cloud-first-2026-08/rollout.md:255`). After
deploy: run the tombstone script once.

### U1b · The hosted write gate and the export (flag off at merge)

**Legs:** build → review. **Owner:** developer, control-api. **Founder: 1 h review, 0.25 h to flip.**

Change:
- A `/v1/*` middleware registered after the auth middleware (`app.ts:486-528`, the one seam), active
  when `NM_HOSTED_FREE_GATE = '1'` and never under `NM_LOCAL`. It resolves the workspace from the route
  or body, and refuses writes on a `free` workspace. Shapes: `/v1/commands` answers `402 PLAN_LIMIT`.
  `/v1/messages`, `/v1/artifacts`, `/v1/whiteboards` (POST and PATCH) answer `409 PLAN_LIMIT`, because
  the uploader drops a 409 and retries anything else while holding downloads (`upload.ts:63-69`).
- The same check inside `executeCommand` (defense in depth, the FSM guard idiom).
- The exemption list, written and tested: every `GET`, `/auth/*`, `/v1/billing/*`, `workspace.create`,
  `machine.register`, `machine.heartbeat`, `/v1/machines/sync-token`, `GET /v1/me`, and the export.
- `GET /v1/workspaces/:id/export`: owner only, human bearer, streams one zip with `threads.jsonl`,
  `messages.jsonl`, `tasks.jsonl`, and every inline artifact. The `exportable()` allowlist in
  `apps/desktop/src/main/harness/brain.ts:307` is the pattern for what never travels.
- First hosted sign-in creates the workspace server-side (`onauth.ts`), then lands on Pro checkout
  (`POST /v1/billing/checkout`, no `trial_period_days`). The wizard runs after the webhook flips the plan.
- The notice email: one template in `packages/shared/src/email/templates.ts`, one script that sends it
  to every hosted owner on `free`, run by the founder on 2026-09-15.

Tests (pg lane): a `free` hosted workspace refuses `task.create` with 402, answers `POST /v1/messages`
with 409, still registers and heartbeats its machine, still serves reads, and exports. The export of a
workspace you do not own is 403. With the flag off nothing changes. Under `NM_LOCAL=1` nothing changes.
A desktop unit test proves the uploader drops the 409 and downloads continue.

Deploy notes: Vercel: `NM_HOSTED_FREE_GATE` set to `0` at merge, flipped to `1` on 2026-09-29 after the
notice period. Migration none.

### U2 · The local stack

**Legs:** build → review. **Owner:** developer, control-api plus `dev/stack`. **Founder: 1.5 h.**

Change:
- `packages/control-api/Dockerfile` (node 22 slim, pnpm deploy of the control-api workspace, runs
  `node scripts/migrate.mjs` then `tsx src/server.ts`). `.github/workflows/control-api-image.yml`
  builds on every `v*` tag and on `main`, pushes to GHCR **as a private package** until U6a.
- `apps/desktop/resources/local/docker-compose.yaml`: `pgvector/pgvector:pg16` with
  `wal_level=logical`, `journeyapps/powersync-service:1.26` (arm64 and amd64 published),
  `ghcr.io/<org>/neuramesh-control-api:${NM_IMAGE_TAG}`. Ports `127.0.0.1:8788:8787` and
  `127.0.0.1:58081:8080`. Bind mounts `${NM_LOCAL_DIR}/pgdata` and `${NM_LOCAL_DIR}/powersync`. No
  `down -v` anywhere.
- `scripts/migrate.mjs`: applies `supabase/validate/auth-shim.sql` when the `auth` schema is absent,
  adopts from `0001`. The image's boot step creates the PowerSync storage role and database
  (`98-storage.sql`) and the publication (`99-publication.sql`).
- `dev/stack/powersync/powersync.yaml` reads the HS256 key, the admin token, the audience, and an
  optional JWKS URI from env. The dev stack keeps its committed values through `.env`. The image ships
  `sync-config.yaml` and mounts it into the PowerSync container.
- `NM_LOCAL=1`: `workspacePlan()` returns full entitlements. The starter brain answers a 503 that says
  bring your own key. Boot seeds one local user and one workspace (idempotent), and mints one `nmh_`
  human bearer (hash on the row, the secret written once to `${NM_LOCAL_DIR}/.env`).
- Identity (F1): `NM_ALLOW_ACTOR_HEADER` defaults to `'0'` everywhere. The control-api `test` scripts,
  `ci.yml:96`, `dev-app.sh`, `dev-e2e.sh`, `verify-shared-compute.sh` set it to `'1'`. `bearer-auth.ts`
  gains the `nmh_` branch beside `nmm_`. `/auth/dev/token` requires the `nmh_` bearer and mints for its
  own `sub` only. `GET /.well-known/nm-config` returns `{ mode, powersyncUrl, version, schemaVersion }`.
  `GET /v1/me` returns the actor and its workspaces.
- `docs/local-mode.md`: the compose file by hand, the env file, the `custom` profile on a server.

Tests: `.github/workflows/local-stack-smoke.yml`: compose up on ubuntu from the image, migrate from
empty, `/healthz` and `nm-config` answer, the local user and workspace exist, the pg lane passes against
the container. Auth: a bare `x-nm-actor` gets 401. An `nmm_` token calling `task.approve_plan` gets
`HUMAN_ONLY`. The `nmh_` bearer succeeds. Unit tests for the `powersync.yaml` render and the header
default. The full suite stays green under the closed default.

Deploy notes: none for the cloud. GHCR package visibility stays private.

### U3a · Local mode in the desktop, one foreground connection

**Legs:** design (this canvas, approved in U0) → build → review. **Owner:** developer, desktop.
**Founder: 4 h across three review sessions.** Builds to artboards **A1 to A6, C1, C2, D, E, G**.

Change:
- `apps/desktop/src/main/localStack.ts`: engine detection (the `docker` CLI on the resolved PATH,
  `runtime/cli.ts:53`, then sockets at `~/.docker/run/docker.sock`, `~/.orbstack/run/docker.sock`,
  `~/.colima/default/docker.sock`, `/var/run/docker.sock`). A running engine is used as found. A
  stopped one is started by the app (`colima start`, `open -a OrbStack`, `open -a Docker`) with the A2
  state, no button. With no engine the picker (A1) asks one question and the **install lane** does the
  rest: Colima by default from pinned, checksummed release assets (Colima, Lima, the Docker CLI static
  build) into `~/.neuramesh/bin`, then `colima start --vm-type vz --cpu 2 --memory 4 --disk 20`, no
  password (A1b). OrbStack and Docker Desktop: download their installer, open it, wait for the socket.
  The stack itself: the compose file is rendered to `~/.neuramesh/local/` with `NM_IMAGE_TAG =
  app.getVersion()` and driven by the app (`pull`, `up -d`, `stop`), never shown and never typed.
  States: `no-engine`, `installing`, `engine-starting`, `downloading` (no clock), `starting` (90 s
  budget after the images exist), `updating`, `ready`. `compose stop` on `before-quit` unless the
  Settings toggle says keep. The env file's `nmh_` secret moves to the keychain on first read.
- `apps/desktop/src/main/connections.ts`: `Connection = { kind: 'local' | 'cloud' | 'custom', apiUrl,
  powersyncUrl, authMode, identity, replicaPath, db, agentHost }`. `current()`, `setForeground(id)`,
  `all()`. The four load-time reads (`sync.ts:62,73`, `authipc.ts:27-45`, `auth-clerk.ts:61`) and the 29
  `AUTH_MODE` sites read the current connection. `WS`, `API_URL`, `activeDb` become fields. The 236
  handlers keep their signatures. `switchWorkspace` becomes `setForeground` and the relaunch retires.
  Every connection opens its replica, starts its agent host (`startAgentHost` already takes `db`,
  `apiUrl`, `workspace`), and posts its notifications.
- The Local connection resolves its workspace through the clerk-branch path so `needsOnboarding`
  (`sync.ts:860`, `wsident.ts`) derives from agents and the wizard runs. The wizard in Local mode:
  the Keys step has no starter door (`OnboardingKeys.tsx:70-82` renders nothing there), a provider is
  required (artboard G). `SetupCards` renders no cloud rows on Local. `CreditRing` renders nothing on
  Local (its own `if (!usage) return null`).
- The frame top's sync mark reads `local` on the Local connection. The foot wears the connection glyph
  (artboard A5).
- Upgrade to Pro (artboards C1, C2): `POST /auth/desktop/start`, open `neuramesh.app/pro?nonce=`, poll
  `/auth/desktop/poll` for 15 minutes (`auth-clerk.ts:74` was 60 s). On completion add the Cloud
  connection. The sheet is `UpgradeModal` (`sheets.tsx:137-198`) with the new words.
- Settings › Connections (artboard D): a new tab replaces the billing tab's plan card as the home of
  connection facts. Local card: engine, stack version, data path with Show in Finder, ports, the
  keep-after-quit toggle. Cloud card: account, plan, workspaces, sign out. Add a server: the `custom`
  kind. The tab strip already wraps at eight (`tokens.css:3797-3802`), so Connections replaces Billing
  and billing's rows move into the Cloud card.
- The hosted shell (artboard E): on a `free` hosted workspace the composer does not render and the gate
  card docks in its place, driven by the plan read at boot.
- The browser build drops its PowerSync literal (`renderer/web/main.tsx:30-32`). Web copy literals move
  into one `brand.ts`.

Tests: unit tests for engine detection (a table of PATH and socket cases), the install lane with the
downloads mocked (asset pins, checksum refusal, the `colima start` arguments, the socket wait), the
compose render, the stack state machine, connection precedence (env in dev, then the connection, then the baked defaults),
`AUTH_MODE` from `nm-config`, and the workspace-to-connection binding. A unit test proves an IPC call
on the cloud connection never touches the local replica and the reverse. e2e one, against the U2 stack:
first run with no account, onboarding connects a provider and hires the crew, a message gets a reply,
the machine registers, a restart keeps the data. e2e two, against the dev cloud stack: upgrade from the
app, the cloud workspace appears, `setForeground` swaps in under 100 ms (measured), both agent hosts
run, both notify, no relaunch.

Evidence: a recording of first run on a Mac with no container runtime (the picker, the install, the
first agent reply, no password prompt and no terminal). A second with an engine present. The seven
stack states in both themes. The upgrade recording through to a cloud thread. Budgets: cold start to
the shell from the replica under 2 s with the stack stopped, the foreground swap under 100 ms.

Deploy notes: Vercel: `VITE_NM_POWERSYNC_URL` on `neuramesh-hq` before merge. Desktop: publish after
U6a (backend before desktop). `neuramesh.app/pro` page ships with U5.

### U3b · The rail with LOCAL and CLOUD bands (stretch)

**Legs:** design (artboards **B0 to B4**, approved in U0) → build → review. **Owner:** developer,
desktop. **Founder: 1.5 h.** Unlocked only if U3a's PR is open for review by Wednesday 2026-09-23.

Change: `navtree.ts` unions rows from `connections.all()` tagged by connection. `HistoryRail.tsx` and
`NavGroups.tsx` draw a `.navband` kicker per connection **only when two exist**. The RECENTS · PROJECTS
head stays one control above both bands. A folded band keeps its count, its ask dot, and its live pulse.
The foot's menu (`ProjectsFace`) lists workspaces under the same two kickers. Opening a row on the other
connection calls `setForeground`.

Tests: `navtree` unit tests: no bands with one connection, two with two, a fold never hides an ask, the
count is per band. Evidence: harness shots of B0, B1, B2 in both themes.

### U7 · Migrate a local workspace to Cloud

**Legs:** design (artboards **H1, H2**, approved in U0) → build → review. **Owner:** developer,
control-api plus desktop. **Founder: 1.5 h.** Depends on U1b's export and U3a's connections.

Change:
- Server: `POST /v1/workspaces/:id/import/batches` under the human bearer, owner only. The target must
  be `cloud`, else `402 PLAN_LIMIT` (the Free door). Each batch is under 4 MB (the Vercel body limit)
  and carries rows in dependency order: projects → channels → repos → agents → threads → tasks →
  messages → artifacts (inline) → memory blocks and facts. Every row's `workspace_id` must equal the
  target. Inserts are `on conflict (id) do nothing`, so a retried batch writes nothing. The first batch
  carries the total bytes, checked against the plan's storage allocation before any write. Agents merge
  by name with the target's crew, the rest register. The response is a report: rows written, rows
  skipped, and the items over the body limit that stayed on the Mac.
- Desktop: the door is **Migrate to Cloud** (George, 2026-09-12: migrate, not move) on the local card in Settings › Connections and in the foot's
  menu. The sheet (H1) names the target Pro workspace, the counts, the storage against the plan, and
  what stays. On Free it opens the Upgrade sheet instead. The driver reads the local export, remaps
  every id with a pure function (new UUIDs, every foreign key re-pointed), streams the batches with
  progress, and on completion writes a `moved` marker beside the local replica. Local rows are never
  deleted (the backup). The rail lists the workspace as moved. H2 offers Open in Flowe.
- Never travels: keys, sign-ins, machine rows, `cache/` (the `exportable()` allowlist).

Tests: the remap is a pure unit test (no dangling foreign key after remap, stable across retries). pg
lane: an import into a `cloud` workspace lands every row with the target's `workspace_id`, a replayed
batch inserts nothing, a `free` target gets 402, an over-allocation gets 402 with zero rows written, an
unowned target gets 403, same-name agents merge. Desktop e2e: export from the U2 stack, import into the
dev cloud, the projects appear under CLOUD, the local workspace shows moved, both replicas intact.

Deploy notes: Vercel none. Migration none.

### U4 · Public-repo hygiene

**Legs:** build → review. **Owner:** developer. **Founder: 2 h, the scrub review.**

Change: `LICENSE` (ELv2 canonical text), `TRADEMARK.md`, `license` in every `package.json`, `NOTICE`
gains marketing-os, xterm.js, the `.claude/skills` copies, and the design-craft holder verified against
upstream. `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`. `README.md` rewritten in our words:
three sentences on what it is, the free line, the install with the container prerequisite in the first
screen, Local mode marked alpha, the Pro line, the issues line. Scrubs: the 11 mockup lines, the three
Supabase refs in `docs/decisions.md`, the company name at the four cited places, the certificate comment
at `release.yml:89`, the dead `.env.production` link, every `/Users/` path in tracked files including
`.claude/launch.json`, `private/` and `var/` removed, `git rm -r --cached docs/evidence`,
`packages/bench/suite` moved to a private repo with the bench CI adjusted, the four `research-*.md`
files and `review.md` kept private. `scripts/public-scan.sh`: gitleaks binary, greps for the founder's
handles and personal email, `/Users/`, the Supabase refs, and `git ls-files docs/evidence` empty. CI
fails on a hit. `apps/mobile` dependency license scan.

Tests: `public-scan.sh` passes on the tree. `lint-ratchet` unchanged.

### U5 · Plans and words

**Legs:** design (artboard **F**) → build → review. **Owner:** developer, web and desktop copy.
**Founder: 1 h.**

Change: `copy.ts` PRICING, HERO (`cta: 'Download for Mac'`, facts drop `No install`), CLOSE, NAV.
`support.tsx`, `legal.tsx` with an effective date, `account.tsx`, `index.html` JSON-LD, `llms.txt`,
`llms-full.txt`, `downloads.tsx` keeps the releases repo. The `/pro` page: sign-up, workspace creation,
checkout, `/auth/desktop/complete`. Desktop copy: `sheets.tsx` (Upgrade and MachineLimit),
`WorkspaceSettings.tsx`, `CreditRing.tsx`, `OnboardingKeys.tsx`, `onauth.ts`, `email/templates.ts`.
`docs/07`. Every string ASD-STE100. Never "open source".

**U5b (desktop shell, landed 2026-09-12):** the three-project cap and its `gatelock` pills are gone.
`PROJECT_CAP`, `projectCap`, `cap` and the `atCap` argument left `App.tsx`, `ProjectsPage`,
`ProjectChip`, `EngineeringComposer`, `EngineeringOS` and `ProjectsFace`. New project always creates.
A hosted Free workspace is write-gated by the server and the hosted gate card, never by the client.
Every plan word the shell still shows reads `planLabel()` from `@neuramesh/shared`, and
`plan-words.test.ts` fails the build on a literal `Individual`, a plan-word `Team`, or a cap symbol.

Tests: `landing-copy.test.ts` and `support-copy.test.ts` updated. Pricing in both site themes.

Deploy notes: Vercel none. Merge in the same hour as the U6a snapshot push.

### U6a · The public snapshot

**Owner:** founder with an agent on the workflows. **Founder: 2 h.**

Checklist: the cloud PowerSync `client_auth` lists no `nm-dev` key (the pre-publish gate). The public
repo exists: `neuramesh-ai/neuramesh-oss`. `git checkout --orphan` and push the scrubbed tree as one commit. Tag the private `main`
`main-archive-2026-09`. `sync-from-public.yml` in the private repo: `repository_dispatch` first, a
five-minute schedule as the fallback, one forced update at cutover then fast-forward only, a comment on
the mirrored PR naming the deployed SHA. Re-create the worktrees. `pr-land.sh` names the public remote.
GHCR package visibility to public. The public repo runs `ci.yml`, `local-stack-smoke.yml`,
`control-api-image.yml`, `public-scan`. Confirm the WIF condition still names the deploying repo. README
truth pass against what U2 and U3a shipped.

Evidence: the public repo URL, the first mirrored commit, the three Vercel projects still deploying from
the private repo.

### U6b · Pipeline move (optional, after 2026-09-28, outside the cap)

Unchanged from plan.md §5.4. Publish desktop `v0.133.0` after the backend is live.

## 3. Order and calendar

| Day | Work | Founder |
|---|---|---|
| Mon 09-14 | U0 decisions and canvas approval. Agents start U1a, U2, U4. | 1.5 h |
| Tue 09-15 | U1a review and deploy. Tombstone script. Notice email approved and sent. | 1.5 h |
| Wed 09-16 | U4 scrub review. U1b review (flag off). | 3 h |
| Thu 09-17 | U2 review. `local-stack-smoke` green. Agents start U3a and U5. | 1.5 h |
| Fri 09-18 | U2 merged. U3a build. | 0 |
| Mon 09-21 | U3a review session one (stack and connections). Agents start U7, server lane first. | 1.5 h |
| Tue 09-22 | U3a review session two (wizard, sheet, settings, shell). | 1.5 h |
| Wed 09-23 | U3a review session three, merge. **Cap check: U3b unlocks only if U3a is in review.** | 1 h |
| Thu 09-24 | U3b build if unlocked. U5 review. | 1 h |
| Fri 09-25 | U3b review if unlocked. U7 review. | 3 h |
| Sat 09-26 | U7 merges. U6a: snapshot, mirror, checks. U5 merges in the same hour. | 2 h |
| Sun 09-27 | README truth pass. Desktop `v0.133.0` tagged as a draft. | 1 h |
| Tue 09-29 | U1b flag on. | 0.25 h |

Total 19.25 h against 22. The 2.75 h buffer covers a U3a overrun.

Gates: U1a deploys before any other unit merges. U4 passes `public-scan.sh` in CI before U6a. U6a does
not start until U1a, U4, and U5 are merged. U1b's flag does not flip before the notice period ends.

Cap rule: if U3a is not in review by 2026-09-23, U3b and U7 move out of the window, and because feature
work stops after 2026-09-27, they land after 2026-12-18 unless George bends the freeze for the move.
The README then says "Local mode: alpha". If U3a is not merged by 2026-09-26, the snapshot ships with
`docs/local-mode.md` (compose by hand, the app from source with `NM_AUTH=dev` against it) and the README
says "Local mode: alpha, from source". The flowe test starts 2026-09-28 either way.

## 4. The design contract

| Artboards | Surface | Unit |
|---|---|---|
| A1 to A6 | First run and the stack states, one card recipe, seven states (A1 the picker, A1b the install, A2 the auto-start), both themes for A1 and A5 | U3a |
| A5 | The Free shell: sync mark reads LOCAL, foot glyph, no credit ring | U3a |
| B0 to B4 | The rail with two connections, bands only when two exist, the foot's menu | U3b |
| C1, C2 | Upgrade to Pro, and the wait state | U3a |
| D | Settings › Connections | U3a |
| E | The hosted free shell, gate card in the composer's seat | U3a |
| F | The pricing section on the site | U5 |
| G | The wizard's Keys step in Local mode | U3a |
| H1, H2 | Migrate a local workspace into a Pro workspace, and the done state | U7 |

Idioms used, none new: the card, the ghost and primary button, the mono kicker, the `.navsect` band
voice, the `.navhiststat` chip palette, the `.upmodal` recipe, the composer, the `.plantag`-shaped
status words. New CSS lands beside its component and docs/33 gains one line for the connection band.

## 5. Decided 2026-09-12, and what is still assumed

Decided (George, yes to all five, recorded as D10 to D17 in `docs/decisions.md`): D9 reads as "both
live and both listed, one foreground at a time". The app installs the runtime, Colima by default, and
starts a stopped one without asking. The export ships with the gate and the notice email goes out
2026-09-15, the flag flips 2026-09-29. The stack stops when the app quits, with a toggle. U3b is a
stretch. The repo is `neuramesh-ai/neuramesh-oss` and the image is
`ghcr.io/neuramesh-ai/neuramesh-control-api`. A local workspace moves to Cloud on Pro.

Still assumed. Correct me or I proceed.
1. The move targets an **existing** Pro workspace (plan and subscription live on the workspace). A move
   that mints a new cloud workspace needs a billing change and is out.
2. Colima's VM is 2 CPUs, 4 GB, 20 GB disk. The picker offers three runtimes, Colima, OrbStack, Docker
   Desktop. A Podman socket is used when found but not offered.
3. Pro stays at $22 per seat.

## 6. What this round does NOT do

Everything in plan.md §7 except the Local to Cloud import (now U7), plus: two threads on screen at
once from two connections (a split-stage feature for later), a move that mints a new cloud workspace,
Local mode without a container engine (L2), a better-auth lane, and Windows or Linux builds.
