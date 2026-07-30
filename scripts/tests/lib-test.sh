#!/usr/bin/env bash
# Tests for the shared guard helpers in scripts/guards/lib.sh: the changed-path
# scoping that lets a front-end PR skip the Go gates, and the checksum helper
# every pinned tool download rides on.
#
# These two are worth testing precisely because their failure mode is a silent
# pass: a scope check that always returns "skip" disables a gate without ever
# going red, and a checksum helper that always returns 0 accepts any binary.
# Run from anywhere inside the real repo:  scripts/tests/lib-test.sh
set -euo pipefail

# The scope cases below assume the throwaway repo's own base branch. CI sets
# GITHUB_BASE_REF for pull requests, so clear it rather than let the ambient
# environment decide what these assertions compare against.
unset GITHUB_BASE_REF

repo_root=$(git rev-parse --show-toplevel)
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

# shellcheck disable=SC1091 # resolved at run time from the repo root
. "$repo_root/scripts/guards/lib.sh"

# --- verify_sha256 -----------------------------------------------------------

printf 'hello\n' > "$work/payload"
hello_sha=5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03
check "verify_sha256 accepts a matching hash" 0 \
  verify_sha256 "$work/payload" "$hello_sha" payload
check "verify_sha256 rejects a mismatched hash" 1 \
  verify_sha256 "$work/payload" "${hello_sha//5/6}" payload

# --- guard_applies -----------------------------------------------------------

git init -q -b main "$work/upstream"
(
  cd "$work/upstream"
  git config user.name test
  git config user.email test@test
  mkdir -p engine web scripts
  echo x > engine/seed.go
  echo x > web/seed.ts
  echo x > scripts/seed.sh
  echo x > README.md
  git add -A
  git commit -qm "chore: init"
)
git clone -q "$work/upstream" "$work/repo"
cd "$work/repo"
git config user.name test
git config user.email test@test

# on_branch NAME FILE — a branch whose only change touches FILE.
on_branch() {
  git checkout -q main
  git checkout -q -B "$1" main
  echo "change" >> "$2"
  git add -A
  git commit -qm "feat: touch $2"
}

on_branch web-only web/seed.ts
check "web change runs the web gate" 0 guard_applies web-lint "$WEB_GUARD_SCOPE"
check "web change skips the go gate" 1 guard_applies go-lint "$GO_GUARD_SCOPE"

on_branch engine-only engine/seed.go
check "engine change runs the go gate" 0 guard_applies go-lint "$GO_GUARD_SCOPE"
check "engine change skips the web gate" 1 guard_applies web-lint "$WEB_GUARD_SCOPE"

on_branch docs-only README.md
check "docs change skips the go gate" 1 guard_applies go-lint "$GO_GUARD_SCOPE"
check "docs change skips the web gate" 1 guard_applies web-lint "$WEB_GUARD_SCOPE"

# Guard plumbing is in both scopes: change how a gate runs and every gate runs.
on_branch guard-change scripts/seed.sh
check "guard change runs the go gate" 0 guard_applies go-lint "$GO_GUARD_SCOPE"
check "guard change runs the web gate" 0 guard_applies web-lint "$WEB_GUARD_SCOPE"

# An uncommitted or brand-new file counts, so a local pre-push run sees the
# same scope the eventual PR will.
git checkout -q -B dirty main
echo "uncommitted" >> web/seed.ts
check "uncommitted web change runs the web gate" 0 \
  guard_applies web-lint "$WEB_GUARD_SCOPE"
git checkout -q -- web/seed.ts
echo x > web/untracked.ts
check "untracked web file runs the web gate" 0 \
  guard_applies web-lint "$WEB_GUARD_SCOPE"
rm web/untracked.ts

# Fail open: a scope decision may only be made from a diff we could read.
git checkout -q main
check "no changes at all runs the gate" 0 guard_applies go-lint "$GO_GUARD_SCOPE"
# `env` cannot invoke a shell function, so set the variable for the call here.
# shellcheck disable=SC2329 # invoked indirectly, as an argument to check()
with_base() {
  local base=$1
  shift
  GITHUB_BASE_REF="$base" "$@"
}
check "unresolvable base ref runs the gate" 0 \
  with_base does-not-exist guard_applies go-lint "$GO_GUARD_SCOPE"

git checkout -q --orphan orphan
git rm -rqf .
echo x > README.md
git add -A
git commit -qm "chore: orphan"
check "no merge base runs the gate" 0 guard_applies go-lint "$GO_GUARD_SCOPE"

exit "$fail"
