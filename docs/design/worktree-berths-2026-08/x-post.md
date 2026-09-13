# X draft: how NeuraMesh handles agent worktrees

> For George to post (2026-08-11, rewritten for a human audience). Two forms: the short post,
> then the long article. The 🖼️ markers show where each file goes. Delete the marker lines when
> you paste. X allows one video OR up to four images on the short post, so the short post takes
> the video and the article carries the stills inline (articles allow many).
>
> Every number is measured. The "live" screenshots come from an end-to-end run against the
> running app, where the cleaner really deleted a planted workspace from disk.

---

## Short post

Last week the timeline found a new villain: git worktrees. Parallel coding agents were leaving 20 GB of duplicated node_modules behind, and "worktrees must die" made the rounds.

I measured my own machine. 73 GB of agent worktrees. Some sitting there since June.

So we built our answer into NeuraMesh, and I think it is the right shape for the whole ecosystem: worktrees do not need to die. They need a landlord.

Full story below.

> 🖼️ ATTACH TO THE SHORT POST → `docs/evidence/footprint/footprint-demo.mp4`
> (the demo: the ring on Home, the footprint view, the chart, the clean-up preview, freed)

---

## Article: "Your agents need a landlord"

### The problem, from the beginning

When a coding agent works on your repository, it needs a real folder to work in. It runs installs, builds, and tests. It edits files. It cannot do any of that inside a branch name; it needs a filesystem.

It also cannot share your checkout. You are typing in that one. And two agents cannot share one folder either, because they would overwrite each other mid-edit.

Git has a built-in answer called a worktree: a second working folder attached to the same repository. Same history, separate files. Every serious agent tool reached for it, and they were right to. Isolation is the correct call.

Here is the part nobody designed: each of those folders fills up with the heavy stuff. The checkout itself, then node_modules, then build caches. On a typical JavaScript project that is 2 to 3 GB per workspace. Now run agents in parallel, across a few projects, for a few weeks. Nothing ever deletes those folders, because no tool ever made itself responsible for them.

That is the whole story of the trend. [swyx posted 20 GB of duplicated node_modules](https://x.com/swyx/status/2086962980235939920) and called for the death of worktrees. [ThePrimeagen answered](https://x.com/ThePrimeagen/status/2086992018979303717) that this is an ecosystem problem, not a worktree problem. He is right.

I run NeuraMesh, a platform where humans and AI agents ship software together, and NeuraMesh builds itself with its own agents. So I audited the machine it lives on:

- NeuraMesh's own task workspaces: 679 MB
- Claude Code worktrees on one repo: 39 GB. Fifteen folders, median 2.9 GB, the oldest untouched for six weeks.
- Codex worktrees: 34 GB

The bloat on my machine was real. It just was not coming from my product. And to be fair to my product, the same audit found real leaks in it too: orphaned git records, 25 local branches nothing would ever delete, a cleanup function that no code ever called. Everybody has this problem. Including the people building the fix.

### What the tools do about it today

Mostly, nothing. Claude Code creates a worktree per session and never removes it. Boris Cherny, who created Claude Code, [cleans his up with a loop he wrote himself](https://x.com/bcherny/status/2087024157196489117) and has asked whether it should be built in. There is an [open issue](https://github.com/anthropics/claude-code/issues/43730) asking for exactly that lifecycle.

Cursor went a step further and [ships a cap](https://cursor.com/docs/configuration/worktrees): at most 25 worktrees per machine, cleaned on a six-hour timer, oldest first.

A cap is better than nothing, but notice what both approaches have in common: they guess. Age and count are stand-ins for the question that actually matters, which is "does anything still need this folder?" A generic tool cannot answer that question. It has no idea which work is finished.

### NeuraMesh can answer it, because NeuraMesh has the board

In NeuraMesh, agent work is not a loose session. It is a task on a board, with a state: in progress, in review, done, accepted. The task moves through a real loop with a human at the gates.

That changes everything about cleanup, because the workspace's fate can be derived instead of guessed:

- A task an agent is working on, or paused on, keeps its workspace. Untouchable, no matter what.
- A task that has been submitted does not need its local folder anymore. The code is pushed, review reads the submitted artifacts. The folder is now just a convenience, so the newest few stay and the rest can be freed.
- A task that is accepted or closed loses its workspace immediately, and completely: the folder, git's internal bookkeeping entry, and the local branch. No orphans.

No timer guessing at staleness. The board already knows.

### And rebuilding a workspace became almost free

Deleting eagerly is only safe if getting a workspace back is cheap. So we made it cheap.

Dependencies are a pure function of the lockfile. After the first successful install, NeuraMesh saves the installed node_modules as a reusable set, keyed by the lockfile's hash. Every later workspace for that repo gets a copy-on-write clone of it before the agent even thinks about running install.

Measured on a real project, 2.99 GB of node_modules across roughly 130,000 files:

- Restore: 1.5 seconds, costing about 30 MB of new disk. The filesystem shares the data blocks until something changes them.
- The same install from scratch: minutes, and 3 GB, every attempt.
- A detail I enjoyed: asking the kernel to clone the whole folder in one call takes 1.7 seconds. The standard cp command takes 20.4 seconds for the identical result, because it walks all 130,000 files itself.

The guardrails are structural. A saved set never crosses a lockfile change. If the filesystem cannot do copy-on-write, we skip instead of silently burning minutes on a full copy. And if a repo does not gitignore node_modules, the restore removes itself so it can never leak into a commit.

### The part I care about most: you can see all of it

Disk usage from agents should not be a mystery you discover with du one day. NeuraMesh gives it a screen.

> 🖼️ IMAGE 1 → `docs/evidence/footprint/destination-dark.png`
> (the Agents' footprint view: totals, the chart, every workspace listed with its size)

It starts with a small ring in the corner of Home. It scores how much of the disk budget your agents are using. Green when comfortable, amber when it is time to look.

> 🖼️ IMAGE 2 → `docs/evidence/footprint/home-ring-dark.png`
> (Home, the ring in the greeting row)

Click it and the machine gets measured for real. Even the waiting state gets some love.

> 🖼️ IMAGE 3 → `docs/evidence/footprint/live/footprint-measuring-live.png`
> (the measuring state, captured live mid-scan)

The view speaks plain words: task workspaces, saved dependencies, cached repos. It shows what can be freed right now, and that number is computed by the cleaner's own decision logic, so the promise and the action cannot drift apart. A chart tracks disk use over time from real samples, one per cleanup.

> 🖼️ IMAGE 4 → `docs/evidence/footprint/destination-hover-dark.png`
> (the chart with the crosshair and tooltip under the cursor)

"Clean up" shows its plan before it acts. Item by item, with sizes, and a promise it structurally keeps: active work is never touched, and anything removed can be rebuilt. What you confirm is exactly what runs.

> 🖼️ IMAGE 5 → `docs/evidence/footprint/live/footprint-confirm-live.png`
> (live on my machine: the preview open, and below it the real Codex row, 36 GB)

And that Codex row is the last piece. The footprint also lists the other agent tools on your machine. Claude Code's worktrees, Codex's. Counted, sized, dated. NeuraMesh never deletes another tool's files; it tells you they are there and lets you decide. I want the number on a screen, not in a shrug.

> 🖼️ IMAGE 6 → `docs/evidence/footprint/destination-cleaned-cream-oak.png`
> (after a clean-up, in the light theme: freed, and the button knows there is nothing left)

### So, do worktrees need to die?

No. A branch is a name, not a filesystem. Parallel agents genuinely need isolated folders, and they always will. The mistake was never the isolation. The mistake was making every isolated folder immortal and fully stocked.

Give workspaces a lifecycle that follows the actual work. Make rebuilding them nearly free. Show the user everything. That is the landlord's job, and I think every agent tool will end up hiring one.

Ours already started. The trend that kicked this off is three days old; everything above shipped and is running on the machine that wrote it.

---

*Numbers measured 2026-08-11 on the dev machine, screenshots from the shipping build. NeuraMesh develops itself on its own loop; this work started as a report from that loop. If you want your agents to have a landlord too: [link to NeuraMesh].*
