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

## 8. Lettering, length and the refine loop (2026-09-19, George's three points on the UGC films)

George: "our generated ugc videos with seedance always have the text in the video muddled up";
"we are limited to 8s of video across the neuramesh video models, we need to allow generation of
longer videos that seedance supports, and during the prompt ui card requirements collection for
the ugc we can also ask the user what length they want"; "we need to support the ability for a user
to refine the video script before generation, the reply icon seems hidden on the card, lets test
if it works". Researched against fal's Seedance 2.0 prompting guide, fal's OpenAPI for every
endpoint in the registry, and the troubleshooting guides (sources in the PR).

### 8.1 Why the text was muddled, and what changed

1. **A video model typesets like an image model.** Every guide says the same: lettering is
   texture to the model, and past one or two large words it draws plausible glyphs that spell
   nothing. The live films agree (`brand-grounding-2026-09/evidence/harness-frame-film-frames.png`:
   "Nro-lact", "MMulsoncs"; the first Veo film: "no lapop, still shoping"). The reliable text is the
   text the model never draws.
2. **The prompt was too long to hold its own rule.** The guides put the sweet spot at 30–100 words
   and name "instruction dropout" past ~150 (the model quietly ignores what it cannot reconcile).
   The old prompt ran to 1,400 characters and pasted the marketer's whole 2,000-character brief in
   after "render no text", so a brief that asked for burned-in captions won every time (§7's
   "not in this round" note). The old reference clause then asked for the screenshot's lettering as
   "the only lettering in the film", which invited the re-typesetting of every small label.
3. **Compression.** fal's Seedance endpoints take `bitrate_mode: high` at the same price; the
   standard rate smears small type and edges first. The lane never set it.

**Built.** `shared/filmprompt.ts` is the ONE builder (the daemon's own-key rung, the door's prompt,
and the card agree): a shot brief in fal's own order (subject, motion, look, camera, audio), the
spoken lines in double quotes (what the model lip-syncs), an explicit audio line (a prompt silent
about sound comes back scored), the brief cut to a 22-word LOOK with every sentence that asks for
lettering dropped and every quoted phrase removed, and a 1,000-character cap that drops the look
first, then the last cut, never the text rule. The text rule is one clause: **a clean plate by
default** ("No on-screen text, no subtitles, no captions, no logos.") and the one case the guides
say works, asked for exactly: a caption of at most three short words becomes "One on-screen title,
large and centered in the lower third, exactly: "…"". A longer caption is never asked of the
model: the caption that posts is the body. The registry sends `bitrate_mode: 'high'` on every
Seedance lane, the reference clause asks for the screen "exactly that: the same layout, colors and
shapes. Invent no other interface, add no labels, add no text", the film row cap rose to 40 MB
for the larger encode, and `/v1/content/media/:id` streams its bytes (a buffered function response
caps at 4.5 MB on the hosted API; a streamed one does not).

**What this does not do, said plainly:** it does not make the model spell a sentence. The reliable
way to put exact words on a film is a second pass that overlays them (the guides' "two-pass"
workflow: a clean plate, the copy on an editable layer). That is a rung of its own: a caption
rendered with the release card's resvg + NeuraMesh Sans and composited on the clip, on a machine
that has ffmpeg (the cloud image can; the hosted API cannot). Not built here.

### 8.2 The length

Every model in the registry films past eight seconds: Seedance 2.0 fast and standard 4–15 s,
Kling 3.0 3–15 s, MiniMax H3 5–15 s, and **Seedance 2.5** (added: `bytedance/seedance-2.5`,
$0.473 a second at 720p, the same reference lane) 4–30 s in one take. The registry carries each
model's range; `NM_VIDEO_SECONDS` is the default (eight), held inside the range.

- **The angle card asks.** `propose_angles` reads the door's catalog and the card carries the
  lengths the workspace's tier films (`FILM_LENGTHS` = 5 · 8 · 10 · 15 · 20 · 30, those inside the
  model's range), each priced at cost by the shared `filmCredits` (one formula: the card, the
  charge, the refund and the history say one number). The row is a radio of chips with the picked
  one's price beside it; eight seconds picked by default. One length, or an unserved lane (the
  local stack), shows no row.
- **The pick rides the draft.** The answer reads "… · platforms: x, linkedin · length: 15 s"; the
  daemon reads the length off it by code (`pickedLength`), never from the model's retelling, and
  every video draft carries it as `media.seconds` (`content.create`/`content.revise` take
  `seconds`; `draft_posts`/`revise_posts` take it too for "make it twelve seconds" in prose).
- **The door holds it.** `POST /v1/starter/film` reads the draft's `seconds`, clamps it to the
  tier's model (a 30 s pick on Seedance 2.0 films 15 and the 202 says so), prices the clip by it,
  and the films row records it; the timeout grows with the length (twelve minutes, forty seconds a
  second past eighteen). The own-key lane films what Google allows (Veo 4/6/8, Omni to ten) and
  says so.
- **The prompt films the first N seconds of the script**, not only the hook: the beats that start
  inside the length, sequenced as cuts, at most three. The card's facts line prices the draft's
  own length ("15 s · about 363 credits · 4 min") and the pending row says the length.

### 8.3 The refine loop

The ↩ on the card works as designed: it arms the composer with "↩ Re draft b: …", the marketer's
conversation turn answers with `revise_posts`, and a new script drops the old film. Two things
were wrong around it. **The control read as decoration**: a bare 13 px arrow beside two labelled
buttons; it now wears its name ("Request changes"). And **the agent could not see the card it was
asked to change**: a conversation's transcript is messages, a draft is a content row, and the
agent's own `draft_posts` call is not in the transcript, so "tighten b's hook" was answered from
memory and dropped the beats the human kept. Built as a gate, not a prompt (the grounding.ts
lesson): `read_drafts` on both registries returns the cards by letter (caption, script, length,
direction, frame, the film's state), and `revise_posts` refuses to rewrite a card's text or
script this turn has not read, naming the call that lifts it.

Evidence: `evidence/harness-ugc-length-{dark,cream-oak}.png` (the angle card with the length
row, 15 s picked, "about 363 credits"), `evidence/harness-ugc-drafts-15s-{dark,cream-oak}.png`
(the answer with its length, two 15 s drafts, the facts line, the labelled Request changes, a
filmed card at 15 s). The live round, one real film included, is §8.4.

### 8.4 The live round (2026-09-20, desktop-mkos on this branch's API, Ember Forge › Launch › #marketing)

The whole loop ran once on the real stack, this branch's daemon and door, the real fal key:

1. "@plume Run the ugc scripts playbook." → plume read `business-profile.md` and `market-research.md`,
   posted the angle card with five angles, X and LinkedIn picked, and the LENGTH row 5 · 8 · 10 · 15 s
   priced 121 · 194 · 242 · 363 (`evidence/live-angle-card-lengths-dark.png`; 15 s picked reads
   "about 363 credits"). The pick posted "… · platforms: x, linkedin · length: 15 s".
2. rex (the pick woke the orchestrator) loaded the skill, read the docs again, and `draft_posts` wrote two
   15 s scripts, both carrying `seconds: 15` and `frame: app-home.jpg` off the pick, no `seconds`
   argument from the model.
3. Request changes on card a ("↩ Re draft a: Make the hook one sentence about the catch, drop the
   on-screen title in the last beat, and keep it 15 seconds.") → `read_drafts — 2 drafts`, then
   `revise_posts — a`: the hook became one sentence, the CTA beat lost its title, the three middle beats
   came back byte-identical, v2 on the card with v1 beneath it (`evidence/live-ugc-toolcalls.txt`,
   `evidence/live-request-changes-armed-dark.png`).
4. Generate video on a → the door held 15 s, charged 363 credits, submitted Seedance 2.0 fast's
   reference lane with the frame and `bitrate_mode: high`; the cron landed it four minutes and forty
   seconds after the press: 15.1 s, 720×1280, **9.6 Mbps (three times the 3.2 Mbps of the 8 s standard
   clip), 18.2 MB**, through the streamed media route (the old 8 MB cap would have failed it). The card:
   "NeuraMesh Video Starter · Seedance 2.0 · 15 s · 363 credits · 23:02 · frame · app-home.jpg", Film
   again, Request changes (`evidence/live-filmed-15s-{dark,cream}.png`, `evidence/live-seedance-15s-clean-plate.mp4`).

**The verdict on the lettering** (`evidence/live-seedance-15s-clean-plate-frames.png`): the plate is
clean. No caption, subtitle or title was invented anywhere in the fifteen seconds (the earlier films
burned "Three small things in the new update that I didn't to care about" across the creator). The
creator's beats and the cuts follow the script. The product on the phone keeps the app's layout, its
cream paper and the mark, and its **small type is still pseudo-words** ("Nermnfnsty", "Reseby"): the
model cannot copy small type from a reference, whatever the bitrate, and a 1280×800 desktop screenshot
squeezed into a phone frame gives it five-pixel letters to copy. That is the model's limit, not a
prompt's. The levers left: a screenshot with large type (a phone-sized crop, one screen), the 1080p
lane on Standard or 2.5 at 2.25× the price, and the post-production rung of §8.1 (exact captions
overlaid, a real screen recording cut in where the script shows the product).

**Found live, fixed on the branch:** (1) the first card read "lengths default": the daemon's `apiGet`
hands back the raw Response and `videoLengths` read `served` off it unparsed (`ugcflow.test.ts` now
feeds a Response); (2) the marketer's beats break the parser's assumptions three ways, all in the
first prompt this round filmed with: `Hook, straight to camera: "…"` left "Open on , straight to
camera:" with the line unspoken, a beat's own "Cut to" doubled into "Then cut to Cut to", and a
22-word look cut mid-phrase ("then a clean"). `stampLine` reads a quoted tail as the line,
`tidyDirection` drops a beat's own cut words and stray punctuation, and `cut` closes at a clause end
(`filmprompt.test.ts`, the live script pinned). The film above was submitted before the fix, with the
stray comma and the doubled cut in its prompt; the plate came back clean regardless.

**Harness notes:** the peer session's fleet harness was live on 8787 with both k3d machines, so this
round ran its own API on 8789 (`control-api-release`) and the desktop app from this worktree
(`desktop-mkos`, electron's binary copied from the main checkout's package, `.env` linked from the main
checkout). A desktop-born session ran on the desktop daemon; the cloud runner stood down as designed.
The pick's wake goes to the ORCHESTRATOR (the default responder), so `draft_posts`/`read_drafts`/
`revise_posts` ran on the orchestrator registry and `propose_angles` on plume's conversation registry:
both were exercised. One film: 363 of Ember Forge's 370 dev credits, about $3.63 of the fal key.

## 9. The product shots: the real image, cut in (2026-09-20)

George, on a frame of a Flowe film with "Medtatun pruaticalts" on the phone: "i still see mumbled
texts in the video images why?" then "lets compose the rung and ensure that actual product images
are used in the ugc videos where an actual product is needed; the agent should be able to search
the project files for actual product images or generate the product images using an image model
for the image it needs and then pass that in during the film generation automatically".

**Why a prompt cannot do it.** The reference lane hands the model the real screenshot and the model
re-draws it: layout, colors and shapes survive, letters do not. A video model has no way to copy
small type, at any bitrate. The only exact product on a film is the real image itself, cut in.

**The lane.** A script beat that shows the product carries `SHOW: <image name>` (an image on the
room's shelf, or on any shelf of the room's project). When the film lands, the cron cuts that beat's
window out of the film and the real image in, on fal's own ffmpeg utilities, synchronously, in
about twenty seconds: `trim-video` for the film's pieces around each window, `images-to-video` to
hold the framed image for the window, one `compose` call to lay the pieces on one timeline with the
film's own audio underneath, so the creator's voice runs through the shot. The frame is rendered here
with resvg (the release card's renderer): the image on a 720×1280 canvas on the house graphite,
corners rounded, never stretched (the first trial stretched a desktop screenshot into a phone's
shape). A portrait or square image is fitted whole. A wide image (a desktop screenshot, the live
case) is shown as a close-up: a 4:5 window of it, centered, because fitted whole it filled a third
of the phone's frame and its type was a fifth of the size (§9.1). `compose` alone is a single-track
concatenator ("Multiple video tracks are not supported"), which is why the pieces are made first. Best effort, never a refund: a compose that
fails lands the plain film with the reason on the card (`video.shots.why`).

**Enforced at the draft, not prompted.** `draft_posts` and `revise_posts` (both registries) refuse
a script whose SHOW name is not on the shelf, listing the images it does hold, and refuse a beat
whose words show the product (the app, a screen, the phone) without a SHOW line, naming the three
ways out: name an image, make one, or write the beat without the screen. The command refuses a
missing name again (the frame's rule). `make_product_image` (both registries) makes one on the
room's image key, shrinks it for the shelf and shelves it under the name the script will use; its
description says a made picture of an app is an invented interface and asks for a screenshot
first. `list_library` scope project is the search; the shelf lookup widened to the project on both
sides, the room's own images first.

**The card.** Before the film: `product shot · app-home.jpg` on the facts line. After: `product shot`
(or `product shots · 2 of 2`), or `product shot · not applied · <why>`.

**Not in this round.** A pan or zoom over the image (the frame holds still), a picture-in-picture
shot beside the creator, a screen recording as the shot (an mp4 on the shelf), the own-key lane
(no fal key on a machine: the plain film, the card says so), and the model's pacing: a shot's window
is the script's, and the model may have placed that beat a second earlier or later.

Evidence: `evidence/harness-ugc-shots-{dark,cream-oak}.png` (the facts line before and after), the
live round in §9.1.

### 9.1 The live round (2026-09-20, the desktop app on this branch's API, Ember Forge › Launch › #marketing)

The same walk as §8.4, on the daemon and API of this branch: the shelf holds `app-home.jpg` (the
Home screen, 1280×800), plume read it and asked the angle card with the lengths, 15 s picked, and
rex drafted two posts. **Both scripts carried `[0:03-0:08] SHOW: app-home.jpg` unprompted**: the
orchestrator's rule and the gate agreed, so no refusal round ran (the gate's refusals are covered by
`frames.test.ts`). The marketer wrote `TITLE: "Try NeuraMesh"` on one beat, which the parser had not
read as a caption: `TITLE` and `ON-SCREEN TITLE` now read as a caption, so the film asks for it as a
title and not as spoken words. The card said `frame · app-home.jpg · product shot` before the film
(`evidence/live-shots-before.png`).

Generate video: 363 credits, the reference lane, Seedance 2.0, 15 s. The cron composed on the done
tick, `shots: {asked: 1, applied: 1}`, and **the real Home screen is on the film from 3 s to 8 s**
(`evidence/live-seedance-15s-product-shot.mp4`, the frame strip in `-frames.png`): the creator
speaks over it, the film's own audio under the whole timeline. Card: `… · 15 s · 363 credits ·
13:00 · frame · app-home.jpg · product shot` in both themes (`evidence/live-shots-{dark,cream-oak}.png`).
The composed clip is 15.1 s, 720×1280, 1.0 Mbps, 1.9 MB: fal's concat encoder writes about a tenth
of the 9.6 Mbps the film came in at. The shot is a still, so it loses nothing, and the creator's
pieces look fine on a phone, but a film with product shots is no longer the high-bitrate clip. A
re-encode at a higher rate is a compose option to look at if a customer notices.

What the frame taught: fitted whole, the 1280×800 screenshot sat in the middle third of the portrait
frame with its type about 5 px tall on a phone. The frame now shows a wide image as a centered 4:5
close-up (`evidence/product-frame-wide-closeup.png`: the greeting, the composer and the session rows,
legible), and the same clip composed again through the changed frame is
`evidence/live-seedance-15s-product-shot-closeup.mp4` (34 s on fal, the strip in `-frames.png`: the
creator at 1 s, the close-up at 4, 5.5 and 7.5 s, the model's own laptop at 10 and 12.5 s). A
portrait screenshot on the shelf still gives the best shot, and `make_product_image` says so.
Elsewhere in the film the model still draws its own laptop, with its own pseudo-words on the screen:
a beat that shows the product without a SHOW line is refused at the draft, but the model adds screens
the script never asked for, and those stay drawn. The next lever there is the prompt's look line
("no screens in shot" outside the SHOW beats), not tried this round.
