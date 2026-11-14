#!/usr/bin/env bash
# THE SECRET LEAK SCAN for one e2e run (README.md beside this file, "Secret leak scan").
#
# The boxcli probe mints a synthetic credential (nm-e2e-<24 hex>, cloudrun/e2e-boxcli.ts) and sends
# it through the production lane into the box. The sandbox CLI writes every command line to Cloud
# Logging, and so does machined. This scan reads every log entry the run's machine pool wrote from the
# run's start, and fails on any raw value of that shape. It also lists the E2E_SECRET_SHA lines it saw,
# so the report's sha and the machine logs tie the run to the instance.
#
# It runs after the driver as a second Cloud Build step (cloudbuild-e2e.yaml), even when the driver
# failed, and its exit code is the build's: 1 when the driver failed or a raw value leaked, 2 when it
# could not scan. The build service account needs roles/logging.viewer (infra/cloudrun-e2e).
#   bash scripts/e2e-cloudrun/leak-scan.sh [report.json] [driver-exit-file]
set -uo pipefail
REPORT="${1:-/workspace/e2e-report.json}"
EXIT_FILE="${2:-/workspace/e2e-exit}"
PROJECT="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
OUT="${TMPDIR:-/tmp}/e2e-machine-logs.json"

[ -s "$REPORT" ] || { echo "leak-scan: no report at $REPORT (the driver did not finish)"; exit 2; }
read -r MACHINE START < <(python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); print(r.get("ids",{}).get("machine",""), r.get("startedAt",""))' "$REPORT")
[ -n "$MACHINE" ] || { echo "leak-scan: the report names no machine (setup failed), nothing to scan"; exit 2; }

# the pool's logs land a few seconds late
sleep "${NM_LEAK_SCAN_SETTLE_S:-20}"
gcloud logging read \
  "resource.type=\"cloud_run_worker_pool\" AND resource.labels.worker_pool_name=\"m-${MACHINE}\" AND timestamp>=\"${START}\"" \
  --project="$PROJECT" --limit=50000 --format=json > "$OUT" \
  || { echo "leak-scan: cannot read the machine's logs (roles/logging.viewer on the build account?)"; exit 2; }

python3 - "$REPORT" "$OUT" <<'EOF'
import json, re, sys
report = json.load(open(sys.argv[1]))
rows = json.load(open(sys.argv[2]))
raw = re.compile(r'nm-e2e-[0-9a-f]{24}(?![0-9a-f])')
hits, shas = [], set()
for e in rows:
    text = e.get('textPayload') or json.dumps(e.get('jsonPayload') or e.get('protoPayload') or {})
    hits += [(e.get('timestamp'), m.group(0)) for m in raw.finditer(text)]
    shas.update(re.findall(r'E2E_SECRET_SHA=([0-9a-f]{64})', text))
want = (report.get('evidence') or {}).get('E2E_SECRET_SHA')
print(f"leak-scan: {len(rows)} log entries from m-{report['ids']['machine']} since {report['startedAt']}")
print(f"leak-scan: raw probe secrets found: {len(hits)}")
print(f"leak-scan: E2E_SECRET_SHA lines: {', '.join(s[:16] for s in sorted(shas)) or 'none'}")
if want:
    print(f"leak-scan: the report's E2E_SECRET_SHA {want[:16]} {'is' if want in shas else 'is NOT'} among them")
# never print a found value whole: the build log is a log too
for t, v in hits[:5]:
    print(f"  LEAK at {t}: {v[:10]}...")
sys.exit(1 if hits else 0)
EOF
scan=$?

driver=$(cat "$EXIT_FILE" 2>/dev/null || echo 1)
echo "leak-scan: driver exit ${driver}, scan exit ${scan}"
[ "$scan" -eq 2 ] && exit 2
[ "$driver" = "0" ] && [ "$scan" -eq 0 ] && exit 0
exit 1
