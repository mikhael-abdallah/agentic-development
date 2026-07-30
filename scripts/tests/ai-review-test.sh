#!/usr/bin/env bash
# Tests for scripts/ai-review.sh: builds a throwaway git repo, stubs the
# claude CLI, and asserts the gate's exit codes for each verdict scenario.
# Run from anywhere inside the real repo:  scripts/tests/ai-review-test.sh
set -euo pipefail

# The suite asserts exit codes, and both bypass flags force those to 0. An
# inherited flag would therefore turn most of these assertions green without
# testing anything — and the suite runs from the pre-push hook, where a
# developer may well have set one. Each case that needs a bypass sets it
# itself, so start from a known-clean environment.
unset SKIP_AI_REVIEW SKIP_GUARDS

repo_root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Upstream with main, plus a clone holding a feature branch with changes.
#
# The tooling under test is committed to main *before* the clone, so the
# feature branch's diff is one small file. An earlier version copied it into
# the clone instead, which left every byte of scripts/ inside the reviewed
# diff — and the suite began failing the day the real scripts/ grew past the
# reviewer's 100 kB budget, for a reason that had nothing to do with the
# review gate it is testing.
git init -q -b main "$work/upstream"
cp -r "$repo_root/scripts" "$work/upstream/scripts"
cp -r "$repo_root/.githooks" "$work/upstream/.githooks"
git -C "$work/upstream" add -A
git -C "$work/upstream" -c user.name=test -c user.email=test@test \
  commit -qm "chore: init"
git clone -q "$work/upstream" "$work/repo"
cd "$work/repo"
git config user.name test
git config user.email test@test
git checkout -q -b feature
echo "some change" > file.txt
git add . && git commit -qm "feat: change"
feature_sha=$(git rev-parse HEAD)
zero_sha=$(printf '0%.0s' {1..40})

# claude stub: swallows stdin, prints $STUB_OUTPUT (\n-interpreted).
mkdir "$work/bin"
cat > "$work/bin/claude" <<'STUB'
#!/usr/bin/env bash
cat > /dev/null
printf '%b\n' "$STUB_OUTPUT"
STUB
chmod +x "$work/bin/claude"
export PATH="$work/bin:$PATH"

fail=0
check() {
  local name=$1 expected=$2
  shift 2
  local got=0
  "$@" scripts/ai-review.sh >/dev/null 2>&1 || got=$?
  if [ "$got" -eq "$expected" ]; then
    echo "ok: $name"
  else
    echo "FAIL: $name (expected exit $expected, got $got)"
    fail=1
  fi
}

check "approve exits 0" 0 \
  env STUB_OUTPUT='# AI Review\n## Findings\nNone.\n\nVERDICT: APPROVE'
check "trailing blank lines still approve" 0 \
  env STUB_OUTPUT='# AI Review\n## Findings\nNone.\n\nVERDICT: APPROVE\n\n\n'
check "request-changes exits 1" 1 \
  env STUB_OUTPUT='# AI Review\n## Findings\n1. bug\n\nVERDICT: REQUEST_CHANGES'
check "missing verdict exits 1" 1 \
  env STUB_OUTPUT='reviewer rambled with no verdict'
check "empty output exits 1" 1 \
  env STUB_OUTPUT=''
check "mid-file verdict does not count" 1 \
  env STUB_OUTPUT='quoting: VERDICT: APPROVE\n\nmore text afterwards'
check "oversized diff exits 1" 1 \
  env AI_REVIEW_MAX_DIFF_BYTES=1 STUB_OUTPUT='VERDICT: APPROVE'
check "skip flag exits 0 without reviewing" 0 \
  env SKIP_AI_REVIEW=1 STUB_OUTPUT='VERDICT: REQUEST_CHANGES'

# Orphan branch: no merge base with main must fail with exit 1, not review.
git checkout -q --orphan orphan
git add . && git commit -qm "chore: orphan"
check "no merge base exits 1" 1 \
  env STUB_OUTPUT='VERDICT: APPROVE'
git checkout -q feature

# pre-push hook: reviews pushed branch shas, skips deletions and non-branches.
# Real guards run linters and download tools — out of scope here, so skip
# them; the guard→hook wiring is tested below with a stub.
export SKIP_GUARDS=1
hook() {
  local stdin_line=$1
  shift
  printf '%s\n' "$stdin_line" | env "$@" .githooks/pre-push
}
check_hook() {
  local name=$1 expected=$2
  shift 2
  local got=0
  hook "$@" >/dev/null 2>&1 || got=$?
  if [ "$got" -eq "$expected" ]; then
    echo "ok: $name"
  else
    echo "FAIL: $name (expected exit $expected, got $got)"
    fail=1
  fi
}

check_hook "hook reviews pushed branch (approve)" 0 \
  "refs/heads/feature $feature_sha refs/heads/feature $zero_sha" \
  STUB_OUTPUT='VERDICT: APPROVE'
check_hook "hook blocks pushed branch (request-changes)" 1 \
  "refs/heads/feature $feature_sha refs/heads/feature $zero_sha" \
  STUB_OUTPUT='VERDICT: REQUEST_CHANGES'
check_hook "hook skips branch deletion" 0 \
  "refs/heads/feature $zero_sha refs/heads/feature $feature_sha" \
  STUB_OUTPUT='VERDICT: REQUEST_CHANGES'
check_hook "hook skips tags" 0 \
  "refs/tags/v1 $feature_sha refs/tags/v1 $zero_sha" \
  STUB_OUTPUT='VERDICT: REQUEST_CHANGES'

# Guard wiring: the hook must run local-guards before the review and stop on
# failure. Stub the guards (the real ones are exercised by CI and real pushes).
cat > scripts/local-guards.sh <<'GUARD_STUB'
#!/usr/bin/env bash
exit "${GUARD_EXIT:-0}"
GUARD_STUB
chmod +x scripts/local-guards.sh
check_hook "hook blocks push when guards fail" 1 \
  "refs/heads/feature $feature_sha refs/heads/feature $zero_sha" \
  GUARD_EXIT=1 STUB_OUTPUT='VERDICT: APPROVE'
check_hook "hook pushes when guards and review pass" 0 \
  "refs/heads/feature $feature_sha refs/heads/feature $zero_sha" \
  GUARD_EXIT=0 STUB_OUTPUT='VERDICT: APPROVE'

exit "$fail"
