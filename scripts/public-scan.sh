#!/usr/bin/env bash
# The public-repo gate (docs/design/oss-release-2026-09/implementation-plan.md, U4).
#
#   bash scripts/public-scan.sh
#
# Fails when the TRACKED tree holds anything that must not reach neuramesh-ai/neuramesh-oss:
#
#   1. a secret, by gitleaks: the tracked files, then the history. .gitleaks.toml allowlists the
#      fixtures by name, each with its reason.
#   2. a personal email domain, a Supabase project ref, a /Users/<name> machine path. Patterns,
#      not a list of paths, so the next launch.json cannot slip through (review F10).
#   3. every pattern in .public-scan.local, one extended regex per line, case-insensitive. That
#      file is gitignored: it holds the founder's handles and the exact infra ids, so this script
#      never prints them. CI writes it from the PUBLIC_SCAN_LOCAL secret when the secret is set.
#   4. a tracked file under docs/evidence, private/ or var/.
#
# Exit 0 = clean. Exit 1 = a hit, listed. Exit 2 = cannot run.
# NM_SCAN_HISTORY=0 skips the history pass (public-snapshot.sh sets it: an orphan has no history).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
ok()  { printf '✓ %s\n' "$*"; }
hit() { fail=1; printf '✗ %s\n' "$*"; }

command -v gitleaks >/dev/null 2>&1 || { echo "public-scan: gitleaks is not installed (brew install gitleaks)" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# ── 1. gitleaks ──────────────────────────────────────────────────────────────────────────────
# Tracked files only: export them, so node_modules and untracked scratch never count.
mkdir -p "$work/tree"
if ! git ls-files -z | tar --null -T - -cf - | tar -x -C "$work/tree"; then
  hit "could not export the tracked files (a tracked file is missing on disk?)"
fi
if gitleaks dir "$work/tree" --config .gitleaks.toml --no-banner --redact -v --exit-code 1 >"$work/tree.log" 2>&1; then
  ok "gitleaks: tracked files clean ($(git ls-files | wc -l | tr -d ' ') files)"
else
  hit "gitleaks: tracked files"
  sed "s#$work/tree/##" "$work/tree.log"
fi

if [ "${NM_SCAN_HISTORY:-1}" != "0" ]; then
  if gitleaks git . --config .gitleaks.toml --no-banner --redact -v --exit-code 1 >"$work/history.log" 2>&1; then
    ok "gitleaks: history clean ($(git rev-list --count HEAD) commits)"
  else
    hit "gitleaks: history"
    cat "$work/history.log"
  fi
fi

# ── 2. identifiers ───────────────────────────────────────────────────────────────────────────
# Tracked text files. The scan and its config are excluded from their own patterns.
scan() { # $1 label, $2 extended regex, $3 extra git-grep flags (optional)
  local out
  out=$(git grep -n -I -E ${3:-} -e "$2" -- . ':!scripts/public-scan.sh' ':!.gitleaks.toml' 2>/dev/null)
  if [ -n "$out" ]; then
    hit "$1 ($(printf '%s\n' "$out" | wc -l | tr -d ' ') lines)"
    printf '%s\n' "$out" | cut -c1-200
  else
    ok "$1"
  fi
}
scan "personal email domains" '@(gmail\.com|googlemail\.com|icloud\.com|me\.com|hotmail\.[a-z]+|outlook\.[a-z]+|live\.[a-z]+|yahoo\.[a-z.]+|proton\.me|protonmail\.com|alonge\.dev)'
scan "Supabase project refs" '[a-z]{20}\.supabase\.(co|in)|supabase\.com/dashboard/project/[a-z]{20}'
scan "/Users/<name> machine paths" '/Users/[A-Za-z0-9._-]+'

# ── 3. the private pattern file ──────────────────────────────────────────────────────────────
if [ -f .public-scan.local ]; then
  grep -v -E '^[[:space:]]*(#|$)' .public-scan.local >"$work/patterns" || true
  n=$(grep -c . "$work/patterns" || true)
  if [ "$n" -gt 0 ]; then
    out=$(git grep -n -I -E -i -f "$work/patterns" -- . ':!scripts/public-scan.sh' 2>/dev/null)
    if [ -n "$out" ]; then
      hit ".public-scan.local patterns ($n patterns, $(printf '%s\n' "$out" | wc -l | tr -d ' ') lines)"
      printf '%s\n' "$out" | cut -c1-200
    else
      ok ".public-scan.local patterns ($n) clean"
    fi
  fi
else
  printf '· .public-scan.local is absent: the founder-specific patterns did not run (see the header)\n'
fi

# ── 4. directories that never ship ───────────────────────────────────────────────────────────
tracked=$(git ls-files docs/evidence private var)
if [ -n "$tracked" ]; then
  hit "tracked files under docs/evidence, private/ or var/ ($(printf '%s\n' "$tracked" | wc -l | tr -d ' '))"
  printf '%s\n' "$tracked" | head -20
else
  ok "docs/evidence, private/ and var/ hold no tracked file"
fi

if [ "$fail" -eq 0 ]; then
  echo "public-scan: clean"
  exit 0
fi
echo "public-scan: FAILED (see ✗ above)"
exit 1
