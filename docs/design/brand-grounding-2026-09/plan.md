# Brand grounding in conversations, and the surfaces a change must be proven on (2026-09-19)

George's bug, on the web app: "Run the ugc scripts playbook" in the Flowe AI marketing room, and
rex asked what Flowe AI does, "no brand docs or prior brand research are in this room's workspace
yet", while `business-profile.md`, `brand-guidelines.md`, `market-research.md` and
`social-strategy.md` sat on the room's shelf, in the Workbench beside the thread. His rule for the
fix: "these are agents, and our instructions should guide them on tools to use to find brand
information, and request one when not found." Then: prove it end to end on the local harness with
a cloud machine, and make every release assess its impact on web, desktop and mobile and run the
right end-to-end test.

## 1. What was wrong

1. A content TASK opens with the brand docs staged (`staging.ts`). A CONVERSATION never did: the
   orchestrator's turn and the marketer's chat turn carried the connected accounts and nothing about
   the shelf. Knowing the docs existed depended on the model deciding to call `list_library`.
2. The marketer's conversation registry had no `list_library` and no `read_library_doc` at all. Its
   own skill said "read the room's brand docs" and there was no tool that could.
3. The house model on a cloud machine, with the note in its prompt and the skill loaded, went
   `list_playbooks → load_skill → draft_posts` and never opened the shelf. A prompt rule loses to a
   small model.
4. On the harness, before any of that: the web client stopped at the Porch mark (the desktop's
   first-run door, #548, asked a bridge lane the browser does not have), a runner-only workspace left
   a human on "thinking…" forever (the "nobody can serve" voice belonged to the origin's own machine
   only), and the house model could not call `draft_posts` at all (its `posts: array(object)` schema
   reached Gemini as `items: STRING`, the model answered fragments ten times and hit the turn cap).

## 2. What is built

- **The brand note** (`host/brandnote.ts`, one reader with `stageBrandContext`): a marketing room's
  conversation turn carries where its brand lives and the tools that reach it. With docs: the
  product, the goal, the docs by name, `read_library_doc` (scope room) before drafting. Without:
  `list_library` with scope project (a project is one product), then ask the human for the product
  facts, then `propose_library_doc` for what they answer. No forbidden sentences, no recited docs.
- **The shelf in the conversation registry**: `list_library` and `read_library_doc` for the
  marketer's chat turn, one implementation with the orchestrator's (`host/grounding.ts`).
- **Grounding is a gate** (`host/grounding.ts`): in a marketing room whose shelf holds brand docs,
  `draft_posts` refuses until this turn read one of them, and the refusal names the read that lifts
  it. The agent keeps its judgment on what to read and write. It cannot skip reading.
- **The schema nests** (`zodShapeToGemini`): an array of objects reaches the house model as objects.
- **The runner speaks** (`hostSpeaksForOrigin`, shared): a runner says "nobody can serve" when the
  origin has no awake machine, so the door opens on a runner-only workspace.
- **The web client boots** (#552, landed first as the live fix): the browser answers the first-run
  door `done`.
- **Surface impact** (`scripts/impact.mjs`, `surface-e2e.yml`): every pull request is classified
  into web · desktop · mobile · cloud · api and the implicated surface's check runs. The web check
  boots the BUILT browser client in real Chrome (`scripts/web-boot-e2e.mjs`), which answers `stuck`
  on the pre-#552 build and `booted` after.

## 3. Proven on the harness (`evidence/`)

The web client against the dev stack, a k3d cloud machine (kind runner, no vendor login) built from
this branch, the NeuraMesh brain through the local proxy.

- `harness-before-ungrounded-light.png`: the door's record card, three cards and the brief, and
  generic copy ("the new release", "our workspace"): the shelf was never opened.
- `harness-grounded-{light,dark}.png` and `harness-grounded-toolcalls.txt`: `draft_posts` refused
  once, `list_library`, `read_library_doc business-profile.md`, `read_library_doc
  market-research.md`, then three drafts that name the product's facts (git worktrees, the
  server-enforced review, the local-first Mac app) and the brief.

CLAUDE.md carries the harness recipe ("The web + cloud harness") and the surface rule.

## 4. The UGC playbook is two turns (George, later the same day)

George ran the playbook again on the web and got three scripts in prose: "instead, it should do
some research on the product, provide nice options for the ugc videos in ui cards for me to
select or provide an alternate angle, platform target, before generating the on-brand drafts in
our nice cards." Built (`host/ugcflow.ts`, both registries, the angle card in `QuestionFlow`):

1. **Research.** The shelf is read (the gate of §2).
2. **The angle card.** `propose_angles` posts one question card: two to five angles from the
   product's facts as the options, "type your own" as the alternate, and a platform row of chips
   labelled "prepare for" (X, LinkedIn, Instagram, TikTok, the connected ones picked, the others one
   tap away and marked. George: "posts to" read as automatic scheduling, and a pick schedules nothing).
   The tap on an angle posts the pick with the platforms in it (`… · platforms: x, linkedin`). The
   tool refuses before the research, and with a choice of one.
3. **The drafts.** The pick wakes the agent. `draft_posts` with a script (a video post) refuses
   until this thread holds an answered angle card, so a creator script is never written before the
   pick, and never in an angle the human did not choose. One video post per picked platform.

The skill preamble (`marketing-os-preambles.ts`, the pack refreshes by content) and the
orchestrator's marketing block say the order. The order is a fact either way: the two gates.

## 5. The film, on the harness (George: "test that the generate video is on-brand")

The harness API got `FAL_KEY` (the `control-api-fleet` launch entry reads it from `.env`), the
machine image was rebuilt, and Generate video was pressed on draft a of §4 (the X post, the
"before and after" angle). One film, 194 credits, 6.5 minutes from the press to the card
(`harness-film-filming-*.png`, `harness-film-landed-*.png`, the Review · Schedule preview
`harness-film-preview-light.png`, four frames `harness-film-frames.png`).

**Found before the press.** The house model writes the whole hook on the timestamp line
(`[0:00-0:05] Hook: Show a messy desktop … CAPTION: The agent chat loop is broken.`), and
`firstBeat` read that as one direction. The prompt would have said `Opening shot: : Show a messy
desktop … CAPTION: The agent chat loop is broken.. Render no text` and never asked for the clear
bottom third: the caption's words handed to the model as lettering, beside the instruction not to
letter. Fixed (the caption and the spoken line read by name off that line, the label and the
trailing period dropped, tests for both live shapes), and the film ran on the fixed prompt:

> A vertical 9:16 short-form video, 8 seconds, filmed on a phone like a creator would: handheld,
> natural light, no studio. Opening shot: Show a messy desktop with overlapping AI chat logs. Leave
> the bottom third of the frame clear for a caption. Render no text, no subtitles, no lettering.
> Visual direction: Split-screen video. Left side: messy terminal windows and endless browser tabs
> with glowing red error text. Right side: clean NeuraMesh board showing a structured plan, build
> leg, and green review checkmark. Natural desk lighting, shot on 35mm. Keep it raw and real. No
> logos or brand text beyond what the app shows on screen.

**The verdict, against `business-profile.md`.** On brand in substance: the hook opens on the
messy chat windows, cuts to the split screen the brief asked for, and the right half is a board
with a build leg, an "In Progress" row and a green check, which is the profile's plan, build,
review cycle. The caption and the script say what the profile says (tracked plan, a clean
worktree, review before merge, the free Mac app, the server blocks self-approval), and the
tone is the profile's (one developer to another, no hype). The bottom third stays clear, so the
caption burns in at publish. Off brand in the picture of the product: the board is an invented
dark-navy phone app with a blue toggle and a green check, not NeuraMesh's monochrome graphite or
paper, and its labels are pseudo-words ("Teron Inrdret", "Trun Fieg") beside a correct
"NeuraMesh Board". That is the video model drawing a UI it has never seen. The lever is a
reference frame: Seedance takes an image, and a real screenshot of the board (the project's own
app, or the workspace logo) would make the product on screen the product. Not built here.

## 6. Not in this round

- The reference frame above (the film lane is LLM-free by design, the frame is one more input).
- The classifier is path rules. A change that reaches a surface through a path the rules do not
  name is the next lesson to add to the table.
- The cloud surface's live check stays by hand (the k3d harness). A CI k3d run with a real machine
  and a real wake is the next rung of `fleet-e2e.yml`.
