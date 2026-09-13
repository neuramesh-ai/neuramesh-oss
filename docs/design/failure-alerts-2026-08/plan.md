# Failure alerts: the attention bar (2026-08-19)

> **Status:** BUILT (same day, George's "implement end to end"). All three tracks landed in one
> round: A `reauth_required` + 0121 backfill + `schedule.mark_result` + the fire path writes; B
> `deriveAlerts` (shared, vitest) + `nm:alerts` + `AlertsBar`/`BellAlerts` + harness fixtures; C
> `classifyRoutineStalls` + the watchdog's routines section + the sweep.watchdog bullet. Verified
> in the preview harness, both themes: bar collapsed/expanded (the ci-6 posts group folds under
> the kx-2 dead connector), bell Attention section + its own amber chip.
> **One deviation from the mockup:** the connector row carries only **Reconnect** — no "Open
> Connections" secondary. The Connections rail lives inside a room's Brand rail, the reconnect IS
> the fix, and a detour button would land the human somewhere they still have to click Reconnect.
> Mockup: [`mockups/failure-alerts.html`](../../../mockups/failure-alerts.html) (both themes,
> three states). Born from the 2026-08-19 live report: three scheduled X posts failed for a day
> with the reason invisible, and the only fix (reconnect X) was discoverable nowhere.

---

## 0. What was reported

*"When a failure occurs like the 403, the app should show a notification bar about that error and
on expand should show the details and a reconnect button … not just for posts — if any
routines/schedules are failing to run for any reason, rex should be able to publish the error
notification for the user … rex has a process for monitoring threads for pending items, it can
monitor if routines are failing also."*

Three demands in one: failures must **surface** (a bar on the Home stage + the bell), failures must
carry their **fix** (Reconnect, right there), and the monitoring must cover **everything armed** —
posts, connectors, routines.

## 1. Root cause — where failures go to die today

| Failure | Recorded | Surfaced | Fix reachable from the failure |
| --- | --- | --- | --- |
| Post didn't publish | `content_items.last_error` (0084) | grey chip on a calendar you may not visit; reason in the modal since this round | Publish now / Reschedule (this round) |
| Connector grant died | `connectors.status = 'revoked'` | a small status word inside Connections | Reconnect, but only if you already knew to look |
| Routine fire failed | **`console.error` and nothing else** — [schedules.ts:160-161](../../../apps/desktop/src/main/host/schedules.ts) | nowhere | none |

`schedules.last_error` has existed and synced since the column landed — **no writer, no reader**.
The routine failure class is fully invisible: the run count advances at claim time
([pgstore.ts `claimScheduleRun`](../../../packages/control-api/src/pgstore.ts)), so a failed fire
even *looks* like a run that happened.

And one recorded value is a lie of ambiguity: `markConnectorReauth` writes `'revoked'` — the same
status the human's deliberate `connector.disconnect` writes
([pgstore.ts:2493-2508](../../../packages/control-api/src/pgstore.ts)). The server distinguishes
them by ciphertext presence, which never syncs, so **no client can tell "the grant died under us"
from "I turned this off"** — and an alert that nags about a deliberate disconnect is noise the
first day and ignored the second.

## 2. The shape: derived, not stored

The bar is **a pure derivation from three synced row conditions** — never a notifications table,
never an agent post:

| Alert | Condition | Clears when |
| --- | --- | --- |
| Connector needs re-auth | `connectors.status = 'reauth_required'` | reconnect succeeds (status → `connected`) |
| Routine failing | `schedules.last_error is not null` (active rows) | next run lands clean (fire clears it) or human pauses |
| Posts didn't go out | `content_items.status = 'failed'` | re-approved, published, or deleted |

No dismiss, no ack table, no unread flag: the alert exists exactly as long as the broken thing is
broken. This is doctrine #4 (enforced, not prompted) applied to observability — the bar works
offline, costs zero agent turns, and cannot disagree with the rows. **Rex never writes the bar.**
Rex's deterministic sweep (the docs/19 stall watchdog — "the process for monitoring threads" the
report names) gains a `routine_failing` class so rex can **triage** repeat failures in the room:
detection is code, action is judgment, exactly as the watchdog already splits them.

Post failures whose reason is the dead grant **fold into the connector row** (one cause, one card,
the fix on it); the grouped posts row keeps only "Review on calendar", never a second Reconnect.

## 3. The surfaces (see the mockup)

**Home stage, topmost.** One row above the kicker, full column width: amber 3px left keyline on
`--panel2`, hairline border, ⚠ glyph in `--warn`, `N need attention` + an ellipsized summary,
chevron. It renders **only while at least one condition holds** — the pristine stage stays
pristine. Expand (≤150ms, `--ease`, reduced-motion honored) grows the same container into a
hairline-separated row stack: glyph · what broke · **the verbatim `last_error`** · project/room/when
meta (mono) · one primary action + one quiet secondary:

- Connector: **Reconnect X** (primary) · Open Connections — Reconnect fires the existing
  `nm:connector-start` OAuth round-trip; the row carries a `channel_id` of the failing project so
  the connector resolves without the user picking a room.
- Routine: **Open routine** · Pause it (`nm:schedule-status`).
- Posts: **Review on calendar** (calendar destination, project-scoped).

No fill washes on rows (the orb lesson — a wash reads as a badge), no red: `--warn` amber is the
palette's "needs a human", consistent with the facts-line warm state.

**The bell.** An `Attention` section pinned above the existing queue rows, same derivation,
condensed; the bell's one notification count includes the alert count. The bar and the bell render
from the same `deriveAlerts()` — they cannot disagree.

## 4. Build plan

### PR A — truth in the rows (control-api + daemon)

1. `markConnectorReauth` writes **`'reauth_required'`** instead of `'revoked'`. Every server gate
   already checks `!== 'connected'` ([connectors.ts:251](../../../packages/control-api/src/connectors.ts),
   [connectors-x.ts `xSearchOnConnector`](../../../packages/control-api/src/connectors-x.ts)) —
   unaffected. Renderer: [ConnectionsList `deadOf`](../../../apps/desktop/src/renderer/src/settings/ConnectionsList.tsx)
   accepts both values; the post-modal byline prettifies it ("needs re-auth").
2. Backfill migration — the ambiguity is resolvable in SQL because the secret's row survives the
   server verdict and dies on human disconnect:
   `update connectors c set status = 'reauth_required' where status = 'revoked' and exists (select 1 from connector_secrets s where s.connector_id = c.id)`.
3. New command `schedule.mark_result` (daemon/agent actor, the same actor lane `schedule.claim_run`
   uses): on a failed fire, [schedules.ts](../../../apps/desktop/src/main/host/schedules.ts)'s
   catch posts `{ error: String(err).slice(0, 500) }`; a clean fire posts `{ error: null }` so the
   alert self-clears. Store method in pgstore + MemoryStore; `schedules.last_error` already exists
   and syncs — **zero PowerSync work**.
4. Tests: command guards + write/clear round-trip; `markConnectorReauth` status value; migration
   applies idempotently (the tracked runner).

### PR B — the bar (desktop renderer, after A)

1. `deriveAlerts(connectors, schedules, failedItems) → Alert[]` — **pure**, in
   `renderer/src/alerts.ts`: fold rules (§2), grouping (posts by project × reason-class), ordering
   (connector > routine > posts), summary line. Unit-tested like beats/replypolicy.
2. One IPC read `nm:alerts` (main): three workspace-scoped selects in one handler —
   `workspace_id = ?` on every branch, `scripts/audit-workspace-scope.mjs` watches this file class.
   Refreshed on the existing watch/ping idiom the Home queue uses, so reconnect/pause/re-approve
   clears the bar without a reload.
3. `AlertsBar.tsx` (views/) mounted at the top of
   [NewChatStage](../../../apps/desktop/src/renderer/src/views/NewChatStage.tsx); `.attbar` CSS in
   tokens.css per the mockup; collapse state is per-session memory, default collapsed.
4. [BellPopover](../../../apps/desktop/src/renderer/src/shell/BellPopover.tsx): `Attention`
   section + count.
5. Preview-harness fixtures for all three alert kinds (the `ci-6` failed post + a
   `reauth_required` connector + a `last_error` schedule); both-themes captures.

### PR C — rex watches routines (daemon, after A, parallel with B)

1. `classifyRoutineStalls(scheduleRows, nowMs)` — a pure sibling in
   [stall.ts](../../../apps/desktop/src/main/stall.ts) (routines are not tasks; they don't wear
   `StallCandidate`): `routine_failing` when `last_error` is set and `last_run_at` is older than a
   settle threshold (30 min — inside it the bar already shows; rex speaks only when it *stays*
   broken). Refire key `schedule:{id}:{last_run_at}` — one firing per failed run, the watchdog's
   own idiom, sharing the 5/sweep cap. Echo mode inert.
2. Triage: rex posts one line in the routine's room (or an `nmq` card when the fix needs a human,
   e.g. reconnect) — judgment on top of the code-detected signal, exactly like every other stall
   class. Rex takes **no** mutating action on schedules; pausing stays human.
3. Tests beside the existing stall classes.

## 5. Fixed constraints

- Accept-first floors untouched; no new HUMAN_ONLY gates — every bar action is an existing
  human-lane command.
- Budgets: derivation is O(rows) over the local replica; the bar adds nothing to stage cold start
  (it mounts with data already read for Home). Motion ≤150ms.
- Both themes verified for every surface; no new tokens — `--warn` + existing strata carry it
  (docs/33: a new idiom would need a docs/33 entry; this round deliberately uses only existing ones).
- v1 says "last run failed" for routines: a consecutive-failure **streak** needs a `fail_count`
  column (migration + sync rule + re-snapshot deploy note) — deferred until the last-run version
  proves insufficient.

## 6. Open questions (answer on the PR)

1. **Placement** — topmost above the greeting (as asked and mocked), or docked above the composer
   like the capacity fly-up? Topmost is mocked; it makes failure the first read on a broken day.
2. **Phone push** — should `reauth_required` push like HUMAN_ONLY gates do? (v1.1; the plumbing
   exists in Mission Control.)
3. **Snooze** — v1 has none (condition-derived only). Live with a bar that stays until fixed?
