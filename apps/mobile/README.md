# NeuraMesh Mobile (`@neuramesh/mobile`)

The iOS app, and the third client of the cloud plane. The phone hosts no agents. Since the
mobile-cloud round (2026-09) it needs no computer either: you sign up here, a cloud machine comes
with the workspace, and from the phone you start sessions on it, run Code, open a terminal, arm
routines, clear every human gate, watch the machine and the credits, and get pushed when an agent
needs you. Design contract: [DESIGN.md](DESIGN.md). Store listing: [appstore/APPSTORE.md](appstore/APPSTORE.md).

## Status

| Area | State |
|---|---|
| Expo app + monorepo integration | ✅ scaffolded, `pnpm -r typecheck` green |
| Device-handoff sign-in (reuses desktop flow) | ✅ code complete |
| PowerSync (client-core `AppSchema`) + channel list | ✅ code complete |
| Push client (register / deep-link / rotate) | ✅ code complete · `pnpm --filter @neuramesh/mobile test` runs the routing tests |
| Theming (4 token themes, parity-tested) + the bundled type ramp | ✅ Graphite · Paper · Soft dark · Cream oak |
| Round-1 screens (Home rail, thread + cards, task, design review, board) | ✅ shipped (v0.1.x) |
| **Cloud round** — the head (machine pill · credit ring) · Compute · Tasks tab | ✅ S2 |
| Cloud round — Home's queue + session list · New chat with the machine chip · the thread · History | ✅ S3 |
| Cloud round — Routines · Calendar (the shared `scheduleFirings` projection) | ✅ S4 |
| Cloud round — Code over nm-relay (the shared Engineering reducer; `code_sessions` rows) | ✅ S5 |
| Cloud round — onboarding on the phone (Welcome · Invited · the five-step wizard · the join and setup cards) | ✅ S6 |
| Cloud round — push lands where it points (one tested payload → route mapping; the permission asked at the first reply) | ✅ S7 |
| Cloud round — the terminal (WebView xterm over nm-relay; the vendor-login door) | ✅ S8 |
| Cloud round — the docs, version 0.2.0, and the App Store listing rewritten for cloud-first | ✅ S9 |
| The EAS build and the TestFlight submission | ✅ 0.2.0 build 23, uploaded to App Store Connect 2026-09-05 |
| Export compliance · testers · the store listing | ⏳ in App Store Connect, by hand |

## Architecture

- **`@neuramesh/client-core`** supplies the PowerSync `AppSchema`, the theme tokens,
  the canonical read queries, and the typed `ControlApiClient`. Reads hit the local
  SQLite replica; writes go through the client (Bearer-authed `/v1/*`).
- **`src/auth.ts`** — device-handoff sign-in (`expo-web-browser` + `expo-secure-store`),
  token minting. **`src/system.ts`** — PowerSync + op-sqlite + the backend connector.
  **`src/push.ts`** — `expo-notifications` registration + deep-link routing.
- **`app/`** — expo-router tree: auth gate → `(tabs)` (Home / Code / Routines / Tasks), `new` (New chat), `thread/[id]`, `code/new`, `code/[id]`,
  `history`, `compute`, `settings`, plus `task/[id]` and `channel/[id]` (a room's session list).
  **`src/sessions.ts`** derives every list from the shared `historyRows`/`sessionGroups` + open `runs`;
  **`src/send.ts`** is the one send (a local insert with the birth columns, forwarded by
  client-core's `messageUploadInput`). **`src/head.tsx`** is the row every tab
  shows; **`src/compute.ts`** the one polled store behind the machine pill, the ring and Compute
  (`/v1/machines/usage` + `/v1/usage`, 60 s + on foreground); **`src/kit.tsx`** the primitives;
  **`src/icon.tsx`** draws client-core's generated icon sheet with `react-native-svg`.

## Running against the local dev stack

1. `dev/stack` up (Postgres :55435, PowerSync :58081) and the `control-api-dev` launch entry
   (:8787, `NM_ALLOW_DEV_TOKENS=1`, `FLEET_AUTOPROVISION=on`).
2. `apps/mobile/.env` (gitignored): `EXPO_PUBLIC_NM_AUTH=dev` · `EXPO_PUBLIC_NM_API=http://127.0.0.1:8787`
   · `EXPO_PUBLIC_NM_POWERSYNC=http://127.0.0.1:58081`.
3. `pnpm exec expo run:ios --device <udid>` builds the dev client (native modules: op-sqlite,
   react-native-svg, expo-font); on this Mac CocoaPods needs `LANG=en_US.UTF-8` and `arch -arm64`.
   Then the `mobile-metro` launch entry (`expo start --dev-client --clear`) and open
   `exp+neuramesh://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081` in the simulator
   (after a Metro restart the first `openurl` relaunches the dev client to the home screen; the
   second one loads the bundle).
4. The theme is pinned in SecureStore — capture both themes through Settings → Theme.
   Typing into the simulator with no field focused reaches the dev client's keyboard shortcuts — an
   `r` reloads the app — so focus the field (the caret) before typing.
6. **Code (S5)** needs the engineering harness: the `engineering-harness` launch entry runs
   `scripts/dev-web-engineering.sh` deterministically (no model billing) on API :8796 · relay :8795 ·
   web :5205 with an arm64 Node 24 (`NM_NODE_BIN`; an x64 Node under Rosetta breaks esbuild). Point
   the phone at it: `EXPO_PUBLIC_NM_API=http://127.0.0.1:8796` · `EXPO_PUBLIC_NM_RELAY_URL=ws://127.0.0.1:8795`
   · `EXPO_PUBLIC_NM_DEV_RELAY_TOKEN=<the API process's NM_DEV_RELAY_TOKEN>` (read it from
   `ps eww` on the control-api pid), restart Metro with `--clear`, and drive `HARNESS_PLAN` → Act →
   `HARNESS_ACT` → approve the edit and the command.
5. The dev user's first sync pulls every workspace they belong to; trim `workspace_members` in the
   dev DB to the workspaces under test or the first checkpoint takes minutes.
8. **The terminal (S8)** needs the same harness as Code (relay :8795): open Compute → your machine →
   **Terminal**. The page is generated — re-run `pnpm --filter @neuramesh/mobile terminal:build` after
   editing `terminal/page.ts` (or after an xterm / relay-client change) and commit
   `src/terminal-html.ts`. Two simulator traps: a WebView never takes the hardware keyboard, so
   typing goes to the dev client instead (an `r` reloads the app) — drive the shell through the
   paste line and the ↵ key; and a page loaded from an `https` baseUrl may not open a `ws://` socket
   (mixed content, failing silently), which is why the page is served from `http://app.neuramesh.local/`.
7. **Onboarding (S6)** is driven as a FRESH user: seed an `nm_users` row whose `clerk_user_id` equals
   its `id` (the dev token's `sub`), point the phone at it with `EXPO_PUBLIC_NM_DEV_USER=<id>` (and
   `EXPO_PUBLIC_NM_DEV_EMAIL`), restart Metro with `--clear` (the env is baked at bundle time), and
   sign out first (sign-out wipes the replica, so the arrival gate sees no leftover memberships).
   A pending `workspace_invites` row for that email opens the Invited screen; none opens the wizard,
   and `FLEET_AUTOPROVISION=on` mints the runner row the Launch step waits for. The simulator's
   synthetic tap does not toggle a native Switch — drag it (a swipe) instead.

## Setup (the manual steps only you can do)

1. **Expo/EAS project:** `cd apps/mobile && npx eas init` → copy the project id into
   `app.json` → `extra.eas.projectId`. Add `EXPO_TOKEN` as a GitHub Actions secret
   (for `.github/workflows/mobile.yml`).
2. **Align dependency versions to SDK 53:** `npx expo install --fix` (the versions
   pinned in `package.json` are best-effort; this makes them exact).
3. **Apple:** bundle id is `app.neuramesh.mobile`. `eas credentials` to create the
   APNs key (push) + distribution cert. The Flowe Apple team/cert can be reused.
4. **Env / config:**
   - `EXPO_PUBLIC_NM_API` — control-api base (defaults to `https://api.neuramesh.app`).
   - `EXPO_PUBLIC_NM_POWERSYNC` — the PowerSync instance URL (required for sync).
   - `EXPO_ACCESS_TOKEN` on the **backend** (Vercel) — enables Expo push security.
5. **Dev build (Expo Go won't work — native op-sqlite):**
   `eas build --profile development` → install on a physical iPhone.
6. **Run the JS:** `pnpm --filter @neuramesh/mobile start`.
7. **TestFlight:** `eas build --profile production && eas submit`. OTA JS updates:
   `eas update --channel preview`.

Optional web tweak: `neuramesh.app/desktop-signin` can read `?client=mobile` to show
"return to the app" copy — the sign-in flow works without it.

## Verification boundary

Everything up to "it compiles and the integration is type-correct" is done and
enforced by CI (`pnpm -r typecheck`). The on-device sign-in → sync → push loop and
the TestFlight screenshots require a native build, which needs the Apple/EAS setup
above — that's the founder's environment, not reproducible in the build sandbox.
