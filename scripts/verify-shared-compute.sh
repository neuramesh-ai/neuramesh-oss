#!/usr/bin/env bash
# Shared compute, proven live with TWO daemons in ONE workspace (0114).
#
# The property that costs money: a chat message wakes an agent that BOTH member machines now
# host, and exactly ONE of them may generate. Before the run lease, dedupe happened at the reply
# insert (0060) — after generation — so both would have spent a turn and one answer would be
# discarded. The lease moves the race in front of the spend.
set -uo pipefail
API=http://127.0.0.1:8795
WS=a0000000-0000-0000-0000-00000000000a
GEORGE='{"kind":"human","id":"00000000-0000-0000-0000-000000000001"}'
pg() { docker exec stack-pg-1 psql -q -U postgres -d nm -tAc "$1" | head -1 | tr -d '[:space:]'; }
pgm() { docker exec stack-pg-1 psql -q -U postgres -d nm -tAc "$1"; }

# Every call below speaks through the bare x-nm-actor header, which the control-api refuses unless
# it was started with NM_ALLOW_ACTOR_HEADER=1 (closed by default; scripts/dev-app-cdp.sh sets it).
# Checked first, so a closed gate names itself instead of failing every assertion as a 401.
if [ "$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/workspaces" -H "x-nm-actor: $GEORGE")" = 401 ]; then
  echo "the control-api at $API refuses the actor header: start it with NM_ALLOW_ACTOR_HEADER=1" >&2
  exit 1
fi

pass=0; fail=0
ok()  { echo "  ✓ $1"; pass=$((pass+1)); }
bad() { echo "  ✗ $1"; echo "      got: ${2:-}"; fail=$((fail+1)); }

echo "── 0. two members, two machines, one workspace ───────────────────────────"
pgm "select '  '||name||'  owner='||substr(owner_user_id::text,1,8)||'  runtimes='||runtimes::text
     from machines where workspace_id='$WS' order by name"
n=$(pg "select count(*) from machines where workspace_id='$WS'")
[ "$n" = 2 ] && ok "two machines registered" || bad "expected 2 machines" "$n"
n=$(pg "select count(distinct owner_user_id) from machines where workspace_id='$WS'")
[ "$n" = 2 ] && ok "owned by two DIFFERENT members" || bad "expected 2 owners" "$n"
n=$(pg "select count(*) from machines where workspace_id='$WS' and runtimes::text != '[]'")
[ "$n" = 2 ] && ok "both published what they can serve" || bad "capability missing" "$n"

echo
echo "── 1. both daemons host the SAME agents (the pin is gone) ────────────────"
# agents.machine_id is provenance now: every agent belongs to the workspace, not to one laptop
n=$(pg "select count(distinct machine_id) from agents where workspace_id='$WS' and retired_at is null")
echo "  agents registered across $n machine(s) — provenance only"
AGENT=$(pg "select id from agents where workspace_id='$WS' and retired_at is null and role='orchestrator' order by name limit 1")
ANAME=$(pg "select name from agents where id='$AGENT'")
CH=$(pg "select id from channels where workspace_id='$WS' order by slug limit 1")
echo "  waking @$ANAME in channel ${CH:0:8}"

echo
echo "── 2. ONE chat message, two live hosts ───────────────────────────────────"
BEFORE=$(pg "select count(*) from runs where workspace_id='$WS' and kind='wake'")
MSG=$(curl -s "$API/v1/messages" -H 'content-type: application/json' -H "x-nm-actor: $GEORGE" \
  -d "{\"workspace\":\"$WS\",\"channel\":\"$CH\",\"body\":\"@$ANAME shared-compute probe $RANDOM — who answers?\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["message"]["id"])' 2>/dev/null)
[ -n "$MSG" ] && ok "message posted (${MSG:0:8})" || bad "post failed" ""

# let both daemons see it, decide, and race for the lease
for i in $(seq 1 30); do
  n=$(pg "select count(*) from runs where trigger_message_id='$MSG'")
  [ "$n" -ge 1 ] && break
  sleep 2
done
sleep 6   # give the LOSER time to have also tried, if it were going to

echo
echo "── 3. the assertion: exactly one run, one machine, one reply ─────────────"
RUNS=$(pg "select count(*) from runs where trigger_message_id='$MSG'")
[ "$RUNS" = 1 ] && ok "exactly ONE run opened for this trigger (the lease held)" || bad "expected 1 run" "$RUNS"

HOST=$(pg "select m.name from runs r left join machines m on m.id=r.machine_id where r.trigger_message_id='$MSG'")
[ -n "$HOST" ] && ok "the run records WHICH machine served it: $HOST" || bad "no machine recorded" "$HOST"

# origin affinity: george posted, so george's machine (compute-a) should have taken it
[ "$HOST" = "compute-a" ] && ok "ORIGIN AFFINITY: the asker's own machine served it" \
  || bad "a non-origin machine served it" "$HOST"

REPLIES=$(pg "select count(*) from messages where reply_to='$MSG'")
[ "$REPLIES" -le 1 ] && ok "at most one reply (0060 never had to fire — no wasted turn)" || bad "duplicate replies" "$REPLIES"

echo
echo "── 4. the negative control ───────────────────────────────────────────────"
# Proof the count above is not trivially 1: both hosts really are watching this workspace, so a
# SECOND distinct message must produce a SECOND run (leases are per-trigger, not a global lock).
MSG2=$(curl -s "$API/v1/messages" -H 'content-type: application/json' -H "x-nm-actor: $GEORGE" \
  -d "{\"workspace\":\"$WS\",\"channel\":\"$CH\",\"body\":\"@$ANAME second probe $RANDOM\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["message"]["id"])' 2>/dev/null)
for i in $(seq 1 30); do
  n=$(pg "select count(*) from runs where trigger_message_id='$MSG2'")
  [ "$n" -ge 1 ] && break
  sleep 2
done
R2=$(pg "select count(*) from runs where trigger_message_id='$MSG2'")
[ "$R2" = 1 ] && ok "a different trigger opens its own single run (not a global lock)" || bad "expected 1" "$R2"
AFTER=$(pg "select count(*) from runs where workspace_id='$WS' and kind='wake'")
[ "$AFTER" -gt "$BEFORE" ] && ok "wake runs actually grew ($BEFORE → $AFTER) — the hosts are live" || bad "no runs opened at all" "$BEFORE→$AFTER"

echo
echo "── 5. what the UI now shows ──────────────────────────────────────────────"
pgm "select '  run '||substr(r.id::text,1,8)||'  agent='||a.name||'  on='||coalesce(m.name,'?')||'  state='||r.state
     from runs r join agents a on a.id=r.agent_id left join machines m on m.id=r.machine_id
     where r.trigger_message_id in ('$MSG','$MSG2')"

echo
echo "═════════════════════════════════════════════════════════════════════════"
echo "  TWO-DAEMON PROOF: $pass passed, $fail failed"
[ "$fail" = 0 ] || exit 1
