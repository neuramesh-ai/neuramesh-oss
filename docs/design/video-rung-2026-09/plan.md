# The video rung: Seedance 2.0, Kling 3.0 and MiniMax H3 through one fal.ai key, metered on credits

Design round 1, 2026-09-19, revised with George's decisions and built the same day. Issue #539.
Canvas: `canvas.html` beside this file (built by `build.mjs`, eight boards), published at
https://claude.ai/artifact/Y1QqudvPEWkhNEHUrncpgh.

George's two rules for this round: "we'll use a fal.ai key on the backend and limit usage based on
cloud credits", and "configure multiple models support so we can easily switch video generation
models with an env variable". The key is set in the main `.env` and on Vercel.

## 1. What the person sees

The same video card as #535 (caption, folded script, shot direction, Generate video), with five
changes. Boards A to E.

1. **The facts line, before the press.** Beside Generate video: `Seedance 2.0 · 8 s · about 194
   credits · 2 min`, read from `GET /v1/starter/video`. A spend is never a surprise.
2. **Filming.** The press posts the marker as today. The door answers 202 and stamps `video_pending`
   on the draft, so the state survives a reload and shows on every machine. The card holds a quiet
   progress row with the model, the length and the credits. plume says the same in the thread.
3. **The film landed.** The clip plays where the picture stands. The facts line records the model,
   the length, the credits and the time. Film again spends again and says so.
4. **When the lane cannot film.** Out of credits: the row names the price and the two ways forward
   (Add credits, or a Google key). With a Google key set, the rung falls to it on its own and the
   facts line reads `Gemini Omni Flash · your key · no credits used`. With neither, the card says
   video is not set up here. The local stack reads the third state (CLAUDE.md #5).
5. **Where the spend shows.** Settings › Connections › Image generation gains one Video line, a
   statement not a control. The credits card lists every film as a row (model, draft, length, the
   session) and a refund beside a failed one.

No picker. No new command the human presses. Nothing publishes a clip through a connector.

## 2. How it runs (board F)

**On the machine.** `host/videogen.ts` `VIDEO_MODELS` gains a `kind: 'starter'` rung, first in the
ladder. The daemon's `filmDraft` asks the door once with the film prompt, the item and the workspace.
`202` means the server owns the film from here. `402` (no credits) or `503` (no lane, the local
stack, no key) sends the rung down to the person's own Google key, exactly the lane #535 shipped.
The machine never holds `FAL_KEY` and never polls fal.

**On the server.** `POST /v1/starter/film` beside `/v1/starter/generate`, the same order of guards:
member gate, **balance first** (`NO_CREDITS` 402), `UNAVAILABLE` 503 on the local stack and when
`FAL_KEY` or the model list is unset, then price, debit, submit, row, 202.

- The registry (`starter-video.ts`): one entry per model key, with the fal endpoint, the input
  mapper (aspect ratio, duration, resolution, audio), the per-second list price in µUSD by
  resolution, a label. `STARTER_VIDEO_MODELS` (env, comma list of registry keys) picks the active
  model first and the fallbacks after it. A fal answer of "endpoint unavailable" at submit moves to
  the next key. `STARTER_VIDEO_SECONDS` (default 8) and `STARTER_VIDEO_RESOLUTION` (default 720p,
  MiniMax 768P) are the two knobs beside it. *Superseded by decision 2 in §6: the env variable is
  `NM_VIDEO_TIERS` (tier=model pairs), the seconds knob is `NM_VIDEO_SECONDS`, the resolution is
  the model's own, and a refused submit refunds instead of moving to a fallback.*
- The submit: `POST https://queue.fal.run/{endpoint}` with `Authorization: Key $FAL_KEY`, the
  model's input, `X-Fal-Request-Timeout` at eight minutes. fal answers `request_id`, `status_url`,
  `response_url` in under a second.
- The row (`0140_films`, server-only, never published): id, workspace, item, model key, fal
  endpoint, request id, micros held, status (`queued` · `running` · `done` · `failed`), error,
  created and updated. `content_items.media.video_pending = true` at submit.
- The cron: `/internal/films-due` on the announce cron's minute, the open rows oldest first:
  `GET status`. `COMPLETED` → `GET response` → download `video.url` (8 MB cap, sniffed) →
  `attachContentMedia` as the system actor → `video_id` on the draft, `video_pending` cleared,
  the row `done`. `error` or a status older than the timeout → refund, `video_error` on the draft
  (Try again on the card), the row `failed`.
- The price: `priceFilm(modelKey, seconds, resolution)` in `shared/rates.ts` beside
  `priceModelCall`, from the registry's per-second rate. At cost is the proposal (the Starter brain
  meters at list price). Charged at submit, refunded on failure: `credit_grants` gains
  `kind = 'refund'` (a one-line CHECK change in the same migration) and `machine_usage` gains
  `video_micros` and `video_seconds`, so the dashboard's daily meter shows films beside model
  calls. `spendCredits` takes a `kind` so a film is not a model call with zero tokens.
- `GET /v1/starter/video` (member): the active model, its label, seconds, credits, and whether the
  lane is served here. The card's facts line and the Settings line read it, cached per session.

**What does not change.** The marker, the wake, the media lane, the members-only media read, the
card's fold, the one-media-per-draft rule, the Google lane.

## 3. The registry as researched on 2026-09-19 (board G)

| key | fal endpoint | inputs the lane sends | price, 720p with audio | 8 s clip | credits |
|---|---|---|---|---|---|
| `seedance-2.0-fast` | `bytedance/seedance-2.0/fast/text-to-video` | `resolution: "720p"`, `duration: "8"`, `aspect_ratio: "9:16"`, `generate_audio: true` | $0.2419 /s | $1.94 | 194 |
| `seedance-2.0` | `bytedance/seedance-2.0/text-to-video` | the same | $0.3034 /s | $2.43 | 243 |
| `kling-3.0` | `fal-ai/kling-video/v3/standard/text-to-video` | `duration: "8"`, `aspect_ratio: "9:16"`, `generate_audio: true` | $0.126 /s | $1.01 | 101 |
| `kling-3.0-pro` | `fal-ai/kling-video/v3/pro/text-to-video` | the same | $0.168 /s | $1.34 | 134 |
| `minimax-h3` | `minimax/h3/text-to-video` | `duration: 8`, `resolution: "768P"`, `aspect_ratio: "9:16"` | $0.06 /s | $0.48 | 48 |
| `minimax-h3-max` | `minimax/h3-max/text-to-video` | the same | $0.04 /s until Sep 30 | $0.32 | 32 |

Every model answers `{ video: { url, content_type, file_name, file_size } }` on the response URL.
The queue contract is one for all: submit, `IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`, an `error`
field on a completed failure, `PUT cancel`. Prices are fal's list prices on the day. The registry
pins them with the date and the build reads them back before shipping.

## 4. The options (board G)

- **Who picks the model: one env variable on the server.** No picker, the app reads and says.
  A per-workspace picker is a later round. The agent never picks.
- **Who pays first: the Starter lane, the own key on 402 or 503.** One press, one outcome, the
  card names the lane. The own-key-first order would leave the platform models unused.
- **When the clip is charged: at submit, refunded on failure.** The guard runs before the spend and
  two concurrent presses cannot overspend. Charging on completion is the Starter brain's shape
  only because a reply is seconds.
- **How the server waits: a films row and the minute cron.** fal's webhook is the v1.5 fast path
  with the cron as the backstop. The desktop never polls fal.

## 5. Definition of Done

- The door refuses before it spends (`NO_CREDITS`, `UNAVAILABLE`, `NOT_PERMITTED`), debits the
  clip's price on submit, writes the row, stamps `video_pending`. Memory and pg lanes, a fake fal.
- The cron lands the mp4 on the draft. A failure refunds with a ledger row and lands `video_error`.
  Both on the pg lane. A refund never exceeds the charge.
- The desktop rung: the door first, the own key on 402 or 503, the card says which. `videogen.test.ts`.
- The card's facts line, the pending state, the three cannot-film states, the Settings line and the
  credits rows, both themes, preview-harness shots.
- Live once on the dev stack with the real `FAL_KEY`: one clip on the active model (about $2), the
  clip under `docs/design/video-rung-2026-09/evidence/`.
- Docs: this plan's §6 "Built", the marketing-os plan §17.3, docs/33 for any new token, the PR's
  Deploy notes name `FAL_KEY`, `NM_VIDEO_TIERS`, the migration and the price table.

## 6. George's decisions (2026-09-19)

1. **At cost.** A film meters at fal's list price like the Starter brain does, rounded UP to whole
   credits so the card, the charge, the refund and the history say one number.
2. **Three tiers, Seedance fast first.** The person picks a house tier, the server's env variable
   names the model behind it: `NM_VIDEO_TIERS=starter=seedance-2.0-fast,xpress=minimax-h3,premium=seedance-2.0`.
   NeuraMesh Video Starter (Seedance 2.0, 194 credits), Xpress (MiniMax H3, 48), Premium (Seedance
   2.0 Standard, 243). Pro workspaces pick under Connections. Free films on Starter, or on its own key.
3. **The models are named** beside the tier, on the card, in Settings and in the credits history.
4. **The buttons align at the bottom.** Every action a card offers (draw, film, retry, connect, add
   credits) lives in the foot's left cluster. The rows above say why.

## 7. Built (2026-09-19, branch `nm/fal-video-rung`)

Server: `video-registry.ts` (the models, the tiers from `NM_VIDEO_TIERS`, `priceFilm` in whole
credits), `fal.ts` (submit · status · result on fal's queue), `starter-video.ts` (`GET /v1/starter/video`,
`POST /v1/starter/film`, `/internal/films-due`, `filmsDue`), `store/films.ts` (the rows, both stores),
`0140_films.sql` (the rows, `credit_grants.kind = refund`, `machine_usage.video_*`,
`workspaces.video_tier`), the ledger's `spendCreditsForFilm` and `refundFilm`, `workspace.update
videoTier` (Pro only), the draft's `video_pending`, `video`, `video_error_code` media fields, the
credits history's `films` and `video` columns, the vercel cron every minute.

Desktop: `videogen.ts` asks the door first and falls to the own Google key on 402 or 503. The
`starterVideo` bridge lane. `cardparts.ts` `filmFacts` and `filmingOn`. The card's foot cluster,
facts line and pending row. The Video row with the tier radio cards under Marketing OS ›
Connections. The Video meter and the films rows in Credits.

**The film is a file** (George, after the PR: "are the videos downloadable?"): "Download the film" in
the card's menu, behind the ⋮ at the header's right (the project card's mark, quiet until the card
is hovered), on any card that shows a film. George's second word on it: not a button on the card.
The bytes the card already plays go to `saveFileAs` named `<room>-<letter>-hook.mp4` (the OS dialog
on the desktop, the browser's own download on the web, which the web lane now performs instead of
answering no). Live on the web client: the menu item produced `marketing-e-hook.mp4`, byte-identical
to the clip the cron landed (`evidence/live-download-{light,dark}.png`).

**The preview shows the film** (George: "when I click on review/schedule, the preview doesn't show
the film"): a video post previews as its card does, the caption, the script folded beside it, the
film where a picture would stand, and never the image floor (`FilmPreview.tsx`,
`evidence/live-preview-film-{light,dark}.png`). A film in flight says so, no film says "Generate video
on the card".

**A film posts to X** (George: "is scheduling going to work similarly and upload the media to X?"):
the due query carries `video_id` as the post's media (a film takes the one slot a picture would),
the X connector uploads a video as `tweet_video` on the same chunked flow and waits for X to
process it (pending → in_progress → succeeded, twelve rounds, then "publish again in a minute").
The hold that kept an image post from going out text-only now reads a video post right: its brief
is the shot direction, so the hold is the film in flight, and a video post with no film posts its
caption (the preview said so before the approve). Before this, a scheduled video post was HELD
EVERY MINUTE as "image not ready" and never went out. LinkedIn, Instagram and TikTok know pictures
only: a film there fails at publish with the way out ("Download the film from the card menu and
post it there"), never as a text post and never as an upload that dies in their words. Proven with
the fake X (the category, the wait, the tweet) and the memory store's publish pass. A live tweet
with a film is the one step not run in this round (it posts to a real account).

**Proven live** (`evidence/`): the press on card e debited 194 credits and fal accepted the film in
three seconds. The card read "Filming on NeuraMesh Video Starter (Seedance 2.0)" with the
progress row, plume said the same in the thread. The cron polled queued → running → done and
landed a 3.4 MB, 8 s, 720x1280 clip with audio (`live-seedance-hook.mp4`). The card shows the
film with "NeuraMesh Video Starter · Seedance 2.0 · 8 s · 194 credits · 19:20" and Film again.
The Video row's pick round-trips through the server (Xpress, then back to Starter). Credits shows
the Video meter and both film rows, the failed one refunded.

**Found live, and fixed:** fal's request endpoints hang off the APP (`bytedance/seedance-2.0`),
not the submit's sub-path (`…/fast/text-to-video/requests/…` answers 405), so the first cron pass
failed the film and refunded it while fal kept rendering. The lane now polls the app base and the
fake pins the shape. That first film was re-recorded by hand so the cron could land it (the clip
in `evidence/` is that one). And a price of 193.52 credits floored in the ledger and ceiled on the
card read as two numbers. A film is now priced in whole credits.

**Not in this round:** fal's webhook (the cron is the lane, a missed minute costs a minute), a film
on LinkedIn, Instagram or TikTok (their video lanes), and the film prompt's "no lettering" rule loses to a brief
that asks for burned-in captions (Seedance rendered "1. The animation when you long-press…"), a
prompt-ordering note for the next round.
