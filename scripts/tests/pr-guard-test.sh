#!/usr/bin/env bash
# Tests for scripts/guards/pr-guard.sh — the change-set size limit.
#
# The limit itself is arithmetic, but the pathspec excludes around it fail
# silently in both directions. A glob that matches nothing quietly starts
# counting lockfiles, and every dependency bump becomes unmergeable for a
# reason nobody would look for. A glob that matches too much quietly stops
# counting anything, which is indistinguishable from a repository whose PRs
# happen to be small. Neither shows up as a red check.
#
# Run from anywhere inside the real repo:  scripts/tests/pr-guard-test.sh
set -euo pipefail

# CI sets GITHUB_BASE_REF for pull requests; every case below compares against
# the throwaway repository's own main, not whatever the ambient environment
# happens to name.
unset GITHUB_BASE_REF

guard="$(git rev-parse --show-toplevel)/scripts/guards/pr-guard.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail=0
check() {
  local name=$1 expected=$2
  shift 2
  local got=0
  "$@" >/dev/null 2>&1 || got=$?
  if [ "$got" -eq "$expected" ]; then
    echo "ok: $name"
  else
    echo "FAIL: $name (expected exit $expected, got $got)"
    fail=1
  fi
}

# run_guard MAX_FILES MAX_LINES — the guard under explicit limits, so a case
# can state the boundary it is testing instead of generating a thousand lines.
# shellcheck disable=SC2329 # invoked indirectly, as an argument to check()
run_guard() {
  MAX_CHANGED_FILES="$1" MAX_CHANGED_LINES="$2" "$guard"
}

# --- a repository with a base branch to diff against -------------------------

git init -q -b main "$work/upstream"
(
  cd "$work/upstream"
  git config user.name test
  git config user.email test@test
  mkdir -p engine web
  echo x > seed.txt
  # Something already long enough on main that a branch can delete from it.
  seq 20 > bulk.txt
  echo x > engine/go.sum
  echo x > web/package-lock.json
  echo x > pnpm-lock.yaml
  git add -A
  git commit -qm "chore: init"
)
git clone -q "$work/upstream" "$work/repo"
cd "$work/repo"
git config user.name test
git config user.email test@test

# on_branch NAME — a fresh branch off main, ready to be changed and committed.
on_branch() {
  git checkout -q main
  git checkout -q -B "$1" main
}

commit_all() {
  git add -A
  git commit -qm "feat: change"
}

# add_lines FILE COUNT
add_lines() {
  local file=$1 count=$2 i
  for ((i = 0; i < count; i++)); do
    echo "line $i" >> "$file"
  done
}

# --- nothing to measure ------------------------------------------------------

on_branch empty
check "an unchanged branch passes" 0 run_guard 30 1000

# --- the file count ----------------------------------------------------------

on_branch five-files
for n in 1 2 3 4 5; do echo x > "file$n.txt"; done
commit_all
check "five files under a limit of five passes" 0 run_guard 5 1000
check "five files over a limit of four fails" 1 run_guard 4 1000

# --- the line count ----------------------------------------------------------

on_branch ten-lines
add_lines seed.txt 10
commit_all
check "ten lines under a limit of ten passes" 0 run_guard 30 10
check "ten lines over a limit of nine fails" 1 run_guard 30 9

# Deletions are changes too — a PR that removes two thousand lines is exactly
# as hard to review as one that adds them.
on_branch deletions
: > bulk.txt
commit_all
check "deleted lines count against the limit" 1 run_guard 30 5

# --- lockfiles are excluded --------------------------------------------------
#
# A one-line dependency change regenerates thousands of lock lines. The limit
# is about reviewable increments, so machine-generated lockfiles do not count
# against it — but only the lockfiles, and only because they are named.

on_branch lockfile-lines
add_lines web/package-lock.json 500
commit_all
check "a five-hundred-line lockfile change passes a ten-line limit" 0 run_guard 30 10
check "the lockfile does not count as a changed file either" 0 run_guard 0 10

on_branch nested-lockfile
mkdir -p web/vendor
add_lines pnpm-lock.yaml 500
commit_all
check "pnpm-lock.yaml is excluded too" 0 run_guard 30 10

# go.sum is deliberately NOT excluded: it stays small per change, and it is
# the file a substituted module hash would appear in.
on_branch gosum
add_lines engine/go.sum 20
commit_all
check "go.sum still counts against the limit" 1 run_guard 30 10

# The exclusion is by name, not by shape — a hand-written file that merely
# looks generated is still reviewed like code.
on_branch lookalike
add_lines web/package-lock.json.bak 500
commit_all
check "a file that only resembles a lockfile still counts" 1 run_guard 30 10

exit "$fail"
