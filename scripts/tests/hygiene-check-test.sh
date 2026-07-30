#!/usr/bin/env bash
# Tests for scripts/guards/hygiene-check.sh.
#
# The guard walks every tracked file and applies five rules. Its silent failure
# is the walk itself: a pathspec that lists nothing, or a per-file test that
# can never be true, produces the same output as a clean repository. So each
# rule gets a file that must be rejected, and each rule also gets the case that
# would tempt a sloppy pattern into a false positive — a Markdown rule of seven
# dashes is not a conflict marker, and a lockfile is allowed to be large.
#
# Run from anywhere inside the real repo:  scripts/tests/hygiene-check-test.sh
set -euo pipefail

guard="$(git rev-parse --show-toplevel)/scripts/guards/hygiene-check.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git init -q -b main "$work/repo"
cd "$work/repo"
git config user.name test
git config user.email test@test
printf 'clean\n' > README.md
git add -A
git commit -qm "chore: init"

fail=0
out=$work/out

# check NAME EXPECTED_EXIT [EXPECTED_TEXT] — runs the guard over the tracked
# tree, then restores it. Files must be staged: the guard reads git's index,
# not the directory, so an untracked file is deliberately invisible to it.
check() {
  local name=$1 expected=$2 wanted=${3:-} got=0
  git add -A
  MAX_FILE_BYTES=1024 "$guard" > "$out" 2>&1 || got=$?
  git reset -q
  git clean -qfd
  git checkout -q -- .
  if [ "$got" -ne "$expected" ]; then
    echo "FAIL: $name (expected exit $expected, got $got)"
    fail=1
    return
  fi
  if [ -n "$wanted" ] && ! grep -qF "$wanted" "$out"; then
    echo "FAIL: $name (output did not mention '$wanted')"
    fail=1
    return
  fi
  echo "ok: $name"
}

check "a clean tree passes" 0

# --- binary content ----------------------------------------------------------

printf 'text\000with a NUL\n' > blob.bin
check "a binary file is rejected" 1 "is binary"

# UTF-8 is text. The repository is full of em dashes, and a rule that called
# them binary would fail on almost every file it protects.
printf 'em dash — and a rocket \360\237\232\200\n' > unicode.md
check "a UTF-8 file is not mistaken for binary" 0

# --- size --------------------------------------------------------------------

head -c 2000 /dev/zero | tr '\0' 'x' > big.txt
printf '\n' >> big.txt
check "an oversized file is rejected" 1 "over the 1024 limit"

# Lockfiles are exempt: their size describes the dependency tree, and they are
# read by lockfile-lint and dep-scan rather than by a person.
head -c 2000 /dev/zero | tr '\0' 'x' > package-lock.json
printf '\n' >> package-lock.json
check "an oversized lockfile is allowed" 0

mkdir -p web
head -c 2000 /dev/zero | tr '\0' 'x' > web/package-lock.json
printf '\n' >> web/package-lock.json
check "the lockfile exemption applies in a subdirectory too" 0

# --- conflict markers --------------------------------------------------------

printf 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n' > conflicted.txt
check "merge conflict markers are rejected" 1 "merge conflict markers"

# A row of seven or more dashes or equals signs is ordinary Markdown, and a
# marker pattern loose enough to match it would fire on half the documentation.
printf 'Heading\n=======\n\nRule\n-------\n' > headings.md
check "a Markdown setext heading is not a conflict marker" 0

# --- line endings and termination --------------------------------------------

printf 'one\r\ntwo\r\n' > windows.txt
check "CRLF line endings are rejected" 1 "CRLF"

printf 'no newline at the end' > unterminated.txt
check "a missing final newline is rejected" 1 "does not end with a newline"

# An empty file has no last line to terminate; complaining about it would be
# noise, and .gitkeep-style placeholders are legitimate.
: > empty.txt
check "an empty file is accepted" 0

exit "$fail"
