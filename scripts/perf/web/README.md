# The web-client performance harness

Measures the NeuraMesh browser client (hq, `apps/hq`) in real Chrome
over the DevTools protocol, and records video of what a person sees. Plain Node 22 ESM, no npm
dependencies: Node's own `WebSocket` and `fetch`, `/usr/local/bin/ffmpeg` for video, Chrome itself
for the label and timer frames. The style follows `scripts/web-boot-e2e.mjs`.

Everything here runs against a BUILT client (`vite build` in `apps/hq` with
`VITE_NM_POWERSYNC_URL=http://127.0.0.1:58081 VITE_NM_DEV_USER=00000000-0000-0000-0000-000000000001`,
so it boots as the dev user without sign-in) and the shared dev stack (Postgres on 55435,
PowerSync on 58081).

## Files

| File | What it does |
|---|---|
| `serve.mjs` | Static server that behaves like the Vercel deployment: brotli (q3, the byte count production serves) or gzip per `Accept-Encoding`, precompressed at start and cached in `.zcache/`. `Cache-Control` per `--cache`. ETag + 304. COOP/COEP (+ nosniff, referrer policy) on every response. SPA fallback for dotless paths. A streaming proxy for `/v1`, `/auth`, `/connect`. `--h2` serves HTTP/2 over TLS (see below). |
| `cdp.mjs` | Chrome launch (retries), a flat-mode browser-level CDP connection (the page AND its workers are sessions, so throttling and network accounting reach the wa-sqlite worker), the network/CPU profiles, the renderer calibration, `Performance.getMetrics`. |
| `probe.mjs` | The in-page load probe (`window.__nmPerf`), injected at document start. Marks: `shell`, `composer`, `data`, `dbReady`, `connected`, `synced`. Observers for longtask, LoAF, layout shift, LCP, paint, event timing. Refuses to run on any port but the harness's. |
| `measure-load.mjs` | Cold and warm loads, N runs, median + p75. |
| `frames-probe.mjs` | The in-page frame probe (`window.__nmFrames`): rAF frame deltas + LoAF inside a window, `waitPainted` (first frame in which a condition holds), the last pointerdown time. |
| `app.mjs` | The journeys as CDP steps (Home, the perf-lab rows, the rail, the thread scroller) and the ~6 KB reply body. |
| `measure-frames.mjs` | View switch, scroll (steady + fling), reply arrival. One session per profile, N iterations. |
| `record.mjs` | Screencast recorder → constant-frame-rate MP4 with faithful timing. Filmstrip. Side-by-side with labels and a running ms timer. |
| `sidebyside.mjs` | CLI for the before/after comparison video. |
| `videos.mjs` | The four baseline videos + the cold-load filmstrip. |
| `trace.mjs` | One Chrome performance trace of a load + the main-thread summary (top costs by URL/function, longest tasks, the worker threads). |
| `jsprofile.mjs` | Sampled JS CPU profiles of a load for the page AND its workers (self time per function). |
| `netproxy.mjs` | The network shaper: an HTTP proxy (plain requests forwarded, CONNECT tunnelled) that puts every byte, the sync WebSocket included, through one shaped link. See "How the network is shaped". |
| `profile-journey.mjs` | Sampled JS CPU profiles of the page AND the wa-sqlite worker during one journey (open, scroll, reply). |
| `seed.mjs` | Creates the `#perf-lab` room (see `SEED.md`). |
| `report.mjs` | Folds `results/*.json`, `videos/<label>-videos.json` and `traces/<label>-*` into `<label>.json` and writes the markdown tables. |
| `run-all.sh` | Every number, video and trace for one build, in order, one log per step in `logs/`. |
| `run-compare.sh`, `aggregate.mjs` | Two builds, interleaved round by round, then folded into one JSON of medians. See "Compare two builds". |

## One command per journey (JSON out)

Serve the build under test on 5341 first (next section). Every command writes JSON into `results/`
(or `videos/`, `traces/`), resumes where it stopped, and records per run: the page architecture
(must be `arm/64`), whether Chrome was translated, the 1/5/15-minute load average, the renderer
calibration, and the CPU throttle each target accepted.

| Journey | Command | Output |
|---|---|---|
| cold + warm load, one profile | `node measure-load.mjs --profile fast4g --runs 5 --mode both --label <L>` | `results/load-<L>-fast4g-both.json` |
| view switch (Home → thread, thread → thread) | `node measure-frames.mjs --profile cpu4x --runs 5 --only switch --label <L>` | `results/frames-<L>-cpu4x-switch.json` |
| reply arrival | `node measure-frames.mjs --profile cpu4x --runs 5 --only reply --label <L>` | `results/frames-<L>-cpu4x-reply.json` |
| scroll the long thread | `node measure-frames.mjs --profile cpu4x --runs 5 --only scroll --label <L>` | `results/frames-<L>-cpu4x-scroll.json` |
| all three in-session journeys | `node measure-frames.mjs --profile cpu4x --runs 5 --label <L>` | `results/frames-<L>-cpu4x.json` |
| the four videos + filmstrip | `node videos.mjs --label <L>` | `videos/<L>-*.mp4`, `videos/<L>-videos.json` |
| before/after video | `node sidebyside.mjs videos/<A>.mp4 videos/<B>.mp4 videos/compare.mp4` | the MP4 |
| trace of a cold load | `node trace.mjs --profile fast4g --seconds 240 --out traces/<L>-fast4g-cold.json` | the trace + `.summary.json` |
| JS profile of one journey | `node profile-journey.mjs --journey open\|scroll\|reply --profile cpu4x --label <L>` | `traces/<L>-<journey>-cpu4x.*` |
| everything, in order | `zsh run-all.sh <buildDir> <L>` | all of the above + `logs/` |
| before/after, interleaved | `zsh run-compare.sh <before> <after> 5` then `node aggregate.mjs > final.json` | `results/*-final-*`, `final.json` |
| tables for a label | `node report.mjs --label <L> --build <buildDir>` | `<L>.json`, `<L>-tables.md` |

For a before/after comparison on the same machine, run the two builds interleaved rather than
one after the other: machine load moves within minutes here, and interleaving puts both columns
under the same conditions: serve build A and run `--more 1 --label before`, serve build B and run
`--more 1 --label after`, repeat five times (`--more N` adds N runs to what the file already holds.
`--runs N` is a total, and a finished file resumes to it).

## Before anything: the servers

```sh
source ~/.nvm/nvm.sh && nvm use 22.19.0
setopt NO_BG_NICE     # zsh runs background jobs at nice +5 by default: servers and Chrome must not be
H=<repo>/scripts/perf/web

# the control-api (port 8841), from the worktree
cd <worktree>/packages/control-api && DATABASE_URL=postgresql://postgres:nm@127.0.0.1:55435/nm PORT=8841 \
  FLEET_SECRET=local-dev-fleet-secret CRON_SECRET=local-cron NM_ALLOW_DEV_TOKENS=1 NM_ALLOW_ACTOR_HEADER=1 \
  FLEET_AUTOPROVISION=off FLEET_JWT_PRIVATE_KEY="$(cat ../../dev/stack/secrets/fleet-jwt-dev.pem)" \
  nohup pnpm exec tsx src/server.ts >> $H/api.log 2>&1 &

# the build under test (port 5341)
cd $H && nohup node serve.mjs <buildDir> --port 5341 --api http://127.0.0.1:8841 > serve.log 2>&1 &
```

`serve.mjs` options: `--cache immutable` (default: `/assets/*` immutable for a year, everything
else `no-cache`) or `--cache vercel` (every static file `public, max-age=0, must-revalidate`,
which is what production sends today, `/assets/*` included). `--vercel-json <file>` applies a
vercel.json's `headers` rules on top (so an "after" build that adds a Cache-Control rule is
served the way Vercel would). `--h2` (HTTP/2 + TLS, self-signed cert in `certs/`: Chrome needs
`--ignore-certificate-errors-spki-list=$(cat certs/spki.txt)`, which makes the cert valid so the
HTTP cache still works. Pass it with `NM_CHROME_EXTRA`, see below). Chrome's debugging port does
not open under the Bash tool's sandbox: run every script that launches Chrome with the sandbox off.

## The profiles

| Profile | Network | CPU (`Emulation.setCPUThrottlingRate`) |
|---|---|---|
| `none` | no shaping | 1x |
| `broadband` | 20 Mbps down / 5 up (2,500,000 / 625,000 B/s), 40 ms RTT | 1x |
| `fast4g` | 9 Mbps down / 1.5 up (1,125,000 / 187,500 B/s), 85 ms RTT | 4x |
| `cpu4x` | no shaping | 4x (the frame journeys: the API and PowerSync are local anyway) |

Megabits are SI (1 Mbps = 10^6 bit/s). CPU throttling slows the PAGE's main thread only: Chrome
refuses it for workers ("Operation is only supported for pages, not workers", recorded per run in
`workerCpuThrottle`), so the wa-sqlite worker runs at full speed under `fast4g` and `cpu4x`. Chrome's
throttler also shows up as CPU time: under a throttle, `mainThreadCpuMsToData` and
`rendererCpuMsToData` include the time the throttler burns, so compare them only within one profile.

**How the network is shaped: `netproxy.mjs`, not CDP.** CDP's `Network.emulateNetworkConditions`
shapes HTTP requests but NOT WebSocket frames: under the broadband profile the cold sync moved
18.3 MB of payload in 2.75 s (about 53 Mbps). The initial sync is the biggest download of a cold
load, so `measure-load.mjs`, `videos.mjs` and `trace.mjs` start `netproxy.mjs` (its own process,
one per run) and launch Chrome with `--proxy-server=http://127.0.0.1:<port>
--proxy-bypass-list=<-loopback>`: every byte the page and its worker move, the PowerSync WebSocket
included, crosses one shared link (a token bucket per direction, 16 KB FIFO chunks, half the RTT
of delay on every chunk, one RTT on each CONNECT). CDP then shapes nothing (`net: null`) and only
the CPU rate is emulated. `--shaping cdp` brings back the CDP-only behaviour for comparison.
Checked with curl: one 772 KB brotli asset takes 0.40 to 0.42 s through the broadband link (the
ideal is 0.35 s) and arrives byte-identical (`cmp`), and two parallel downloads share the link
(0.40 s + 0.72 s). The link delivers every chunk from ONE ordered queue: an earlier version gave each
chunk its own timer, Node rounds timer delays to whole milliseconds, two small chunks then left out
of order, and the sync client saw "Sync protocol error: invalid binary line ... bson error" and
reconnected every 5 s. Every load record therefore keeps its own integrity evidence:
`syncErrors` (each distinct `downloadError` the PowerSync client reported), `socketLife` (every
sync socket open, close and `close()` call with its stack) and `metrics.syncWsConnections` (1 means
no reconnect). A run with a sync error or more than one sync connection is suspect: the report
counts them. The sync WebSocket is permessage-deflate
compressed: 18.4 MB of payload is about 6 MB on the wire (`proxyStats.bytesDown` in each record).

## Chrome must run native (read this first)

Chrome is a universal binary. A process tree that passes through an x86_64 program launches it
under Rosetta: Intel Homebrew's `/usr/local/bin/timeout` did exactly that during this work, and a
translated Chrome ran JS about 10x slower and took 60 to 100 s to a cold load's first data instead
of 2 to 3 s. `cdp.mjs` therefore launches Chrome as `/usr/bin/arch -arm64 <chrome>` and refuses to
measure when the browser process carries the P_TRANSLATED flag (`ps -o flags`). Each load record
also stores the page's `navigator.userAgentData` architecture (`pageArch`, `arm/64`). `ffmpeg` in
`/usr/local/bin` is also x86_64: fine for encoding, never in the path that starts Chrome.

## The renderer-speed gate

This machine is shared with other agents and was deep in swap during the baseline (50 to 54 GB of
swap used, load averages 18 to 330). A native renderer ran the calibration loop (1e7 iterations,
the median of 4 warm repeats) in 8 to 12 ms through all of it, but a run should still refuse a
starved renderer, so every load run and every frames iteration starts only when a freshly
launched renderer is fast: the calibration median, divided by the run's CPU throttle, must be
`<= --max-calib-ms` (default 30). Otherwise the harness closes Chrome, waits 30 s and tries again
(up to `--max-wait-ms`, default 30 min). Each record keeps the calibration at the start
(`calibMs`) and at the end (`calibEndMs`): a run whose end calibration is far above its start
degraded midway, and the tables show both. `--max-calib-ms off` disables the gate.

## Load: cold and warm

```sh
node measure-load.mjs --url http://127.0.0.1:5341/acme --profile none      --runs 5 --mode both --label baseline
node measure-load.mjs --url http://127.0.0.1:5341/acme --profile broadband --runs 5 --mode both --label baseline
node measure-load.mjs --url http://127.0.0.1:5341/acme --profile fast4g    --runs 5 --mode both --label baseline
```

Each run: a fresh Chrome profile directory and a fresh `?db=` (empty HTTP cache, empty OPFS), the
probe injected at document start, the page navigated to `/acme` (Acme Robotics). When the Home
composer first shows, the harness clicks it, types one character (`Input.insertText`), verifies
the textarea holds it in the next frame, and deletes it again. The run ends when shell, data and the
typed character are all there, no long task ran for 3 s, and (for a cold run that primes a warm
run) the replica reports `hasSynced`. Or at `--cap-ms` (default 240,000, see caveats). A warm run
then relaunches Chrome on the SAME profile directory (disk cache and OPFS replica present, memory
cache gone) and loads the same URL with the same `?db=`: the member coming back.

Metrics (page clock: ms since the navigation's `timeOrigin`):

| Name | Definition |
|---|---|
| `ttfb`, `dcl`, `load` | Navigation Timing: `responseStart`, `domContentLoadedEventEnd`, `loadEventEnd` |
| `fcp` | the `first-contentful-paint` paint entry |
| `lcp` | the last `largest-contentful-paint` candidate (Chrome stops LCP at the first input, which is the composer click) |
| `shell` | first frame in which `.shell` and its `.navpanel` are laid out (the app frame) |
| `composerVisible` | first frame with `.hcomposer textarea` laid out, enabled, writable |
| `composerTyped` | page time at which the typed character was read back from that textarea (includes the CDP round trip and any main-thread wait) |
| `data` | first frame with a row whose text came from the replica: `.navhistrow .navhisttitle`, `.navgrpname` or `.histrow .histtitle` (which one, and its text, are in `dataWhat`) |
| `dbReady`, `connected`, `synced` | `window.__nmDb.ready`, `currentStatus.connected`, `currentStatus.hasSynced` (dev-user builds expose `__nmDb`) |
| `longTask*`, `loaf*` | PerformanceObserver `longtask` and `long-animation-frame` from document start |
| `cls` | the largest session window of layout shifts without recent input (the web-vitals rule) |
| `bytes*`, `requests` | `Network.loadingFinished.encodedDataLength` (headers + body over the wire, 0 for a cache hit) from the page AND its workers, split by kind. The PowerSync WebSocket is counted separately (`syncWsBytesIn`: decompressed frame payload characters) |
| `syncWsConnections`, `syncErrors`, `socketLife` | integrity: sync connections opened (1 = no reconnect), every distinct PowerSync `downloadError`, and every sync socket open/close/`close()` with its stack |
| `proxyStats` | the shaper's own count: requests, tunnels, bytes down/up on the wire, bytes dropped for closed connections |
| report only: `syncMs`, `dataAfterSyncMs`, `wireBytesDown` | `hasSynced − connected`, `data − hasSynced` (cold runs), `proxyStats.bytesDown` |
| `mainThreadCpuMsToData`, `rendererCpuMsToData` | `Performance.getMetrics` `ThreadTime` / `ProcessTime` when `data` fired: CPU actually spent, which moves far less with machine load than wall time |
| `calibMs`, `calibEndMs` | the renderer calibration at start and end (see the gate) |

Output: `results/load-<label>-<profile>-<mode>.json` (every run, every request, the longest tasks
and LoAFs with their scripts, the signals, the summary). Re-running the same command resumes.

To compare a build, serve it on the same port and run the same command with another `--label`.
Under this much machine noise, interleave the two builds with `--more 1` (see "One command per
journey").

## Frames: view switch, scroll, reply arrival

```sh
node measure-frames.mjs --url http://127.0.0.1:5341/acme --profile none  --runs 5 --label baseline
node measure-frames.mjs --url http://127.0.0.1:5341/acme --profile cpu4x --runs 5 --label baseline
```

One Chrome session per profile (profile directory `profiles/frames-<label>-<profile>`, kept, so the
replica is warm after the first sync). The session waits until the sync is connected and not
downloading (a kept profile first catches up on everything written since it last ran), then for
each iteration: Home must stay on screen for 1.5 s (after a boot the app reopens the last session
a moment later, and a click aimed at a Home row would land on that thread), the renderer gate
runs, and then:

1. **Home → long thread**: click the Home ledger row "perf-lab · long thread" (401 real messages,
   see `SEED.md`), time from the browser's own `pointerdown` timestamp to the first frame in which
   the thread's last message is painted (`waitPainted`: checked in rAF, timed in a MessageChannel
   task right after that frame). The frame window runs until 1 s later.
2. **Long thread → reply thread**: click the rail row "perf-lab · reply target" (the rail is on
   Recents: the app's own `nm:navView` preference is set at document start when the profile has
   none. `Show n more` is pressed, untimed, if the row is past the cap), time to its first message
   painted.
3. **Reply arrival**: wait until the sync connection is up, then POST a ~6 KB markdown reply
   (headings, a 40-line code fence, a table, lists) as the agent rex to `/v1/messages` on the
   harness's control-api, into the open thread, with a client-made id. Every time is measured from
   the POST, on one clock (Node's `Date.now()`, and page times plus `performance.timeOrigin`):
   the POST response, the sync WebSocket frame that carries the id (the CDP frame timestamp,
   converted from monotonic to wall time with the latest `requestWillBeSent` pair), the row in the
   local replica (a primary-key poll every 25 ms, an upper bound, off with `--no-replica-poll`),
   the reply's first line (HEAD token) painted, and its last line (TAIL token) painted. Every sync
   frame in the window is logged with its time, size and kind (`syncFramesAfterPost`: `data`,
   `checkpoint_complete` ...). Frames from the POST to 1.5 s after the tail painted. A reply that
   has not painted after 180 s is recorded as failed and the iteration goes on.
4. **Reply thread → long thread**: click the long thread's rail row, time to its last message
   painted (the second thread → thread sample).
5. **Scroll** (last, because it saturates the main thread at CPU 4x and would bias anything after
   it): the thread's scroller (`.tmsgs.convomsgs`, scrollHeight about 50,000 px) from the bottom to
   the top and back with `Input.dispatchMouseEvent type=mouseWheel`, 100 px every 16 ms (steady),
   then a fling-like pattern (flicks of wheel deltas starting at 900 px and decaying by 0.86 per
   16 ms) up and down. The wheel is sent to the scroller's left gutter, outside the message column:
   a wheel gesture latches to the innermost scroller under the pointer, and a code block that
   scrolls on its own swallowed a steady wheel at the same scrollTop every run. Each pattern stops
   at the end, or after 60 s (`capped`). Reported: frames, p50/p95/p99 frame delta, % > 16.7 ms,
   % > 33.3 ms, longest frame, dropped-frame estimate, LoAF blocking, px/s, and whether the end
   was reached.

Frame deltas are the main thread's rAF cadence. A wheel scroll can be composited while the main
thread janks, so a high p95 here means the main thread misses frames (renders, layout, handlers),
not necessarily that the scroll offset stuttered on screen. The videos show the on-screen truth.

Output: `results/frames-<label>-<profile>[-<only>].json`. `--only switch,scroll,reply` runs a
subset. On a failure the page's screenshot is saved next to it as `-failure.png`.

## Videos and the filmstrip

```sh
node videos.mjs --url http://127.0.0.1:5341/acme --label baseline            # all four
node videos.mjs --url http://127.0.0.1:5341/acme --label baseline --only reply
node sidebyside.mjs videos/baseline-cold-fast4g.mp4 videos/after-cold-fast4g.mp4 videos/compare-cold-fast4g.mp4
```

`videos/<label>-cold-fast4g.mp4` (blank tab → Home with data + 2 s, fast4g),
`<label>-warm-broadband.mp4`, `<label>-thread-scroll.mp4` (click on the Home row, open, scroll to
the top and back), `<label>-reply-arrival.mp4` (the POST is at 1.0 s), and
`<label>-cold-fast4g-filmstrip/` (a PNG every 100 ms) with `<label>-cold-fast4g-filmstrip-sheet.png`.
The screencast emits a frame only on a visual change. Each frame is held until the next one
arrived (per-frame durations from the frames' own timestamps), then converted to 30 fps CFR.
Video runs are for looking at: the screencast costs the page CPU, so no number comes from them.

## Trace and JS profiles

```sh
node trace.mjs --url http://127.0.0.1:5341/acme --profile fast4g --seconds 240 --out traces/baseline-fast4g-cold.json
node trace.mjs --summarize traces/baseline-fast4g-cold.json
node jsprofile.mjs --url http://127.0.0.1:5341/acme --profile none --seconds 60 --out traces/baseline-jsprof-none
node profile-journey.mjs --journey scroll --profile cpu4x --label baseline      # open | scroll | reply
```

The trace stops 3 s after the first synced row is painted (or at `--seconds`). The summary is
written next to it (`.summary.json`): main-thread busy time, long tasks, the longest tasks with the
heaviest script entry inside each, self time by event kind, the top 10 by URL + function, and the
same for the worker threads. The `.cpuprofile` files load in DevTools' Performance panel.

## Compare two builds

Build each side the same way (the section at the top), for example the base branch into
`/tmp/nm-web-before` and your branch into `/tmp/nm-web-after`. Then:

```sh
zsh run-compare.sh /tmp/nm-web-before /tmp/nm-web-after 5
node aggregate.mjs --before final-before --after final-after > final.json
```

Each round serves the before build, runs the broadband and fast4g loads (cold and warm) and the
cpu4x frame journeys, then does the same for the after build. The before build gets production's
headers today (`--cache vercel`). The after build gets the same defaults plus the rules in
`apps/hq/vercel.json`, so a new header rule counts. `final.json` holds the median, p75, min
and max of every milestone, with the run count, the page architecture and the load average.

The first comparison (2026-09-25, the web speed round) is in `docs/18-performance.md` §9.

## The report

```sh
node report.mjs --label baseline --build /tmp/nm-web-build     # → baseline.json + baseline-tables.md
```

## Environment knobs

`CHROME_BIN` (default the installed Google Chrome), `NM_CHROME_WRAP` (a command to launch Chrome
under, for example `taskpolicy -a`), `FFMPEG`/`FFPROBE`. Ports used by this harness: control-api
8841, web 5341, Chrome 9341 (loads, frames) and 9351 to 9359 (trace 9351, jsprofile 9352, videos
9353, one-off load checks 9354, profile-journey 9355, side-by-side 9359), and the shaping proxy
9358 (loads), 9357 (videos), 9356 (trace).
