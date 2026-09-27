#!/bin/zsh
# run-compare.sh: a before/after comparison, interleaved round by round so machine load hits both.
#   zsh run-compare.sh <beforeBuildDir> <afterBuildDir> [rounds] [labelPrefix]
# then: node aggregate.mjs --before <labelPrefix>-before --after <labelPrefix>-after > final.json
# before = the baseline build served with production's headers today (every file max-age=0).
# after  = the branch build served with production's defaults plus the branch's vercel.json rules.
setopt NO_BG_NICE
H=${0:A:h}
WT=${H:h:h:h}   # the repository root (scripts/perf/web -> root)
BEFORE=${1:?beforeBuildDir}
AFTER=${2:?afterBuildDir}
ROUNDS=${3:-5}
P=${4:-final}
source ~/.nvm/nvm.sh >/dev/null && nvm use 22.19.0 >/dev/null
cd $H; mkdir -p logs results
URL=http://127.0.0.1:5341/acme
serve() {
  local build=$1; shift
  [[ -f serve.pid ]] && kill $(cat serve.pid) 2>/dev/null; sleep 1
  nohup node serve.mjs $build --port 5341 --api http://127.0.0.1:8841 "$@" > logs/serve-$P.log 2>&1 &
  echo $! > serve.pid
  for i in {1..50}; do curl -s -o /dev/null http://127.0.0.1:5341/ && break; sleep 0.2; done
}
t0=$(date +%s); say() { echo "[final $(( $(date +%s) - t0 ))s load $(sysctl -n vm.loadavg | awk '{print $2}')] $*"; }
for r in $(seq 1 $ROUNDS); do
  for side in before after; do
    if [[ $side == before ]]; then serve $BEFORE --cache vercel; else serve $AFTER --cache vercel --vercel-json $WT/apps/hq/vercel.json; fi
    say "round $r $side: $(curl -sI http://127.0.0.1:5341/assets/$(ls $([[ $side == before ]] && echo $BEFORE || echo $AFTER)/assets | grep '^index-.*\.js$' | head -1) | grep -i cache-control | tr -d '\r')"
    for p in broadband fast4g; do
      say "round $r $side load $p"
      node measure-load.mjs --url $URL --profile $p --more 1 --mode both --label $P-$side >> logs/$P-load-$side-$p.log 2>&1 || say "FAILED load $p $side"
    done
    say "round $r $side frames cpu4x"
    node measure-frames.mjs --url $URL --profile cpu4x --runs 1 --label $P-$side --out results/frames-$P-$side-cpu4x-r$r.json >> logs/$P-frames-$side.log 2>&1 || say "FAILED frames $side r$r"
  done
done
[[ -f serve.pid ]] && kill $(cat serve.pid) 2>/dev/null
say done
