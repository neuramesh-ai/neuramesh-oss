# Calendar image generation — draft, draw, re-angle (2026-08-20)

**Status: BUILT same day (2026-08-20)** — approved verbatim (tiles stay clean; batch parked). Mockup: [mockups/calendar-image-gen.html](../../../mockups/calendar-image-gen.html).

## The gap, live

The calendar's needs-a-slot strip holds 49 drafts, 10 with no image. A draft without a picture
can only get one today by finding its thread and pressing the card's Generate button — and that
button politely refuses when the draft has no image brief, which routine-born drafts mostly
don't. From the calendar (where the human is actually standing when they schedule), there is no
image affordance at all: the modal shows the empty tweet and offers Approve · schedule.

George's ask, verbatim shape: click a no-image draft → one button → rex takes the context,
writes the brief, draws — live on the open card → regenerate, or redraft the whole post from a
different angle → schedule.

## What already exists (and what's genuinely new)

| piece | state |
| --- | --- |
| `generateDraftImage(agent, ch, itemId)` — draws ONE draft from its existing brief, records thumb/image_error ON the card via `content.attach_media`/`content.revise` | **exists** (host/content.ts, the `‹gen-image:›` marker lane) |
| brand tokens + credential ladder (`designerImageCred` → `brandTokensFor` → `generateBrandImage`) | **exists** |
| revise lane: `content.revise` takes body / imageBrief / thumb / imageError | **exists** |
| brief-writing for a brief-less draft (the 10 of 49) | **new** — one LLM one-shot from post body + platform + brand |
| whole-post re-angle (new body + new brief + new image, in place) | **new** — one LLM one-shot + the same draw |
| a direct entry from the calendar modal (no thread detour, no marker message) | **new** — one IPC |
| live progress in the modal | **new** — renderer state machine |

## Mechanics

### One host entry: `draftImageFor(itemId, opts)`

`apps/desktop/src/main/host/content.ts` grows one exported function beside `generateDraftImage`:

```
draftImageFor(itemId, { angle?: string; rewrite?: boolean })
  → { ok: true, thumb: string } | { ok: false, error: string }
```

1. Resolve the item from the replica (`status='draft'` only — same guard the marker lane has)
   and its channel; pick the **acting agent**: the channel's marketer, else the orchestrator
   (both are `HostedAgent`s the daemon already holds; commands post with that identity, so the
   room's papertrail names who drew).
2. **`rewrite`**: one LLM one-shot (the acting agent's model via the existing `directComplete`
   seam) — post body + platform + brand voice + the optional `angle` in, **new body + new
   brief** out (strict JSON, zod-parsed). Persist via `content.revise { body, imageBrief }`.
   The angle is optional: absent, the instruction is "same message, different creative angle."
3. **No brief and not rewriting**: the same one-shot writes **only the brief** from the body
   (never touches the copy). Persist via `content.revise { imageBrief }`.
4. Draw: the existing brief-to-pixels path (`designerImageCred` → `brandTokensFor` →
   `generateBrandImage`) → `content.attach_media` (hosted bytes) + `content.revise { thumb }`.
   Failures land as `content.revise { imageError }` — the same amber reason the thread card
   already renders, now shown in the modal too.

Steps 2–3 are the only new intelligence; step 4 is `generateDraftImage`'s existing body,
refactored so both callers share it (the marker lane keeps its exact behavior and its
"no brief → ask me for a visual" refusal, which is right for a conversation and wrong for a
button).

### One IPC: `nm:draft-image`

`{ itemId, angle?, rewrite? }` → forwards to `draftImageFor`, resolves when done (5–25s).
Registered beside the other host-backed IPC. No new sync columns, no server change — every
mutation rides the existing command lane, so cross-machine sync and the agents' own view stay
honest by construction.

### The modal (`PostPreviewModal`)

- **Image floor** (state A): drafts with no thumb/media render a dashed 16:8.4 slot in the
  tweet's media position with one button — `✦ Generate image` — and a one-line hint naming what
  will happen ("rex writes the brief from the post, then draws it here").
- **Generating** (B): the slot becomes a shimmer canvas (same footprint, zero layout shift);
  a docs/17-style one-line ticker under it names the live leg (`brief ✓ · drawing —
  gpt-image-2`). Foot buttons disable. **Closing the modal does not cancel** — the result lands
  on the card via the command lane and syncs in regardless; reopening shows it.
- **Landed** (C): the image renders in the tweet slot; under it a quiet right-aligned row:
  `drawn by rex · <model>` · `↻ Regenerate` (same brief, new dice — the existing Try-again
  semantics) · `✎ New angle`.
- **New angle** (D): the row swaps for one inline input (optional plain-words angle, teaching
  placeholder) + `Rewrite post` + `✕`. During the rewrite the body wears ghost lines and the
  slot shimmers; the redrafted body/image settle in place. Esc backs out.
- **Failure**: the `imgerr` strip (amber keyline, the card idiom) with the reason and
  `Try again`.
- Progress is renderer-local state around the awaited IPC promise, then `onChanged()` refetches
  the row — the same freshness contract every other mutation in this modal uses.

### Placement rulings (docs/33)

- The floor lives **in the modal**, not on the calendar tiles — the tile row is a scanning
  surface; the header's `10 no image` tally already counts. No tile buttons.
- Generate/Regenerate/New-angle live **inside the card** because they mutate the card;
  Approve · schedule stays in the modal foot because it mutates the calendar. Two different
  verbs, two different homes.
- Dashed slot = the phase-spectrum "declared but unstaffed" idiom. Shimmer + ticker = the beats
  idiom. No washes, no spinners, motion ≤150ms on state swaps (the shimmer is ambient).

## Tests

- Host: brief-less draft → one-shot writes brief → revise + draw + attach (fake completions +
  fake image gen, asserting the exact command sequence); rewrite → body+brief revise precedes
  the draw; no image key → `imageError` revise and an `ok:false` with the same words; non-draft
  item → refused.
- The marker lane's existing tests keep passing untouched (shared body, unchanged contract).
- Renderer: floor renders only for imageless editable drafts; busy disables the foot; imgerr
  renders from `image_error`.

## Budgets

Brief one-shot ~1–3s; image 5–20s. The modal stays interactive throughout; the IPC is awaited
per-item (no queue — one draft at a time is the human's actual pace here).

## Non-goals / parked

- **Batch "generate all 10"** — parked until the per-draft loop proves the quality bar; a
  batch button on the needs-a-slot header is the obvious later home.
- Video, non-draft statuses, IG/TikTok-specific crops (the brand pipeline already sizes per
  platform), scheduling changes of any kind.

## Amendment 2026-09-05 — the browser asks, the machine draws

George, on the web app: "a bug when I try to generate an image from a scheduled draft." The modal's
button called `draftImage`, a DIRECT act into the agent host in the desktop's own process; the
browser client had stubbed it with "open this workspace in the desktop app", written before the
browser had a cloud machine. Now the tab ASKS: `webnm-content.ts` posts the card's own marker
(`‹gen-image:<item>›`) as a message into the draft's thread (its `thread_id`, else its task's thread
via `threads.task_id`), which whichever machine wakes for that thread answers by drawing onto the row
(`host/wake.ts`, no model turn); a rewrite — with or without an angle — is asked in words, which the
marketer's revise turn answers with `revise_posts` and a redraw. The lane returns `{ ok, pending }`,
the modal shows "asked your cloud machine to draw — the card updates when it lands" and polls the
room's items until the row's `media` changes (a thumb, a new body, or the machine's `image_error`),
then stops. Only a draft can be redrawn, as on the desktop; a draft with no conversation says so. The
desktop keeps its in-process draw. Proven on the dev stack up to the machine: the marker lands in the
thread as `/v1/messages` row; the dev workspace hosts no agent on a live machine, so the draw itself
was not observed there — in production the member's cloud machine hosts them.

### Amendment 2026-09-05 (later) — and then the machine could not draw

George, from the calendar: the card starts, then falls back to "still drawing — try again". The half
that was never observed is where both bugs were, and they compound:

1. **The gate asked the wrong question.** A wake runs `shouldClaim` first, whose top rung is "can this
   machine serve the agent's runtime?" — and a draw runs **no model turn**. So a cloud machine with
   no CLI logged `wake_skip … cannot serve claude-code` and drew nothing. `ClaimContext.modelFree`
   now exempts work that needs no runtime, set from the trigger's own body through the ONE marker
   matcher (`genImageItemId`, shared) that the gate and both wake paths read — they had three copies
   of the regex and only the two runners' copies were consulted.
2. **The machine had no credential to draw with.** Every owner-lane `/v1` call from `machined` went
   out with no bearer: `apiAuthHeaders` mints a *Clerk* token, there is no Clerk session on a cloud
   machine, and the catch sent the actor header alone — which production refuses (`AUTH_REQUIRED`)
   since the header lane closed on 08-30. `/v1/credentials/resolve` therefore returned nothing, so
   the image key looked absent; and the `content.revise` that writes `image_error` onto the card was
   refused too, which is why the card said *nothing* rather than "no image key". The daemon now signs
   with the machine token it already holds (`NM_MACHINE_TOKEN`, `nmm_…`) — the credential the /v1 gate
   was already built to accept (`resolveMachineActor`: an agent must live in the machine's workspace,
   a human actor must be its owner; both hold for these calls).

The lesson for this doc's own "proven up to the machine" line: a lane that ends at a machine is not
proven until a machine runs it. The 401 was visible in the pod logs for a day as a 5-second
`refresh_block` loop before the calendar made it a user-facing bug.
