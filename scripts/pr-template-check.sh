#!/usr/bin/env bash
# The pull request template, enforced (docs/43 §2). Every `## ` heading of the template must be in
# the pull request body, with words of its own under it. The template's comments (<!-- -->) are
# guidance, not words, so an untouched template fails. In neuramesh-ai/neuramesh-oss the workflow
# .github/workflows/pr-template.yml runs this on every pull request, again when the body is edited.
# scripts/public-snapshot.sh composes the publish pull request's body from the same sections, so
# the publish passes the check it put there.
#
#   printf '%s' "$BODY" | bash scripts/pr-template-check.sh .github/pull_request_template.md
#   bash scripts/pr-template-check.sh --self-test
#
# Exit 0 = every section is there, with words. Exit 1 = a section is missing or empty, listed.
set -euo pipefail

fail=0
ok()  { printf '✓ %s\n' "$*"; }
hit() { fail=1; printf '✗ %s\n' "$*"; }

# <!-- … --> gone, across lines too
strip_comments() {
  awk '
    { line = $0; out = ""
      while (1) {
        if (inc) { i = index(line, "-->"); if (i == 0) { line = ""; break }; line = substr(line, i + 3); inc = 0 }
        else { i = index(line, "<!--"); if (i == 0) { out = out line; break }; out = out substr(line, 1, i - 1); line = substr(line, i + 4); inc = 1 }
      }
      print out
    }'
}

# the `## ` headings of a markdown text, in order, spacing folded
headings() {
  strip_comments | sed -n -E 's/^##[[:space:]]+(.*[^[:space:]])[[:space:]]*$/\1/p' | sed -E 's/[[:space:]]+/ /g'
}

# the lines with words under one heading of the body: -1 when the heading is not there
words_under() { # $1 heading, the body on stdin
  strip_comments | awk -v h="$1" '
    /^##[[:space:]]+/ { t = $0; sub(/^##[[:space:]]+/, "", t); sub(/[[:space:]]+$/, "", t); gsub(/[[:space:]]+/, " ", t); on = (t == h); if (on) found = 1; next }
    /^#[[:space:]]/ { on = 0; next }
    on && NF { n++ }
    END { print (found ? n + 0 : -1) }'
}

check() { # $1 the template, the body on stdin
  local tpl=$1 body h n any=0
  body=$(cat)
  while IFS= read -r h; do
    [ -n "$h" ] || continue
    any=1
    n=$(printf '%s\n' "$body" | words_under "$h")
    if [ "$n" -lt 0 ]; then hit "## $h: the section is missing"
    elif [ "$n" -eq 0 ]; then hit "## $h: the section is empty (the template's comments do not count)"
    else ok "## $h ($n lines)"; fi
  done < <(headings <"$tpl")
  if [ "$any" -eq 0 ]; then hit "$tpl has no ## heading: nothing to check"; fi
  if [ "$fail" -ne 0 ]; then
    echo "pr-template-check: FAILED. The body must carry every section of $tpl, with words under each (see ✗ above)."
    return 1
  fi
  echo "pr-template-check: every section is there"
}

self_test() {
  local cases=0 bad=0
  # not local: the EXIT trap runs after this function returned
  tpl=$(mktemp)
  trap 'rm -f "$tpl"' EXIT
  cat >"$tpl" <<'T'
<!-- read this first -->
## What & why

<!-- the change and the reason -->

## Evidence

<!-- proof, not claims
     on two lines -->
T
  expect() { # $1 label, $2 the exit code wanted, the body on stdin
    local rc=0
    bash "$0" "$tpl" >/dev/null 2>&1 || rc=$?
    cases=$((cases + 1))
    if [ "$rc" -eq "$2" ]; then ok "self-test: $1"; else bad=1; hit "self-test: $1 (exit $rc, wanted $2)"; fi
  }
  expect "both sections with words pass" 0 <<'B'
## What & why

A fix for the empty first run.

## Evidence

Tests green, two screenshots.
B
  expect "the untouched template fails" 1 <"$tpl"
  expect "a missing section fails" 1 <<'B'
## What & why

Only the first section.
B
  expect "words inside a comment do not count" 1 <<'B'
## What & why

Words here.

## Evidence

<!-- I will add
the evidence later -->
B
  expect "an empty body fails" 1 <<'B'
B
  expect "spacing in a heading folds" 0 <<'B'
##   What &   why

Words.

## Evidence  

More words.
B
  expect "a section under a deeper heading counts" 0 <<'B'
## What & why

### The reason

Words under a sub-heading are the section's words.

## Evidence

Words.
B
  expect "a section ended by a top heading is empty" 1 <<'B'
## What & why

Words.

## Evidence

# A title

Words under a title are not the section's.
B
  # the real public template, wherever this repository holds it
  local real
  for real in .github/public/pull_request_template.md .github/pull_request_template.md; do
    [ -f "$real" ] || continue
    cases=$((cases + 1))
    if bash "$0" "$real" <"$real" >/dev/null 2>&1; then bad=1; hit "self-test: $real untouched passes (it must fail)"; else ok "self-test: $real untouched fails"; fi
    break
  done
  if [ "$bad" -ne 0 ]; then echo "pr-template-check: self-test FAILED"; exit 1; fi
  echo "pr-template-check: self-test passed ($cases cases)"
}

case "${1:-}" in
  --self-test) self_test ;;
  '' | -h | --help) sed -n '2,12p' "$0"; exit 2 ;;
  *) [ -f "$1" ] || { echo "pr-template-check: no template at $1" >&2; exit 2; }; check "$1" ;;
esac
