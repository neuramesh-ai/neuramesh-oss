#!/bin/zsh
# run-all.sh: every number, video and trace for ONE build, in order, one log per step.
#
#   zsh run-all.sh <buildDir> <label> [steps]
#   zsh run-all.sh /tmp/nm-web-build baseline                 # everything
#   zsh run-all.sh /tmp/nm-web-build baseline load-none,frames-cpu4x
#
# Needs: the control-api on 8841 (see README.md), nothing else on 5341, the Bash sandbox OFF
# (Chrome's debugging port never opens inside it). Starts and stops its own static server.
# Never wrap this in /usr/local/bin/timeout or any other x86_64 tool: cdp.mjs pins Chrome to arm64,
# but ffmpeg and anything else universal would still run translated.
setopt NO_BG_NICE
H=${0:A:h}
BUILD=${1:?buildDir}
LABEL=${2:?label}
STEPS=${3:-load-none,load-broadband,load-fast4g,load-prodcache,frames-none,frames-cpu4x,videos,trace,profile-open,profile-scroll,profile-reply,report}
WT=${H:h:h:h}   # the repository root (scripts/perf/web -> root)
source ~/.nvm/nvm.sh >/dev/null && nvm use 22.19.0 >/dev/null
cd $H
mkdir -p logs results traces videos
URL=http://127.0.0.1:5341/acme

serve() {  # serve <cache flags...>
  [[ -f serve.pid ]] && kill $(cat serve.pid) 2>/dev/null; sleep 1
  nohup node serve.mjs $BUILD --port 5341 --api http://127.0.0.1:8841 "$@" > logs/serve-$LABEL.log 2>&1 &
  echo $! > serve.pid
  for i in {1..50}; do curl -s -o /dev/null http://127.0.0.1:5341/ && break; sleep 0.2; done
  echo "[run] serving $BUILD with $*: $(curl -sI http://127.0.0.1:5341/assets/$(ls $BUILD/assets | grep '^index-.*\.js$' | head -1) | grep -i cache-control | tr -d '\r')"
}
step() { [[ ",$STEPS," == *",$1,"* ]]; }
t0=$(date +%s)
say() { echo "[run $(( $(date +%s) - t0 ))s] $*"; }

serve --cache immutable
for p in none broadband fast4g; do
  if step load-$p; then
    say "load $p"
    node measure-load.mjs --url $URL --profile $p --runs 5 --mode both --label $LABEL > logs/load-$LABEL-$p.log 2>&1 || say "load $p FAILED (see logs/load-$LABEL-$p.log)"
  fi
done
if step load-prodcache; then
  # production's real headers today: every static file max-age=0, must-revalidate (vercel.json sets none for /assets)
  serve --cache vercel --vercel-json $WT/apps/desktop/vercel.json
  for p in broadband fast4g; do
    say "load $p, production cache headers"
    node measure-load.mjs --url $URL --profile $p --runs 5 --mode both --label $LABEL-prodcache > logs/load-$LABEL-prodcache-$p.log 2>&1 || say "load prodcache $p FAILED"
  done
  serve --cache immutable
fi
for p in none cpu4x; do
  if step frames-$p; then
    say "frames $p"
    node measure-frames.mjs --url $URL --profile $p --runs 5 --label $LABEL > logs/frames-$LABEL-$p.log 2>&1 || say "frames $p FAILED (see logs/frames-$LABEL-$p.log)"
  fi
done
if step videos; then
  say "videos"
  node videos.mjs --url $URL --label $LABEL > logs/videos-$LABEL.log 2>&1 || say "videos FAILED"
fi
if step trace; then
  say "trace fast4g cold"
  node trace.mjs --url $URL --profile fast4g --seconds 240 --out traces/$LABEL-fast4g-cold.json > logs/trace-$LABEL.log 2>&1 || say "trace FAILED"
  say "js profile none cold"
  node jsprofile.mjs --url $URL --profile none --seconds 20 --out traces/$LABEL-jsprof-none-cold > logs/jsprof-$LABEL.log 2>&1 || say "jsprofile FAILED"
fi
for j in open scroll reply; do
  if step profile-$j; then
    say "js profile of the $j journey (none, then cpu4x)"
    node profile-journey.mjs --journey $j --profile none --label $LABEL > logs/profile-$j-$LABEL-none.log 2>&1 || say "profile $j none FAILED"
    node profile-journey.mjs --journey $j --profile cpu4x --label $LABEL > logs/profile-$j-$LABEL-cpu4x.log 2>&1 || say "profile $j cpu4x FAILED"
  fi
done
if step report; then
  node report.mjs --label $LABEL --build $BUILD > logs/report-$LABEL.log 2>&1
fi
say "done"
