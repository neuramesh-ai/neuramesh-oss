# 01 — Product Review & Competitive Landscape

*Research date 2026-06-10. Sources verified live (GitHub API, site fetches, app-bundle string mining, npm, HN/X searches).*

## 1. The idea, reviewed

**One line:** Slack for humans + agents, where the channel itself runs the work — a per-channel orchestrator fans tasks onto an enforced board, workers execute in git worktrees on users' own machines, and review loops gate completion.

**Verdict: the idea is validated and the specific combination is unoccupied.** Three adjacent products each prove one slice and miss the rest:

- **Slock** (Botiverse; founders ex-Moonshot Kimi CLI / RisingWave) proves the *social layer* — agents as durable named teammates, machine-bound via a 2-minute `npx` daemon, an enforced task board with the exact states in your screenshots, quota-based pricing. But it is a **web app, not desktop**, **closed-source**, has **zero git story** (no worktrees/diffs/PRs in the entire production bundle), and **no orchestrator** — agents self-claim off the board, which their own blog admits creates open coordination problems.
- **T3 Code** (Theo/pingdotgg, MIT, 12.5k stars) proves the *engineering layer* — per-thread worktrees, checkpoint revert, per-turn diffs, 1-click PR, event-sourced core that survives restarts. But it is **single-user**: no team, no shared board, no cloud-synced state, no agent-to-agent review. Cautionary tale: its CLI wrapping added ~3x wall-clock on real tasks (4m35s → 15min reported).
- **OpenAgents** (Apache-2.0/MIT, ~3.8k stars) proves the *protocol shape* — clean event envelope, addressing scheme, presence/heartbeat, mod pipeline. But no board UI, no worktrees, web-first, bus factor ~1–2, already pivoted architectures once. **Borrow concepts; don't build on it.**

## 2. Competitive matrix

| Capability | Slock | T3 Code | OpenAgents | **NeuraMesh** |
|---|---|---|---|---|
| Desktop-first app | ✗ (web/PWA) | ◐ (Electron shell) | ✗ | ✓ core bet |
| Agents on user machines | ✓ daemon | ✓ wraps CLIs | ✓ launcher | ✓ |
| Team multiplayer + cloud state | ✓ | ✗ | ◐ young | ✓ |
| Orchestrator → worker fan-out | ✗ self-claim | ✗ human-driven | ◐ emergent | ✓ **differentiator** |
| Git worktree isolation | ✗ (0 hits) | ✓ per thread | ✗ | ✓ per task |
| Kanban + enforced state machine | ✓ | ✗ | ✗ | ✓ |
| Structured review loops (agent+human) | ◐ chat-based | ◐ human reads diffs | ✗ | ✓ **differentiator** |
| Validation artifacts on tasks | ◐ | ◐ diffs only | ✗ | ✓ screenshots/tests/diffs |
| Offline-capable client | ✗ | ◐ local SQLite | ✗ | ✓ |
| Persistent agent memory | ✓ MEMORY.md | ✗ | ◐ thin | ✓ channel-scoped brain |
| Standard agent protocol | ✗ proprietary | ✗ | own ONM | ✓ **A2A 1.0** |
| Source posture | closed | MIT (no contribs) | Apache/MIT | closed cloud + OSS daemon (rec.) |

## 3. The wedge (exploitable gaps)

1. **Nobody has the managed orchestrator.** Slock is decentralized claiming; T3 is human-as-orchestrator. A planner that decomposes, fans out claimable cards, and runs review loops is open ground between them.
2. **Slock has no git story.** For engineering teams it's chat+board without code-safety rails. NeuraMesh is "Slock for people who actually merge code."
3. **T3 has no team layer.** Cloud-synced team state vs their local SQLite is a clean wedge.
4. **The fast desktop lane is open.** Slock is web-only; T3's wrapper adds measurable latency. Keep runtime I/O pass-through thin; benchmark vs raw CLI as a release gate.
5. **Trust lane is open.** Slock is closed with zero organic community footprint; "my agents route through their cloud" is unanswered. Recommendation: **open-source the daemon + protocol, keep the cloud closed** — answers the trust objection without giving away the SaaS.
6. **Standards lane is open.** Neither speaks A2A. Agent Cards + A2A 1.0 (Linux Foundation, v1.0.0) make NeuraMesh the interoperable choice and unlock phase-2 external agents.

## 4. What we steal (with attribution)

| Source | Mechanic to adopt |
|---|---|
| Slock | `npx` daemon → machine appears in UI → agent bound to machine (2-minute wow); enforced status transition machine; task **claim** protocol ("system, not AI manners"); pull-based **Agent Inbox**; **Held Draft** (room-version marker on send; revise/send/silent on conflict); per-machine/per-agent quota pricing; `llms.txt` |
| T3 Code | Event-sourced core (commands → immutable events → projections → replay-on-reconnect); worktree layout + prefixed branches; checkpoint = turn boundary with hard-reset revert; 1-click PR via `gh`; supervised per-edit approval mode |
| OpenAgents | Event envelope + dot-namespaced types + `in_reply_to`; addressing scheme (`agent:`, `human:`, `channel/`); progressive verification (anon → token → JWT/DID); heartbeat presence + session revocation; @mention-gated wake discipline |
| mem0 / Letta / Graphiti / gbrain | extract→reconcile memory writes; shared editable channel summary blocks + sleep-time refresh worker; bitemporal fact validity; pgvector HNSW + BM25 + RRF hybrid recall |

## 5. Risks

- **Slock ships daily** and could add an orchestrator/git story; our durable edges are desktop-fast UX, worktree review loops, A2A standards posture, and execution speed. Watch their changelog.
- **Solo + 6 weeks** is aggressive: the cut list in [04-build-plan.md](04-build-plan.md) is the contract. Anything not on the loop is out.
- **Anthropic dependence** in v1 (mitigated: adapter seam + A2A means runtime diversity is additive, not a rewrite).
- **Agent reliability** — the review loop *is* the mitigation; requirements-confirmation gate stops bad starts early.
- **Distribution** — neither competitor cracked HN/PH; a Show HN with a live orchestrator fan-out demo (the thing nobody has) is the lane. Publish `llms.txt` so AI search describes us correctly.

## 6. Positioning, pricing, GTM (sketch)

- **Positioning:** "The agent-native workspace where every channel has memory, roles, tools, tasks, approvals, and autonomous workers built in from day one." Sub-line: *your code never leaves your machines; your team's state is always in sync.*
- **Pricing (validated by Slock's axis, adjusted to seats):** Free — 1 machine, 3 agents, 3 channels, 30-day history. Team ~$20–25/human-seat — 8 machines, 40 agents, unlimited history. Business — SSO, audit, policy controls. **BYOK inference** (no token resale) keeps margins clean; platform-managed keys + billing in phase 2.
- **Memory note:** supermemory and gbrain were evaluated (see research): neither models channel-state memory natively; supermemory's hosted path blows the <200ms recall budget and adds seed-stage vendor risk in the hot path. **Own Postgres+pgvector spine** (~2–4 weeks), cribbing the four patterns above; gbrain optional later as an MCP-attached "company brain" sidecar — not in the critical path.
