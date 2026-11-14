# 42 — The browser terminal and nm-relay

**Current production: 11 November 2026.** Two Cloud Run relay shards serve the hosted
application. Both are request-billed with minimum zero and intended maximum one instance per
shard. [Architecture](09-system-architecture.md) · [Pulumi operations](../infra/README.md).
The dated transport investigations below preserve history; GKE-specific fixes are not current
Cloud Run deployment commands.

## Why it exists

Machines accept no public inbound connections. Clients and machines both dial out to a relay,
which joins their authorized terminal, live-stream and browser channels. The relay delegates
client/machine validation to the control API; it does not store customer provider logins.

```
browser / desktop / phone ──dials out──▶ relay shard ◀──dials out── machine
                                          │
                             control-api /internal/relay/*
                                   (shared RELAY_SECRET)
```

The relay is a transport, not a second application authorization service. A session on a
member's own machine may run a vendor's interactive sign-in flow there. Personal subscriptions
from the former shared runner were not copied into members' machines during migration.

## Routing, health and connection lifetime

### One instance per shard

Routing tables in `hub.ts` are process-local. A machine on one arbitrary instance cannot meet
a client on another. Production scales by **two named shards**, with consistent machine-ID
routing and wrong-shard redirection, rather than by uncoordinated replicas of one shard.
Keep both minimums at zero; a stopped shard can cold-start on demand. The intended maximum
is one, but revisions and platform rollover still require the reconnect protocol and monitoring.

### Readiness before attach

A running Worker Pool is not sufficient proof that its terminal is usable. Wait for the
machine's core restore and relay readiness. For a selected repository or thread, hydrate that
subject before opening its working directory. The client retains the pending terminal request
through startup/retry; a first attach must not fail merely because the machine is still booting.

The active lazy restore path loads essential state first and remaining subjects in the
background. An old monolithic snapshot can still require a full restore. A failed restore must
remain visible and recoverable, never become a successful empty workspace.

### WebSocket rollover

Production uses a 3,600-second request timeout. Both edges use ping/pong watchdogs to detect
half-open connections; machine redial and client reattachment recover from socket/revision
rollover. Keepalives do not extend Cloud Run's request lifetime indefinitely. See “Sessions
outlive the relay socket” below for grace periods, buffers and limits.

### Bytes, not strings

PTY output is bytes and multibyte characters can split across frames. Use one streaming
`TextDecoder` per channel. Do not decode frames independently or use `btoa` on arbitrary
Unicode input. Preserve the existing channel/session framing during reconnect.

## Working directory and machine selection

A personal shell uses the authorized member's selected machine. A thread terminal uses its
thread/subject workspace on that machine. A project terminal resolves the selected repository
identity to the checkout on the target machine. A project's original Mac `local_path` must not
be sent as a cloud cwd; use its retained cloud repository twin and hydrate it before opening. A missing retained clone
produces an explicit refusal; terminal attach does not create a replacement checkout.
The visible prompt shows the path after `subjects`; this does not change the actual cwd.

A missing directory, unavailable provider login, denied machine and relay outage are different
failures. Write an actionable reason to the pane and preserve the underlying diagnostic.
The shell's directory restriction is a convenience, not the security sandbox: the Cloud Run
machine runtime and its process boundary enforce isolation.

## Operational shape

| Piece | Current production |
|---|---|
| Hub | `packages/relay` → `infra/images/relay/Dockerfile` → two Cloud Run relay services |
| Public routing | Pulumi-managed global edge; read its current static IP and hostname/path routes from `infra/cloudrun/edge` |
| TLS | Google-managed Certificate Manager certificates with DNS authorization |
| Machine edge | `apps/desktop/src/main/relay`; node-pty executes on the machine |
| Client edge | `packages/relay-client`, HQ bridge and native terminal transport |
| Shared validation | `RELAY_SECRET` through matching Secret Manager versions/service bindings; API validates membership and machine identity |
| Shard list | `RELAY_SHARDS` / `RELAY_SHARD_INDEX`; `FLEET_RELAY_URLS`; gateway/client relay configuration |

Change shard topology as a coordinated client, gateway, fleet and relay rollout. An old URL
or wrong revision can look like `MACHINE_OFFLINE` despite a healthy machine heartbeat.
An unset relay capability must produce a named refusal rather than an empty terminal.

**Cost:** minimum zero avoids an idle instance charge for an unused shard. Active WebSocket
requests still incur usage. Load-balancer rule-group and traffic charges are separate; removing
the old GKE frontend does not automatically remove a second fixed rule-group charge when the
new frontend remains within the same billed group.

## Historical GKE incidents (August–September 2026)

The original relay ran as a single GKE Deployment. Its kubelet readiness probe used `/healthz`,
while the separate load-balancer health check defaulted to `/`, returning 404 and causing 503s
behind a healthy pod. `HealthCheckPolicy` corrected that legacy path. A `GCPBackendPolicy`
raised the old backend's default 30-second timeout to 3,600 seconds. Those Kubernetes objects
remain historical recovery configuration; they do not configure the Cloud Run services.

The one-hour rollover later exposed half-open machine sockets and motivated the ping/pong
watchdogs now shared by both ends. The deployment changed, but that transport requirement
remains. Preserve the failure history when investigating a reconnect regression.

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

## Sessions outlive the relay socket (2026-10)

On Cloud Run, every relay socket ends. The request timeout cuts it at 3600 s, a relay rollout
retires it with code 1012, and a restart drops it. Before this change, the end of a socket ended
every terminal and Code session on it. Now a session lives on, and its client takes it back.

- **The machine edge** (`apps/desktop/src/main/relay/machine-edge.ts`). When its socket drops, or
  the hub says that a client left (`detach`), the session detaches. It keeps running. Its newest
  output stays in a bounded buffer with the offset of each byte (`resume-buffer.ts`). A session that
  no client takes back in the grace window ends. A detached session is not work for the activity
  meter, and it gives up its slot to a new open of the same person. The same Code thread opened
  again takes over the session that its old channel left.
- **The resume.** The client sends its open again with `resume: true` and `from`, the number of
  bytes that it has. The machine answers `resumed` with `o`, `dropped` and the same `from`, and
  replays from `o`. It never starts a second shell. A session that is gone answers `close` with a
  reason. Only the person who opened a session can take it back.
- **The hub** (`packages/relay/src/hub.ts`). On a machine that names `resume`, a client that leaves
  costs its sessions a `detach`, not a `close`. A resume moves a channel to a newer socket of the
  same person. A takeover tells the new machine socket which channels still have a client.
- **The rotation.** Before the 3600 s cut, the machine and the browser each open a new socket and
  move their sessions to it. The machine uses the hub's takeover (4409). The browser uses a resume
  open, and then closes its old socket with code 4000.
- **The client** (`packages/relay-client`). It dials again within its window and takes back every
  terminal and Code session. A short drop prints nothing. A longer drop prints one line, and one
  more line when the session is back. A live-reply or browser channel is not a session. It ends
  with its socket, and its owner opens it again.
- **Gating.** The machine names `resume` in its hello, and the hub repeats the name in `attached`.
  A client resumes only when it sees the name. The hub refuses a resume to a machine that does not
  name it, because an older daemon would start a second shell.
- **A machine that just started** is not on the relay yet. It dials a few seconds after its first
  heartbeat. `ensureMachine` marks a machine that it starts, and for 90 s the first attach to that
  machine waits through 4404 and prints "Waiting for the machine to join the relay...". A 4404 from
  any other machine still ends the attach at once.

### Switches

- `NM_RELAY_RESUME_GRACE_MS` on a machine (default 120000). 0 turns resume off. Then a session ends
  with its client, as before, and the hello does not name `resume`.
- `NM_RELAY_RESUME_BUFFER_BYTES` on a machine (default 262144). A Code session keeps four times as
  much.
- `NM_RELAY_ROTATE_MS` on a machine (default 3000000, 50 min). 0 turns the rotation off.
- `resumeWindowMs` (110 s) and `rotateMs` (50 min) in the client's `RelayConfig`.

### Limits

- A byte that the buffer drops is gone. The pane says how many bytes.
- A keystroke typed while the socket is down is not sent later. A Code command waits for the next
  socket, but a command sent into a socket that died a moment before is lost.
- The Code pane in hq shows the reconnect lines. The desktop and the phone resume the same way, but
  they show no line yet.

## Relay shards (2026-10)

One relay instance holds every socket of the machines it serves, so one instance is a ceiling: about 1,000 sockets, a few hundred active machines. The relay now runs as N services, the shards. Each shard is one instance (min 1, max 1), as before. A machine lives on one shard, and its browsers dial that shard.

- **One rule** (`packages/relay/src/shard.ts`). The shard of a machine is a rendezvous hash of its id over the shard indexes. The fleet, the hub, the browser client, the machine edge and the live check all import this one file. Test vectors in `shard.test.ts` pin it, from an independent Python reimplementation. A change to an output moves live machines.
- **The list.** The shards are a comma list of URLs in shard order. One URL is the list of one (N=1). The order is what every side must agree on, because the hash keys on the index, not on the URL. One Cloud Run service answers on two URLs, and either form can appear in a list.
- **Adding a shard** moves about 1/(N+1) of the machines, and each moved machine goes to the new shard. No machine moves between two old shards.
- **The fleet** (`FLEET_RELAY_URLS`, or `FLEET_RELAY_URL` for one) stamps each pool with its machine's shard (`NM_RELAY_URL`). A new list changes the URL of the machines whose shard moved, and only theirs. That is a template change, so a running machine takes it at its next drain, and the fleet asks for a roll, as for any template change. A GKE warm pod has no machine id when it is stamped, so it gets the whole list and `machined` picks its own shard.
- **hq** gets the list in `VITE_NM_RELAY_URL`. In the sandbox the gateway stamps it from `HQ_RELAY_URL`. The browser client (`packages/relay-client`) dials each machine's shard. The desktop and the phone take a list the same way. `PROD_RELAY_URL` is one URL (N=1).
- **The refusal.** Each shard knows the list and its own index (`RELAY_SHARDS`, `RELAY_SHARD_INDEX`). A browser that attaches for a machine that lives on another shard hears close `4421` with the reason `shard <k>/<n> <url>`, before any credential is checked. The client dials the named URL once. A second refusal is final, and the pane says to reload the page. This covers a tab whose list is older than the relay's.
- **The machine follows too.** A machine's hello names the `shard` capability. A shard refuses such a machine with the same `4421`, and the machine edge dials the named shard at once and keeps it. So a new list on the relays moves a running machine at its next redial, before the fleet restamps its pool. An older daemon, which does not name `shard`, is served where it lands, and a browser that dials there still meets it.
- **The rollover watch** of each shard asks its own service URL: `RELAY_SELF_URL`, else its own entry in `RELAY_SHARDS`, else Cloud Run's URL for `K_SERVICE`. A shard never compares its revision with another shard's.

### Switches

- `RELAY_SHARDS` and `RELAY_SHARD_INDEX` on each relay. Unset, or a list of one, is the only relay. A list with a bad index stops the relay at start, because it would refuse its own machines.
- `FLEET_RELAY_URLS` on nm-fleet (wins over `FLEET_RELAY_URL`).
- `HQ_RELAY_URL` on the hq gateway, one URL or the list.
- `NM_RELAY_URL` on a desktop or a machine, one URL or the list.

### How to grow N in production

1. Ship the client and machine code first, with one relay (N=1). The new hq bundle, the desktop, the phone and the machine image all follow a `4421`, and nothing refuses yet.
2. Wait until no tab or daemon from before step 1 is left: tabs reload, and the machines roll onto the new image.
3. Add the shard: the new relay service, then `RELAY_SHARDS` and `RELAY_SHARD_INDEX` on every relay, `FLEET_RELAY_URLS` on the fleet, and the list in the clients' relay setting.

A client from before step 1 does not follow a refusal. It redials the wrong shard until its window ends and then shows "The connection closed (4421)". A reload fixes it. The sandbox saw this at its N=2 deploy (2026-10-30): an e2e script with its own relay code and the old single URL redialled shard 0 every 3 s until the scripts learned the list (`scripts/e2e-cloudrun/lib/relay.mjs`).

### Limits

- A shard restart drops only its own machines' sockets. Their terminals and Code sessions resume within the grace, as in "Sessions outlive the relay socket". The other shards see nothing.
- Shards do not share load. A shard with many busy machines can fill while another is idle. The hash spreads machine ids evenly (within 5 % in the tests), not traffic.
- A new list is a rollout of every relay, the fleet and the gateway. While it rolls, an older daemon that sits on its old shard can be out of reach for a browser with the new list (`4404`) until its roll. A machine with the `shard` capability moves at its next redial.
- The phone's terminal WebView bundle (`apps/mobile/src/terminal-html.ts`) is an older build of the client, and it dials the URL it is given as it is. Give the phone one URL until that bundle is rebuilt.

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
