# Machine auto-wake — a surface that needs a machine starts one

**Status:** design approved 2026-08-30 (mockup round; pane-scoped confirmed). Layers 1–2 in build.

## The bug

Clicking Terminal on a workspace whose machine is asleep prints this and exits:

```
nm: The machine is asleep.  Start it, then open the terminal again.
[process exited]
```

That message is *honest* — it is the refusal from `webnm-local.ts`, and it beat the alternative it replaced (an empty pane that reads as a hung shell). But honesty is the floor, not the goal. **We know what the person wants, we know how to get it, and we are asking them to go and do it.**

## The number that shapes everything

```
idle_stop_min default = 30        free cap = 60 min/day
```

A wake sets `desired_replicas = 1` and `last_wake_at = now()`. The machine then runs **30 minutes before idle-stop**, used or not, and metering counts *running* minutes.

**Two speculative wakes exhaust a free workspace's entire day.** This is why "wake whenever the user focuses the UI" — the tempting version — is rejected: it would burn the budget of exactly the users the cap protects. Someone who opens the app twice to read a thread would find their agents dead by lunch.

Everything below follows from making a wake cheap enough to be worth gambling on, or not gambling.

## Layer 1 — `ensureMachine()`, one seam

The terminal refuses because `openRelayPty` handles "no machine" itself. Every other machine-backed lane — fs, git, logs, footprint — will grow the same branch and forget the same wake. Per-lane logic is how this bug ships four more times.

So: **one function every machine-requiring lane calls**, which never hands back a raw state:

```ts
ensureMachine(deps, onProgress) → Promise<
  | { ok: true; machineId: string }
  | { ok: false; reason: 'capped';      detail: string }
  | { ok: false; reason: 'unavailable'; detail: string }
  | { ok: false; reason: 'cancelled' }>
```

It resolves the workspace's runner, wakes it if asleep, polls until online, and reports transitions through `onProgress`. A lane cannot forget to wake because it never sees `asleep`. Invariants live in the seam, not in each caller's memory (doctrine §4).

**Cancellation is first class.** A person who navigates away has not cancelled the *machine* — the wake stands and the work queues — but they have cancelled their *wait*, and the promise must stop resolving into a dead surface.

## Layer 2 — the terminal wakes, and says so

Approved shape, from the mockup:

- **Pane-scoped, not full screen.** The surface you asked from becomes the boot; the rest of the app stays live. Full-screen blocks everything for two minutes over a request scoped to one pane. It is reserved for first-run, where the boot *is* the first impression.
- **The product's own orb** (`thinking-orbs`, state `connecting`) — the same one the thread shows while an agent works. One vocabulary, one stage earlier.
- **One state at a time**, not a ledger:

  > **Starting your cloud machine** → **Connecting** → *(fades to the prompt)*

- **No progress bar.** A bar here is a timer in a progress bar's clothes and lies precisely when a boot runs slow. The elapsed counter and "usually about 2 minutes" carry the expectation instead.
- **Leaving does not cancel.** Back to chat keeps the machine coming and the terminal queued.
- **Capped routes to the upgrade card**, never a dead pane.

### Two states, because only two are distinguishable

An earlier draft named five (finding hardware, attaching the disk, pulling the image). Real, measured — and wrong to show: nobody waiting on a terminal wants a tour of the storage driver. It was also a promise we could not keep, since the app sees only *asked for* and *online*; the middle is opaque without new fleet reporting. **Plain language removed a backend dependency rather than merely softening the copy.**

"Starting" then went too: it is the instant `desired_replicas → 1` write, so as a solo state it flashed and vanished.

**Known cost:** the first state lasts ~140 of the ~146 seconds. The only moving things are the orb and the elapsed counter, so a slow boot can read as a stuck one. Ship calm; if it reads as frozen, add a quieter second line after ~45s — never a fake bar.

## Layer 3 — anticipatory wake (NOT in this round)

> **Layer 3a shipped 2026-09-04 — a routine wakes its runner.** Routines fire from a daemon's minute
> tick, and nothing woke a sleeping machine for one: a workspace idle past the 48 h stop missed the slot
> until its next message (a daily routine kept the runner up by accident, because the firing counts as
> work; a weekly one missed every week). `GET /internal/routines-due` (vercel cron, every 5 min;
> `packages/control-api/src/routines-wake.ts`) looks `NM_ROUTINE_WAKE_HORIZON_MIN` (10) minutes ahead and,
> for a workspace with a due slot and nothing up — no cloud machine intended up, no laptop beating — bumps
> the runner through the same credit-gated wake a message uses. Never the whole fleet, never a member's
> machine: the daemon's own sleeper rung handles those once it is up. The rest of layer 3 (waking on
> navigation) stays held as written below.

Wake on **navigating to a machine-backed surface** (Terminal tab, a task's Files or Logs) — a real predictor, minutes ahead of need — never on window focus.

Needs all three guardrails, or it becomes the free-tier bug above:

1. **Cap headroom** — never speculatively wake a free workspace near its limit.
2. **Short leash** — a speculative wake gets a reduced `idle_stop_min` (~5), promoted to the normal 30 on first real use. *Requires a schema field.*
3. **Rate limit** — one speculative wake per workspace per N minutes.

**Policy differs by plan, deliberately.** Cloud is uncapped, so presence-driven waking there is a pure win; free gets intent-only. Not a paywall on comfort — on free, a wasted wake costs the user something real.

Held until layer 4 is decided: anticipatory waking a 146-second machine is far less attractive than a 15-second one, and the leash field is schema work worth doing once, with the right number in hand.

## Layer 4 — the wait itself

Every pixel in layers 2–3 manages a **146-second** cold start: 59s node provision, 10s scheduler bind, **68s PD CSI driver race**, 4s image pull ([docs/42](../../42-browser-terminal-and-relay.md), and the cluster research). Warm capacity removes ~130 of it.

At ~15s this screen is a flicker, and layer 3 stops being a cost calculation. Three balloon pods ≈ **$79/month** with zones open (one is ~$26 but only covers a third of new workspaces, since `nm-xfs` is deliberately region-wide). Worth re-pricing now that a user-visible feature depends on it — before, it only bought agent latency.

**The best version of this design is one nobody looks at for long.**

## Out of scope

- Waking on window focus or app open (see *the number*).
- Reporting real pod phase to the client (the two-state copy removes the need).
- Desktop: its terminal is local and needs no machine.
