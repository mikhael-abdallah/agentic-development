#!/usr/bin/env bash
# Tests for scripts/ai-review.sh: builds a throwaway git repo, stubs the
# claude CLI, and asserts the gate's exit codes for each verdict scenario.
# Run from anywhere inside the real repo:  scripts/tests/ai-review-test.sh
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Upstream with main, plus a clone holding a feature branch with changes.
git init -q -b main "$work/upstream"
git -C "$work/upstream" -c user.name=test -c user.email=test@test \
  commit -q --allow-empty -m "chore: init"
git clone -q "$work/upstream" "$work/repo"
cd "$work/repo"
git config user.name test
git config user.email test@test
cp -r "$repo_root/scripts" scripts
cp -r "$repo_root/.githooks" .githooks
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

exit "$fail"
