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

## Amendment 2026-09-27: every draft has a place to ask, and the marker writes the brief

George, on the web and the phone: "i get this error if i ask to generate an image on a draft", with
the card's strip "No image: this draft has no conversation to ask in". Three gaps stood behind it.

1. **A draft with no conversation.** The scheduled draft run (`host/schedules.ts`) saves each
   draft with a schedule id only, so the tab had no thread to ask in and refused.
2. **A task draft.** The tab read `threads.task_id`, which only the old chat-to-task upgrade
   writes. Plan-first units anchor through `tasks.origin_thread_id`, so most task drafts had no
   thread row to find either.
3. **A draft with no brief.** The machine answered the marker with `generateDraftImage`, which
   refuses a draft with no brief. This round's own ruling above called that refusal "right for a
   conversation and wrong for a button". The marker is now only ever a button (the tab, the
   phone, the thread card), so the marker runs the button's draw.

The fix, one rule per gap:

- **Where the ask lands** (`apps/hq/web/webnm-content.ts`, `apps/mobile/src/post-sheet.tsx`): a
  thread draft asks in its thread. A task draft asks on its task, as the task card's own button
  does. A draft with neither gets a home: the ask opens a session in the draft's room over HTTP,
  then the new human-only command `content.anchor` moves the draft into it. Only a draft with no
  thread and no task moves, and only into a conversation in its own room
  (`store/content-anchor.ts`). The card then shows in that session, and the next ask lands there.
- **The ask's words** (`drawAsk`, `@neuramesh/shared` images.ts): the first paragraph names the
  draft by its first sentence, so the session it opens takes a readable title. The marker rides a
  paragraph of its own.
- **The machine's answer** (`host/drawdraft.ts`): the marker runs `drawDraft`, the calendar
  button's own draw. A draft with no brief gets one written from its post first, and a reason the
  draft carried is cleared before the draw, so a retry that fails the same way is a new outcome.
  A draw runs no model, so neither wake path asks the seat's login for it. A task-draft ask wakes
  the orchestrator in any state where no agent holds the work (`unaddressedWake`).
- **The wait** (`apps/hq/src/marketing/drawwait.ts`): the tab's modal waits for the outcome, a
  new thumb or the machine's reason, and never for the first change on the row. The brief now
  lands first, and a modal that stopped there never showed the picture.
- **The phone** (`canDrawPicture`): the button shows on every draft but a video post. Before, it
  needed a brief and a thread or task, so a scheduled draft had no button at all.

A fourth gap showed up only in the end-to-end run, which is why the run matters:

4. **A cloud machine had no picture to show.** The machine wrote the brief, and the image model
   returned a picture, but the draw still ended "the image came back empty". `imagegen.ts` made
   the card's thumb, the publish copy and the shelf copy with Electron's `nativeImage`, and a cloud
   machine runs the daemon without Electron (`import('electron')` throws there). So every picture a
   cloud machine drew came back empty: draft images, `share_images` and product shots. The three
   copies now share one resize step. The desktop keeps `nativeImage`, and a machine takes
   `imagecodec.ts`: PNG and JPEG decode (pngjs, jpeg-js, both pure JS), an area-average downscale,
   and a JPEG encode.

### Evidence (2026-09-27, the local web + cloud harness)

A cloud machine in k3d ran this checkout's daemon image, the API ran this checkout on the port the
machine dials, and the browser client and the phone ran this checkout too. Each run seeds a draft
the way the scheduled draft run makes one: no thread, no task, no brief.

- **Web** (`scripts/capture-draft-image.mjs`, real Chrome over CDP, both themes): the calendar
  modal before (`evidence/1-draft-no-home-*`), the ask (`2-asked-*`), the machine's picture in the
  modal (`3-outcome-*`, drawn on gemini-3.1-flash-image with a brief the machine wrote), and the
  session the ask opened with the card and rex's reply (`4-session-*`). No login notice appears.
- **Phone** (iOS simulator, Paper and Graphite): the sheet offers Generate a picture on the same
  kind of draft (`5-phone-draft-*`), and the picture lands on the open sheet with Open the room now
  shown (`6-phone-drawn-*`).
- **Before the image swap**, the same web ask reached the old machine image, which answered with
  a seat-login notice and "That draft has no image brief to draw from". That is the reported bug,
  reproduced end to end.

What ships when: the command, the tab and the modal ship on merge. The phone ships on its next
build. The machine half (the brief, the wake rule and the codec) reaches the cloud machines on the
next `fleet-vN` tag, and desktops on the next desktop release. Until the tag, a draft with no brief
still gets the old refusal, and a cloud draw still ends empty.

## Amendment 2026-09-27 (later): the brief shows, and the wait draws in dots

George, on the live web app after `fleet-v2`: "it just keeps spinning forever", "when we click on
generate image, it should generate a brief for the image", "find a nice way to show the image
description or brief in the drafts preview", and "improve the image generation animation … a dotted
generator animation … similar to the one we use for the in-chat generation". His test ran during the
fleet roll, so the old machine image answered it (a draft with no brief, refused, no reason on the
row). The new image writes the brief first, and production drew with it the same hour. The floor did
not show any of that, so this round makes it visible.

- **One frame** (`apps/hq/src/marketing/ImageFloor.tsx`): the picture, or the dashed invitation, or
  the dot field while the machine works, with the brief at its foot in the thread card's own words
  ("image brief"). Past three lines the brief scrolls. Two `local` covers ride the text and hide two
  `scroll` shades, so a shade shows only where more text is. A draft with no brief says so and says
  that Generate image writes one.
- **The dot field** (`DotField`): the dots that pulse in the drafts strip (`mkdot-pulse`,
  DraftingCard), grown to the picture's footprint, 28 by 14. Each delay walks the dot's diagonal, so one wave
  crosses the field per pulse. The thread card's "drawing…" box wears the same field. It is the
  picture's placeholder, not agent liveness, so the orb ruling (docs/33 §7) does not apply, and it is
  the surface's one heartbeat: the ticker dot, the brief's placeholder bars and a rewrite's ghost
  lines do not move.
- **Two steps** (`usedraw.ts`, `drawwait.ts freshBrief`): the poll shows the brief the moment the
  machine writes it, and the ticker moves from "writes the image brief from the post" to "draws the
  picture from the brief". A rewrite shows ghost lines until its new post and brief land.
- **The modal stays open** when the picture lands. A conversation closes the modal on `onChanged`,
  so the draw's own wait no longer calls it: every list polls itself. A second draw while the modal
  stays open waits for a picture newer than the first one, not newer than the snapshot it opened with.
- **A failure before the draw goes on the card** (`host/drawdraft.ts`): a brief the model leaves
  empty, and a rewrite that comes back unusable or does not save, now write the reason to the row,
  so a tab and a thread card stop their wait. Before, the reason went only into the thread reply,
  and the tab waited three minutes.
- **Not in this round:** the desktop's own floor (the desktop takes a web feature when someone ports
  it), Instagram and TikTok previews (no floor there), and a retry that fails the same way within
  a second (the poll may not see the cleared reason, so the tab shows its three-minute line).

Two fixes from the same report are in this round too. A card that only records a brain switch
(the routine fallback, `switched: true`) sends no push, as it already mints no needs-you item
(`push.ts`). The phone's bubble drops the machine markers, so the phone's own draw no longer prints
`‹gen-image:…›` under its words (`apps/mobile/src/card-strip.ts`).

### Evidence (2026-09-27, later)

- **Web, live** (`scripts/capture-draft-image.mjs`, the same harness: a k3d cloud machine on the #661
  image, this checkout's API and browser client, real Chrome, both themes): `floor-1-no-brief-*` (a
  draft with no brief), `floor-2-brief-step-*` (the dots and step 1), `floor-3-picture-step-*` (the
  brief the machine wrote shows, step 2), `floor-4-landed-*` (the picture with its brief) and
  `floor-5-session-*` (the card in the session the ask opened). The machine wrote the brief, then
  drew on gemini-3.1-flash-image, and the brief on the floor equals the brief on the row.
- **Phone** (iOS simulator on this checkout's Metro, Graphite and Paper): the two sessions the live
  web runs opened show the ask as its words only, with no `‹gen-image:…›` under them
  (`floor-6-phone-ask-*`).
- **The preview harness** (`?client=web`, `preview/mock-draw.ts`) plays the same steps, and
  `?draw=brief|picture|fail` holds each one still for a capture that a live run cannot hold. The
  sheets `floor-0-states-*` show every state in each theme, the failure and the thread card too.
