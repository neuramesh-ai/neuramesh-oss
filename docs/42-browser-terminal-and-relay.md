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

## Operational shape

| Piece | Where |
|---|---|
| Hub (stateless WSS) | `packages/relay/` → `infra/images/relay/Dockerfile` → `nm-relay` Deployment in `nm-system` |
| Public endpoint | Gateway `gke-l7-global-external-managed`, static IP `nm-relay-ip`, `relay.neuramesh.app` |
| TLS | Certificate Manager, Google-managed, **DNS-authorized** — no private key in the repo or the cluster |
| Machine edge | `apps/desktop/src/main/relay/` (node-pty lives here, NOT in `packages/relay`, or the hub image would compile a native module it never calls) |
| Browser edge | `apps/desktop/src/renderer/web/relay-client.ts`, wired at `webnm-relay.ts` |
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

## The lesson that cost the most

Shipping this broke the fleet once, with a **fully green pipeline**.

`@neuramesh/relay` became a dependency of the desktop package, and the machine image copies workspace packages *by name*. pnpm links workspace deps from the repo, so a missing `COPY` is **not a build error**: the install succeeds, the image pushes, CI passes, and the daemon dies at runtime with `Cannot find module`. `machined` imports it at the top level, so it could not boot at all — and the fleet was already pinned to that image.

The fix was two things, and the missing line was the smaller one. The machine image now **imports `machined` at build time**:

```dockerfile
RUN tsx -e "import('/app/apps/desktop/src/main/machined.ts')"
```

`main()` is guarded on being executed directly, so an import resolves the daemon's entire graph without starting anything. A missing workspace package, an over-pruned devDependency, or a native module built for the wrong ABI all become a **red build in about two seconds** instead of a dead fleet.

**Never pin a machine image you have not watched boot.** `relay /healthz` going from `"machines":[]` to `"machines":["<id>"]` is the difference between "the workflows were green" and "a machine is actually on the relay".
