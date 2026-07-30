#!/usr/bin/env bash
# Tests for scripts/guards/pr-title.sh.
#
# Squash merge turns the PR title into the commit message, so this guard writes
# the repository's history. It also has an exemption in it, and an exemption
# that is wider than intended is the quiet way a rule stops applying — hence
# the cases proving the deps scopes are excused length and nothing else.
#
# Run from anywhere inside the real repo:  scripts/tests/pr-title-test.sh
set -euo pipefail

guard="$(git rev-parse --show-toplevel)/scripts/guards/pr-title.sh"

fail=0
check() {
  local expected=$1 title=$2 got=0
  "$guard" "$title" >/dev/null 2>&1 || got=$?
  if [ "$got" -eq "$expected" ]; then
    echo "ok: [$expected] $title"
  else
    echo "FAIL: expected exit $expected, got $got — $title"
    fail=1
  fi
}

long=$(printf 'x%.0s' {1..80})

check 0 "feat: add a latency model"
check 0 "feat(engine): add a latency model"
check 0 "fix(web/canvas)!: drop the legacy node shape"
check 0 "ci: add the structure guard"

check 1 "update stuff"
check 1 "feat add a latency model"
check 1 "Feat: capitalised type"
check 1 "wip: not a conventional type"
check 1 "feat: "
check 1 "feat: $long"

# Dependabot's grouped titles run past 72 characters and cannot be shortened.
check 0 "chore(deps-dev): bump eslint from 9.39.5 to 10.7.0 in /web in the npm group across 1 directory"
check 0 "chore(deps): bump the gomod group in /engine with 3 updates"

# The exemption is length only, and only for those two scopes.
check 1 "chore(deps): "
check 1 "chore(tooling): $long"
check 1 "bump(deps): not a conventional type"

exit "$fail"
