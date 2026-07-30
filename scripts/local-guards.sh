#!/usr/bin/env bash
# Local mirror of the CI guards (.github/workflows/guardrails.yml). The
# pre-push hook runs this before the AI review, so a push that CI would
# reject anyway never spends reviewer tokens or runner cycles — the PR
# checks stay on as the backstop.
#
# Every CI guard job appears below (parity-check enforces it). Two are not
# 1:1 mirrors: dependency-review is a justified pass-through (needs the
# GitHub API's view of the PR), and pr-title checks commit subjects instead
# (the PR title doesn't exist before the PR — a subject usually becomes it).
#
# Usage:  scripts/local-guards.sh [ref]   (default HEAD; .githooks/pre-push
#                                          passes each pushed branch sha)
# Bypass: SKIP_GUARDS=1 git push   (emergencies only — CI still runs them)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ "${SKIP_GUARDS:-0}" = "1" ]; then
  echo "local-guards: skipped (SKIP_GUARDS=1)"
  exit 0
fi

ref="${1:-HEAD}"
failed=()

run() {
  local name=$1
  shift
  echo "── local-guards: $name"
  if ! "$@"; then
    failed+=("$name")
  fi
}

# Stricter than CI on purpose: CI checks only the PR title, this checks every
# pushed commit subject — keep even intermediate commits conventional.
check_commit_titles() {
  if ! git fetch -q origin main; then
    echo "guards: cannot fetch origin/main (offline?)" >&2
    return 1
  fi
  local base bad=0
  base=$(git merge-base origin/main "$ref")
  while IFS= read -r subject; do
    [ -n "$subject" ] || continue
    scripts/guards/pr-title.sh "$subject" || bad=1
  done < <(git log --format='%s' "$base".."$ref")
  return "$bad"
}

# Guard names match the CI job names in guardrails.yml: parity-check fails
# if a CI job has no `run "<job>"` line here — a real mirror when possible,
# otherwise a pass-through that prints its justification (dependency-review).
# Cheap and specific first, npx-based last.
run "parity-check" scripts/guards/parity-check.sh
run "structure-check" scripts/guards/structure-check.sh
run "unicode-check" scripts/guards/unicode-check.sh
run "ratchet-check" scripts/guards/ratchet-check.sh
run "hygiene-check" scripts/guards/hygiene-check.sh
run "pr-title" check_commit_titles
run "pr-guard" scripts/guards/pr-guard.sh "$ref"
run "workflow-lint" scripts/guards/workflow-lint.sh
run "shell-lint" scripts/guards/shell-lint.sh
run "secret-scan" scripts/guards/secret-scan.sh
run "workflow-security" scripts/guards/workflow-security.sh
run "dup-check" scripts/guards/dup-check.sh
run "go-lint" scripts/guards/go-lint.sh
run "go-test" scripts/guards/go-test.sh
run "go-vuln" scripts/guards/go-vuln.sh
run "web-lint" scripts/guards/web-lint.sh
run "web-test" scripts/guards/web-test.sh
run "web-build" scripts/guards/web-build.sh
run "dep-scan" scripts/guards/dep-scan.sh
run "dependency-review" scripts/guards/dependency-review.sh

if [ "${#failed[@]}" -gt 0 ]; then
  echo "local-guards: FAILED — ${failed[*]}" >&2
  exit 1
fi
echo "local-guards: all guards passed"
