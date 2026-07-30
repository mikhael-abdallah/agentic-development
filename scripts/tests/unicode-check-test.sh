#!/usr/bin/env bash
# Tests for scripts/guards/unicode-check.sh.
#
# The characters this guard looks for are invisible, so a broken version of it
# looks exactly like a working one: both print nothing and exit 0. Every range
# therefore gets a case, and legitimate non-ASCII text gets one too — a guard
# that rejected emoji or accents would be quietly turned off within a week.
#
# Run from anywhere inside the real repo:  scripts/tests/unicode-check-test.sh
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git init -q -b main "$work/repo"
cd "$work/repo"
git config user.name test
git config user.email test@test
mkdir -p scripts/guards
cp "$repo_root/scripts/guards/unicode-check.sh" scripts/guards/
printf 'plain ascii\n' > README.md
git add -A
git commit -qm "chore: init"

fail=0
# expect NAME EXPECTED_EXIT PYTHON_STRING — writes the string to a tracked
# file and runs the guard. The payloads are built from escapes so this file
# stays free of the characters it is testing for.
expect() {
  local name=$1 expected=$2 payload=$3 got=0
  python3 -c "import sys; sys.stdout.write($payload)" > probe.md
  git add probe.md
  scripts/guards/unicode-check.sh >/dev/null 2>&1 || got=$?
  if [ "$got" -eq "$expected" ]; then
    echo "ok: $name"
  else
    echo "FAIL: $name (expected exit $expected, got $got)"
    fail=1
  fi
  git rm -q --cached probe.md
  rm -f probe.md
}

expect "plain text passes" 0 "'nothing to see here\n'"
expect "rejects a zero-width space" 1 "'looks harmless\u200bhidden\n'"
expect "rejects a right-to-left mark" 1 "'text\u200fmore\n'"
expect "rejects a bidi override (Trojan Source)" 1 "'return\u202e // safe\n'"
expect "rejects a bidi isolate" 1 "'a\u2066b\u2069c\n'"
expect "rejects a word joiner" 1 "'a\u2060b\n'"
expect "rejects a byte-order mark mid-file" 1 "'line one\nline\ufefftwo\n'"
expect "rejects Unicode tag characters" 1 "'harmless\U000e0041\U000e0042\n'"

# Legitimate non-ASCII must keep working, or the guard gets disabled instead
# of obeyed.
expect "accepts accented latin" 0 "'café até você\n'"
expect "accepts emoji" 0 "'ship it \U0001f680\n'"
expect "accepts non-latin scripts" 0 "'日本語 中文 Ελληνικά\n'"
expect "accepts an em dash and typographic quotes" 0 "'a \u2014 \u201cb\u201d\n'"

exit "$fail"
