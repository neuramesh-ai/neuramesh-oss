# 42 — The browser terminal and nm-relay

**Status: live in production (2026-08-30).** `relay.neuramesh.app` serves, workspace machines dial it, and the hq bundle carries its URL. This doc is the reference for the subsystem and, more usefully, for the four things about it that are not obvious.

## Why it exists at all

Two constraints collide, and neither is negotiable:

1. **Machines never listen.** Outbound-only daemons is a security invariant (docs/09 §10), not a preference. A workspace pod has no inbound port, ever.
2. **Vercel functions cannot hold a stream**, and a pty is nothing but a long-lived stream.

So a browser has *no path at all* to a machine. `nm-relay` is the rendezvous: both sides dial **out** to it, and it joins them.

```
browser (xterm.js) ──dials out──▶  nm-relay  ◀──dials out── machine pod (node-pty)
                    Clerk session             nmm_ token
                                  │
                                  ▼  validates BOTH credentials
                            control-api /internal/relay/*
                                  (RELAY_SECRET)
```

The relay itself **holds no keys and verifies nothing**. Both credentials go to control-api over the injected validators (`packages/relay/src/validate.ts`), so the hub is a stateless byte-forwarder that can restart freely.

## What it unblocks beyond a terminal pane

The obvious win is a shell in the browser. The one that actually gated cloud-first is **vendor logins** (cloud-first plan §3.6): `claude setup-token`, `codex login --device-auth` and `gh auth login` must complete through the vendor's own flow, with the platform never collecting, storing or intermediating the token. A terminal attached to the member's own machine is precisely that — and until the relay existed, a web-only user could not connect a subscription to a cloud machine at all.

## The four non-obvious things

### 1. Exactly one replica, and it is not about cost

The hub's routing tables (`machines`, `attached`, `owners` in `hub.ts`) are **in-memory and per-process**. Two replicas put a machine on one pod and its browser on another, where they can never find each other. The symptom is `MACHINE_OFFLINE` (4404) for a machine that is demonstrably online — which reads as a machine bug and is not one.

`replicas: 1` plus `maxSurge: 0`, so a rollout never briefly runs two. Scaling this needs a shared bus or consistent hashing by `machineId`, **not a bigger number**. The hub was built to restart freely instead: machines redial, and `CLOSE.TAKEOVER` exists so a reconnect displaces its own stale socket.

### 2. There are TWO health checks, and the failing one is invisible from kubectl

GKE gives the backend service a default health check against `/`, which the relay correctly 404s (it serves only `/healthz` and a websocket upgrade). Meanwhile the kubelet's `readinessProbe` hits `/healthz` and passes.

The result is a pod that reads `1/1 Running` while the load balancer answers every request with `503 unconditional drop overload`. `HealthCheckPolicy` (`relay-gateway.yaml`) points the LB at `/healthz` so the two checks cannot disagree.

### 3. Without `GCPBackendPolicy`, every terminal dies at 30 seconds

That is the Google L7 default backend timeout. For request/response it is generous; for a WebSocket it is a hard cap on the life of the connection, so an idle terminal drops about half a minute in and reconnects forever. Raised to 3600s rather than papered over with client keepalives.

**And then 3600 s came (2026-09-19).** The MACHINE's socket to the relay is idle by nature: nothing crosses it until a browser opens a terminal. One hour after `machine_online` the balancer closed it, the relay logged `machine_gone`, and the daemon on the other side never saw a close: a half-open socket that read as dialled for hours, no redial, and every browser attach answered 4404 while the machine's heartbeat kept the icon green. The pane then said "The machine is asleep. Start it", to a person looking at a running machine. So keepalives after all, on BOTH ends, with the timeout kept, one watchdog for both (`packages/relay/src/keepalive.ts`): the machine edge pings every 30 s and terminates a socket that misses a pong (which is the close event its redial loop waits for), and the relay server does the same to every socket it accepts, so the hub's close handlers reap it. Each is proven by a peer with `autoPong: false` (`machine-edge-keepalive.test.ts`, `hub.test.ts`). The 4404 sentence now says what is true: the machine is not on the relay yet, it reconnects within a minute. `ensureMachine` runs before every attach, so a machine that is truly asleep never reaches the attach at all.

### 4. Bytes, not strings

A pty emits **bytes**, and the socket chops them wherever it likes, so multi-byte characters split across frames routinely — any box-drawing character, any emoji, any accented name. Decoding each frame independently turns those into replacement characters, and the corruption is intermittent and load-dependent, which is the worst kind to chase later.

One streaming `TextDecoder` **per channel** (`relay-frames.ts`). And `btoa` is replaced because it throws above U+00FF: typing an accented character would otherwise raise `InvalidCharacterError` instead of reaching the shell.

## The jail is bash, and that is not a port

The desktop's terminal jail writes a `.zshrc` and hooks `chpwd` through `add-zsh-hook`. The machine image has **bash 5.2 and no zsh** (checked in the image, not assumed), and bash has no `chpwd` hook — the equivalent is `PROMPT_COMMAND`, which fires per prompt rather than per cd. One file could not have served both shells; it would have shipped a jail that silently does nothing on one of them.

It is a **working-directory jail, not isolation**: absolute paths still read, and the real boundary is the gVisor sandbox and the pod. A jail mistaken for a sandbox is worse than no jail.

## It never pretends

Every failure writes a sentence to the pane and exits — no machine yet, forbidden, asleep, relay unreachable (`relay-frames.ts:closeReason`). The rule is inherited from `webnm-local.ts` and the reason is the same: **a pane that renders empty reads as a hung shell**, which is the exact ambiguity this lane exists to remove.

Close codes are the diagnostic vocabulary. `4403` versus `1013` is worth knowing by heart: a *wrong* `RELAY_SECRET` closes `1013 VALIDATE_UNAVAILABLE`, so a `4403 FORBIDDEN` proves the relay reached control-api, authenticated, and got a real membership verdict back.

## Which machine a terminal opens (2026-09-25)

A plain shell is where a person signs in, so it opens that person's own machine. The server names it as `yours` in `/v1/machines/usage`, and a person without a machine of their own gets the runner. The shell promotes that machine first, because a sign-in on a claim ends with the pod. It wakes only that machine.

A task's terminal opens the runner, which holds the task's worktree, and never promotes it. A promotion ends the claim pod, and the worktree ends with it.

Code keeps the runner (`machines[0]`), because a Code lane does not wake a machine before it attaches.

## Operational shape

| Piece | Where |
|---|---|
| Hub (stateless WSS) | `packages/relay/` → `infra/images/relay/Dockerfile` → `nm-relay` Deployment in `nm-system` |
| Public endpoint | Gateway `gke-l7-global-external-managed`, static IP `nm-relay-ip`, `relay.neuramesh.app` |
| TLS | Certificate Manager, Google-managed, **DNS-authorized** — no private key in the repo or the cluster |
| Machine edge | `apps/desktop/src/main/relay/` (node-pty lives here, NOT in `packages/relay`, or the hub image would compile a native module it never calls) |
| Browser edge | `packages/relay-client` (the tab's transport), wired at `apps/hq/web/webnm-relay.ts` (hq since 2026-09-26) |
| Secret | `RELAY_SECRET` — on Vercel for control-api, and `nm-relay-secret` in `nm-system`. **They must match**; a mismatch fails as a permanent 403 whose symptom points at the wrong component. |

**Cost:** this is the cluster's first load balancer. A global external ALB bills roughly **$18/month just to exist**, plus traffic.

### Switches

- `NM_RELAY_URL` on a machine pod (`FLEET_RELAY_URL` on the operator) — empty is a valid machine: it logs that it has no browser terminal and carries on.
- `VITE_NM_RELAY_URL` on the hq build — **baked at build time by Vite**, so changing it requires a redeploy, and its presence in the served JS is the only real proof it took effect.

Both unset degrade to the honest refusal in `webnm-local.ts` ("No shell here"), so the feature is additive: nothing regresses when the relay is down or undeployed.

## The desktop is the second client (2026-09-04)

The desktop app dials the relay too, for Code only. `src/bridge/desktop-relay.ts` composes the
SAME `relayOverrides` the browser uses (`webnm-relay.ts`, now over a narrow `RelayEnv`) from three
facts main answers over IPC — the relay URL (`NM_RELAY_URL`, the machine daemon's own switch,
defaulting to `wss://relay.neuramesh.app` under Clerk auth and to nothing on a dev stack), the
`/v1` auth headers, and the relay attach credential (the Clerk bearer; `NM_DEV_RELAY_TOKEN` where a
dev stack opted in). It attaches only `engineeringInfo`, `openEngineering` and, when the desktop
has none, `machineEnsure`: the desktop is a machine and its terminals stay local. Everything in
this doc about the relay applies unchanged; the desktop is one more client of it, not a second
path. What the desktop is NOT yet is a Code *host* — only `machined` creates an engineering host
and dials the relay as a machine edge; that is the next slice
(`docs/design/desktop-code-bridge-2026-09/plan.md`).

## The phone is the third client (2026-09-05)

The mobile app's terminal (mobile-cloud S8) is the same lane again: a **WebView** running xterm.js
and this package's `openRelayPty`, handed the relay url, the attach credential and the machine id by
message from React Native. The WebView owns the socket — two edges on one phone, since Code's lane
(`apps/mobile/src/relay.ts`) has its own — because re-encoding every pty byte across the RN bridge
buys nothing and costs the streaming decoder that makes `git log` render.

Two things that are only true inside a WebView, and both fail silently:

- **The page's origin decides whether `ws://` is legal.** Served from an `https` baseUrl, a plain
  `ws://` socket is mixed content: WKWebView refuses it with no error anywhere. The page is loaded
  from `http://app.neuramesh.local/` (ATS's `NSAllowsLocalNetworking` permits `.local` and loopback);
  production dials `wss://`, legal from either.
- **A phone keyboard rewrites commands.** iOS smart punctuation turns `--version` into one em dash
  as you type, and React Native exposes no switch for it, so the paste line normalises on the way
  out (`apps/mobile/src/shell-text.ts`). Every substitution has an ASCII original; putting it back is
  the difference between a flag and an "unknown option" the user reads as their own mistake.

## The stream lane: live replies reach the browser (2026-09-25)

A browser had no token stream. `emitStream` (`apps/desktop/src/main/agents.ts`) sent the growing
reply only to Electron windows, so a headless cloud machine dropped every token, and the web saw
the reply whole when the final message synced, about 5 s after the first token existed. The relay
now carries a third lane, `stream`, and the browser shows the reply while the agent writes it.

- **The machine side.** `emitStream` also publishes to `main/livestreams.ts`. It keeps the text of
  each live key, sends at most 30 frames a second for each key, and sends a delta: keep the first
  N characters, then append the rest. A subscriber that arrives in the middle gets a full copy
  first. `relay/stream-lane.ts` serves the lane at the machine edge.
- **A subscriber is not a session.** It never counts as activity and never takes one of the 32
  terminal slots, so an open tab does not keep a machine awake or billing. The hub gives the lane
  its own budget: 2 channels for each client socket and 256 for each machine
  (`packages/relay/src/stream-lane.ts`).
- **The browser side.** `renderer/web/webnm-stream.ts` subscribes to the online cloud machines
  the member may attach to: the runner, and the member's own machine. It never wakes a machine.
  It asks for a full copy when it sees a gap in the sequence, redials with backoff (1 s, doubling
  to 30 s), and closes a channel after 50 s of silence. The machine sends a heartbeat every 20 s.
- **Access.** Every member of a workspace reads every room today (the sync rules send the whole
  workspace, and `channel_members` is a roster, not an access list). The relay admits only
  members, the hub stamps the verified user on every open, and the machine checks
  `canRead(actorId, key)` on every frame. That check says yes today, and it is the place to
  enforce room access later.

### The lane is opened only where both edges name it

This is the trap. **An older daemon reads an unknown lane as a terminal.** If a `stream` open
reached it, it would start a shell for every tab and count each one as work. The relay and the
web both deploy on the same merge, so their order is not fixed. So each edge holds the rule on
its own:

1. The machine's `hello` names the lanes it serves. An older daemon names none.
2. The hub refuses a `stream` open to a machine that did not name the lane.
3. The hub's `attached` reply repeats the machine's lanes. The browser opens a `stream` channel
   only when `attached` names it. An older relay sends no list, so a new tab behind an old relay
   never opens one.

The end-to-end test in `renderer/web/relay-e2e.test.ts` attaches a tab to an older daemon and
fails if a stream open leaves the tab.

### Switches

- `VITE_NM_STREAM_LANE=0` on the hq build turns the lane off with no code change. Unset keeps it
  on wherever `VITE_NM_RELAY_URL` is set.
- `VITE_NM_RELAY_URL` unset keeps the web exactly as it was: no lane, no socket.

## The browser lane: the cloud machine's own browser (2026-10-02)

A site that refuses frames (x.com, a sign-in page) cannot show in the web panel's iframe. So the
page runs in Chromium on the member's cloud machine, and only its pixels and its state travel, over
a fourth lane, `browser` (board C3, `docs/design/models-and-replies-2026-10`). The same browser
service gives the agents five tools: `web_open`, `web_read`, `web_click`, `web_type` and
`web_screenshot` (`apps/desktop/src/main/browser/agent-tools.ts`).

- **Frames.** The machine starts a CDP screencast (`Page.startScreencast`, JPEG) and sends each
  frame as one JSON line in one data frame: `{ t: 'frame', n, w, h, jpeg }`. A frame never spans two
  data frames. The machine keeps each one under `MAX_CHANNEL_DATA_B64_CHARS` (512 KB of base64). It
  drops a frame that does not fit, and the page lowers its JPEG quality (60, 45, 30, 20), then its
  size. The pane acks each frame it draws, and the machine holds at most two frames that a
  viewer did not ack. Past that it keeps only the newest. A slow link sees a later picture, never a
  queue, and the machine's outbound buffer stays far below the 8 MB that closes its socket.
- **State and input.** `state` carries the url, the title, back, forward and loading. The pane sends
  navigate, back, forward, reload, mouse, wheel, key, text, resize, tab and ack. The machine checks
  every field of every message (`packages/shared/src/browser-lane.ts`) and drops a message with one
  bad field.
- **Gating.** It is the stream lane's rule, on both edges. The daemon names `browser` in its hello
  only when it has a browser service. The hub refuses a `browser` open to a machine that did not
  name it, and the client opens one only when `attached` names it, because an older daemon reads
  the lane as a terminal. The lane has a budget of its own, apart from the 32 session slots: two
  channels for each client socket and four for each machine (`packages/relay/src/browser-lane.ts`).
  A viewer is not a session, so a tab left open does not keep a machine awake. A person who types
  counts as activity for one minute, and so does an agent call in flight.
- **Two browsers, never shared.** The person's browser belongs to the user the hub verified, never
  to a name in the meta, with a profile on the state volume (`/nm/state/browser/person-<user>`), so
  a sign-in survives the next wake. A teammate who opens the panel on the same machine gets a
  browser of their own. The agents get one browser on a temporary profile that the service deletes
  with it, and only the web tools drive it. The panel can watch the agents' tab and cannot steer it: the
  machine drops every input on that tab, whatever the pane sends.
- **No port.** Chromium speaks CDP over `--remote-debugging-pipe` (fds 3 and 4). A loopback
  debugging port is one request away from every agent shell on the machine, and on a cloud machine
  those shells run as root with no sandbox.
- **The address guard.** Both browsers reach the web only through an egress proxy inside the daemon
  (`browser/egress-proxy.ts`). The proxy resolves each name itself and refuses it when any answer
  is private, loopback, link-local (the metadata server 169.254.169.254 first), unique-local IPv6,
  or a cluster name (`*.internal`, `*.local`, `localhost`). Then it connects to the address it
  checked, so a DNS answer that changes between the check and the connection cannot pass.
  Navigation and agent calls run the same guard first, and only http and https open. QUIC and
  WebRTC UDP are off, so no packet goes around the proxy. The platform's egress floor stays the
  boundary under all of this.
- **Idle.** Chromium starts on first use and stops after five minutes with no viewer and no agent
  call. A machine with no Chromium (`/usr/bin/chromium`, or the binary `NM_CHROMIUM` names) serves
  no `browser` lane and offers no web tools.
- **The web pane** (`apps/hq/src/wtabs/RemoteBrowserPane.tsx`) dials the person's own machine, as
  the shell does, and wakes it first. The refused card offers it only on the cloud plan, on a cloud
  connection, with a machine on the relay.

What the lane does not guard: an agent shell on the same machine can read the person's profile
files on the state volume. Agents run as root there by design (the 2026-09-25 ruling), so "sign-ins
stay on that machine" means that they never leave it for the platform. It does not mean that the
agents on that machine cannot reach them.

The end-to-end test in `apps/desktop/src/main/relay/browser-e2e.test.ts` drives the tab's
transport, the hub and the machine edge, and it fails if a browser open reaches a daemon that did
not name the lane. `browser/live.test.ts` drives a real Chromium through the guard, the proxy, the
two profiles and the tools when `NM_CHROMIUM` names a binary, and
`scripts/machine-browser-boot.mjs` does the same inside a built machine image.

### Switches

None new. The lane rides `NM_RELAY_URL` and `VITE_NM_RELAY_URL`, as the other lanes do.

## The lesson that cost the most

Shipping this broke the fleet once, with a **fully green pipeline**.

`@neuramesh/relay` became a dependency of the desktop package, and the machine image copies workspace packages *by name*. pnpm links workspace deps from the repo, so a missing `COPY` is **not a build error**: the install succeeds, the image pushes, CI passes, and the daemon dies at runtime with `Cannot find module`. `machined` imports it at the top level, so it could not boot at all — and the fleet was already pinned to that image.

The fix was two things, and the missing line was the smaller one. The machine image now **imports `machined` at build time**:

```dockerfile
RUN tsx -e "import('/app/apps/desktop/src/main/machined.ts')"
```

`main()` is guarded on being executed directly, so an import resolves the daemon's entire graph without starting anything. A missing workspace package, an over-pruned devDependency, or a native module built for the wrong ABI all become a **red build in about two seconds** instead of a dead fleet.

**An import check cannot see a file (2026-09-26).** The daemon reads the agent contracts (`defaults/agents/*.yaml`) at runtime, and the image never copied them. Every import resolved, so the build stayed green, and every cloud machine ran its agents with an empty worker prompt. The image now copies `defaults/`, and the boot check also loads four contracts, so a missing one is a red build.

**Never pin a machine image you have not watched boot.** `relay /healthz` going from `"machines":[]` to `"machines":["<id>"]` is the difference between "the workflows were green" and "a machine is actually on the relay".
