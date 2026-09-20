# 44 · Release drafts: the repository is a marketing source

**Status:** built 2026-09-17 (design: [docs/design/release-drafts-2026-09/plan.md](design/release-drafts-2026-09/plan.md), canvas boards beside it). **Registry:** the `release` playbook in `packages/shared/src/playbooks-registry.ts`, the fifth marketing setup step in `packages/shared/src/setupflows.ts`. **Pure halves:** `packages/shared/src/releasescan.ts` (the scan, the digest, the cursor merge), `packages/shared/src/releasebrief.ts` (the brief's shape, the `‹brief:id›` marker).

## The one sentence

NeuraMesh watches a project's repository. When a feature ships, the marketer drafts the announcement for every connected account, and the human approves it in the thread.

## The shape

- **A session per release, never a channel.** A schedule whose payload carries `release` is a routine that watches a repository. The daemon's tick reads it with the machine's own `gh` (the platform never holds a repository token), hands the rows to the pure scan, and opens ONE session in the marketing room with the digest as the owner's first message. A quiet window opens nothing and leaves one ledger line.
- **Detection is code, the feature call is judgment.** `scanWindow` decides what is new since the cursor: releases first (drafts and prereleases never), tags without releases second, a window of merged pull requests for a repository with neither. A pre-filter drops bots, chores, dependency bumps, CI and docs. The agent decides in the thread whether a feature shipped and which one, with its reasons on the brief.
- **The cursor is the schedule's own.** `payload.release.cursor` advances only through `schedule.set_cursor`, after a completed scan, so a scan that dies after the claim leaves tomorrow's window covering today. The `‹release:owner/repo@key›` marker in the fire message is the second lock: a key that already heads a session of the schedule never fires twice. The ledger (`payload.release.log`, capped at twelve) is what Routines renders as quiet rows.
- **The playbook is data.** `release` (engine unit, task kind content, born approved) needs a repository (`{ kind: 'repo' }`, the dependency card offers the attach) and one connected account. plume runs it on the worker lane with the brand docs staged and the `release-announcement` skill loaded (marketing-core), writes `release-report-YYYY-MM-DD.md` (head `# Release brief · <tag>`, `Verdict: feature|improvement|fix|none · Basis: …`, `## Why`, `## Audience`, `## Assets`, `## What I could not determine`) and `posts.json`, one post per connected account. The finish posts `The brief is in. ‹brief:<artifact id>›` into the owning session, and the `ReleaseCard` renders it.
- **The session shows the cards.** A conversation renders the post cards of the content units it owns (`tasks.origin_thread_id`), after the unit's completion note, through the one `postCardsFrom` derivation. Request changes arms the composer with the card as a pill, as everywhere else. Unanswered drafts on an owned unit make the session `needs you`.
- **The doors.** Setup step 5 (`Announce your releases?`: the repository from the project, the connected accounts, `Draft the latest release now` as a free one-shot, `Watch the repository daily` as a Team routine). The Marketing OS catalog row (armed state derives from the schedule prompt `Run the release drafts playbook.`). Automations › Routines (a routine like every other, with quiet rows).
- **The public door.** `neuramesh.app/announce`: the paste is detected at once (`POST /announce/detect`: public, or private-or-missing with the GitHub App's install link). The form takes the website (the brand read: palette, fonts, voice, `siteread.ts`) and the email (the link, and the spend bound). `POST /announce` queues a row, and the minute cron `/internal/announce-due` works ONE row per tick (`announce-job.ts`): the read (public, or through the App's installation token, minted per read and never stored), the scan, the site read, one Starter turn that answers structured JSON (`announce-brain.ts`), the brief rendered from it (so the shape never drifts), the release card drawn on the site's palette (`releasecard.ts`, resvg-wasm with the bundled NeuraMesh Sans), the email through the Resend lane (`announce-ready`). `GET /announce/:id` is what the page polls, `GET /announce/:id/image` the card. `POST /v1/announce/:id/claim` (a signed-in human, in a workspace) saves it through the ordinary commands: a project named for the repository, its marketing room, the repository linked, the website and the repository on the setup flow, the session with the digest, the brief shelved and carded, one content item per post, the card attached to the Instagram item.

## Enforced, not prompted

- Publishing stays `content.approve`, HUMAN_ONLY. The routine can never publish.
- The scan never runs a model. The cursor and the marker make a double fire impossible.
- `needs: repo` stops a run in a room whose project has no repository. `needs: connector` stops one with no account.
- The public endpoint requires an email, is capped per email per day (`ANNOUNCE_EMAIL_CAP`, 5), per address per hour (`ANNOUNCE_IP_CAP`, 10) and per day (`ANNOUNCE_DAILY_CAP`, 200), and serves one draft set per `(repo, tag, email)`. The GitHub App's permissions are read only by registration.
- Announcement rows and installations are server-only tables (0139): never in the PowerSync publication, never in a replica.

## Custody and cost, said plainly

The platform never stores a repository token. In the app the machine's `gh` reads, or the GitHub connector does (below). On the site the server reads public data with its own identity, and a private repository through the NeuraMesh GitHub App after the person's explicit grant (`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_B64`; unset, the door serves public repositories only). The Starter key stays server-side; the public door's turn is unmetered platform spend, bounded by the caps above. Social tokens stay sealed server-side, unchanged.

## The GitHub connector: the repository, readable by its agents (2026-09-19)

Design: [docs/design/github-connector-2026-09/plan.md](design/github-connector-2026-09/plan.md). The gap it closes: on the hosted product every session runs on a cloud machine, which has no `gh` login, so the release playbook read nothing and plume judged from an empty page (the live web run, 2026-09-19).

- **One connector, `github`, per project.** A `connectors` row (`provider = 'github'`, `handle` = the repository slug the project reads, the usual four statuses, 0142 widens the check). The grant behind it is the App's installation, so there is no `connector_secrets` row and no token on any machine. The row is the ACL: no row, no read. It rides the ⋯ list, the Connections list, the dependency card and marketing setup's fifth step; the four foot marks stay the publishing networks.
- **Two doors write the row.** `/connect/github/start?workspace&channel&actor` seals the state (the social flows' idiom) and sends the person to GitHub's install page; the callback records the installation with its `selection` and the workspace, checks the project's repository is covered, and writes the row. `POST /v1/github/resolve { channel }` (HUMAN_ONLY, in the workspace) asks whether the App can read the room's repository now and writes the row when it can, so a grant that lands on another deployment's callback still counts. The connect step tries the resolve first, sends the person to GitHub only when it must, polls every five seconds while they are there, and offers **Check again**. The public announce door keeps its slug-state branch on the same two routes (`github-connect.ts`).
- **The reads go through the API, like X.** `GET /v1/repo/changes|file|tree?channel=` (`github-connect.ts`): the actor in the workspace, the room's project's PRIMARY repository (`store.announcements.primaryRepoForChannel`), the `connected` row (else `NOT_CONNECTED`), the installation (table, else GitHub's own answer, `selection = 'all'` matched by account), one installation token per installation per hour, in memory only. A deleted installation answers 404 on the mint: the row turns `reauth_required`, the read says `RECONNECT_REQUIRED`, the attention bar lights, and a second read never touches GitHub. Files: 60 KB of text, binaries and directories refused by name, 1 MB is the ceiling. Trees: 500 entries, filtered by path.
- **Three tools, one reader, three registries.** `list_repo_changes` · `read_repo_file` · `list_repo_files` on the orchestrator registry (`host/tools-repo.ts`, so rex in any thread on any brain), the conversation registry (`chattools-repo.ts`) and the worker bus (`toolspec`/`tooldefs`/`nmtools-repo`, `ToolHost.repo`, every working kind plus `chat`, `triage`, `leg`). `host/reporead.ts` picks the door per call: the connector when the row is live, the machine's `gh` when it can, the honest refusal that names the fix otherwise. `stageConnections` tells a worker the repository is readable and with what. The words live once in `harness/tooldesc.ts`.
- **The release lane, closed.** The tick's preflight accepts the connector as a reader (`door: 'connector'`), so the daily watch runs on a cloud machine; `run_playbook('release')` refuses with **Connect GitHub** on the card when a repository is attached and nothing can read it (`checkNeeds` with `readable`), and when it can read, it reads the digest AT CREATION (`host/releasedigest.ts`: the same scan, the named release or the newest, the marker line kept out of the description) into the unit's description, so plume has the notes and the pull requests from the first token. The playbook's approach names the tools for anything deeper.

Deploy notes: `0142_github_connector` auto-applies, no PowerSync work. No new env: the connector reads with the App values the door already has, and `NM_CONNECTOR_KEY` seals the in-app state. The daemon change reaches the cloud machines by `pnpm fleet:pin` between tags or the next release tag.

Proven live (2026-09-19, the dev stack: the branch API on 8789 with the real App, the browser client on 5211, the `desktop-mkos` daemon started with an empty `GH_CONFIG_DIR`, so `gh capability: absent` like a cloud pod; `docs/design/github-connector-2026-09/evidence/live-*`): the Connections row resolved `neuramesh-ai/release-drafts-test` in place through the App (a private repository); rex, asked in a thread, answered the latest release, the one commit and the README through `list_repo_changes` + `read_repo_file`; `run_playbook('release')` minted #1015 with the v0.1.0 digest in its description and plume drafted two posts grounded in the notes after reading `CHANGELOG.md` through the connector; the daily watch, made due, fired through the connector (cursor `v0.1.0`, one session with the digest and the marker). Three things the harness found: a stale `github_installations` row with a fake id for the same repository won the lookup and could not mint a token, so the resolver now verifies the table's answer by minting and forgets a row GitHub answers 404 for; a connected row's label collapsed to zero width beside a long slug (the label keeps its width now, the handle truncates); and the tick's `limit 5` over the oldest due rows lets rows whose preflight refuses forever starve a newer routine (pre-existing, not fixed here: the refused rows are left due by design, and five permanent refusals shadow the sixth). Not exercised live: GitHub's own install page (it needs the founder's GitHub session); the sealed-state callback is unit-tested.

## Deploy notes (the first release that carries this)

- `0139_announcements` auto-applies. No PowerSync work.
- Vercel env: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_B64`, `GITHUB_APP_WEBHOOK_SECRET` (v1.5), `GITHUB_READ_TOKEN` (optional, the public read limit), the three caps (optional). `RESEND_API_KEY` and `STARTER_GOOGLE_API_KEY` already exist.
- `packages/control-api/vercel.json` gains the `/internal/announce-due` cron.
- `@resvg/resvg-wasm` joins the control-api dependencies and both esbuild externals lists; the bundle must be regenerated, and the wasm file must reach the function (verify on a preview deployment, or add `functions.includeFiles` for `node_modules/@resvg/resvg-wasm/index_bg.wasm`).
- The marketing-core pack gains `release-announcement`: the boot backfill's `seedDefaultPacks` now converges an existing pack's skills, so every marketing room gets it on the next boot.

## Traps

- The tick decides the path BEFORE the claim (`schedules.ts`): the release preflight (a repository, a GitHub remote, a `gh` login on this machine) leaves the row due for another machine, and says so on the bar after ten minutes.
- A locally attached repository stores `org_name = 'local'` and no `clone_url`: `gh` cannot read `local/<name>`, so the preflight refuses it as "no GitHub remote".
- The Starter turn answers JSON, and the brief is rendered from it. A model that writes the brief itself would drift from the shape contract in a week.
- `contractDeliverables` recognises the `Verdict:` head as the report's identity, so a release run that delivers the brief beside `posts.json` still lands it under the contract name.

## Proven live (2026-09-18, the dev stack, `docs/design/release-drafts-2026-09/evidence/live-*`)

The whole loop ran on the live desktop app against this branch's API, with real agents (rex and plume on Claude, the machine's own `gh`, `alonge-dev/neuramesh` attached to a fresh marketing room):

- the wizard's fifth step attached the repository by URL and planted both routines (`live-setup-step5-{light,dark}.png`);
- the one-shot fired at planting, opened the session with the digest, rex ran the playbook, plume delivered the brief and two posts, the finish carded both, and the session read needs-you (`live-release-session-{light,dark}.png`, the v0.134.0 run);
- the daily watch, made due by hand, found a tag that had landed since the arming (v0.135.0), opened its own session, and plume answered `none`: the public releases mirror had not published it yet, and it parked a backlog item to re-run once it does. The feature call stayed the agent's (`live-release-none-{light,dark}.png`);
- the Routines ledger lists the watch's run (`live-routines-ledger-{light,dark}.png`).

Six defects the preview harness could not show, all fixed in the same round: the wizard read the replica once before the PowerSync hop landed, so an attached repository showed nothing (a bounded re-read now); the completing command's merge raced the step write and the profile forgot the repository (`marketing.setup` records `releases` itself); the tags-only window started at the cursor instead of the previous tag (94 pull requests for a window of nine); the thread title cut at the period inside `v0.134.0`; the digest head said `checked 09:00` at 22:14 (it names the check's own time now); a brief written as one paragraph became a paragraph-long card title (the headline is the first sentence). Also from the run: a version-bump pull request counts as noise, and a card marker never reaches a session row's snippet.

Known, not fixed here: a rework of a content unit re-mints its post cards (the pre-existing `posts.json` path, every content task), and the worker's sandbox cannot read the private repository the tick read, so the agent judges from the digest alone.

## The private path, proven live (2026-09-18, the App `neuramesh`, id 4994365, owned by neuramesh-ai)

George created the App through the manifest flow and installed it on `neuramesh-ai/release-drafts-test`
(installation 162852885). The install exposed three more defects, fixed with tests: the App's callback was
registered BELOW the social connectors' `/connect/:provider/callback`, so the grant answered "github connect
is not configured on this server" (the announce routes now sit above them, and app.ts says why); create read
only the installations table, which the callback never fills when the grant lands on another deployment, so
the job read the private repository anonymously and failed on 404 while detect said installed (one resolver,
table then GitHub, remembered with the installation's whole repository list); and a client that names no
release (the terminal, CI, a curl) collided with the one-per-release index on its second ask (create resolves
the latest release itself, and the job maps the rare collision to a sentence). The door's brain also read a
notes-only release as `none`: the prompt now says release notes are evidence on their own. Result: verdict
feature, three posts, the release card on neuramesh.app's palette, the email (`live-announce-grant-*.png`,
`live-announce-private-ready-*.png`, `live-announce-private-card.png`). The four App values are on Vercel
(production and preview) and in the local `.env`; the launch entry passes them to the branch API.

## One brand read, and the claim wired (2026-09-18, afternoon)

George: the release card came out blue on a paper-and-ember site, and "we have a skill already in
neuramesh for capturing sites branding details, why not use it?". The desktop's researcher and the
server's door each tallied a site's CSS by frequency, and neuramesh.app's most-painted colors are its
chart series. The brand read is ONE function now, `shared/brandread.ts`: what the site DECLARES as its
ground, ink and accent (custom properties, theme-color metas) comes first, then the tally, then the
fonts. The desktop's `siteDesignTokens` summary and the door's `readSite` both call it, and the card
prefers the declared set. The public door has no agent runtime (a Vercel function, one Starter turn),
so the skill itself cannot run there; the reading it relies on is shared instead.

The ready page's "Sign in to save and schedule" led to `/pro`, which never read the announce id: the
claim route existed on the server with tests and nothing called it. `/pro?announce=<id>` now keeps the
id through Clerk's faces, claims the drafts into the person's workspace after the sign-in (free on
every plan, no checkout), and shows "Your drafts are saved" with the door to the app. The dev site and
the branch API take the dev Clerk keys from the launch entries, so the path runs locally.

## The claim, proven on the wire (2026-09-18, evening)

George pressed "Sign in to save and schedule" and saw "Checkout did not start. Failed to fetch." Two
defects, both fixed with tests: the API carried no CORS on `/auth/clerk`, `/v1/workspaces`,
`/v1/billing/*` and `/v1/announce/*`, so every browser preflight from the site died at 404 (the
/invites lesson, again; production's `/pro` had the same hole); and the claim ran its commands past
the schema, so the defaults the handlers rely on never applied and postgres refused an undefined
description with a 500. The site's routes share one CORS mount ahead of every browser-called route
and the guard, the claim validates through `CommandSchema` like the route does, the project gets the
website with its scheme, and `release-routine.pg.test.ts` runs the claim on postgres end to end.
Live: the claim answered 200, and the app shows the new project, its marketing room, the session
with the digest, the brief card and three draft cards, the Instagram one with the release card
(`live-claimed-session-{light,dark}.png`).
