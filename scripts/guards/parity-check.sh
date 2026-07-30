#!/usr/bin/env bash
# Meta-guard: the CI workflow really is a thin wrapper around scripts/guards/.
#
# Two things have to hold, and neither is visible from a green check:
#
#  1. Every job in .github/workflows/guardrails.yml must appear as
#     `run "<job>"` in scripts/local-guards.sh — a real local mirror when
#     possible, otherwise a pass-through that prints why the guard can only
#     run in CI (see scripts/guards/dependency-review.sh).
#
#  2. Every job must actually invoke its own scripts/guards/<job>.sh. Job
#     names are what the branch ruleset requires, so a change that keeps the
#     name and replaces the body — `run: true`, a different script, a step
#     that got deleted — satisfies every required check while enforcing
#     nothing. Checking the name alone cannot see that.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

workflow=.github/workflows/guardrails.yml

# Jobs whose body is legitimately not a guard script. Each needs a reason,
# for the same purpose as a nolint comment: the exception is reviewable.
declare -A NOT_A_SCRIPT=(
  [dependency-review]="runs actions/dependency-review-action, which needs the GitHub API's view of the PR rather than the checkout"
)

# Job keys are two-space indented; tolerate a trailing comment, which would
# otherwise make a job invisible to this guard.
jobs=$(awk '
  /^jobs:/ { injobs = 1; next }
  injobs && /^[^ #]/ { exit }
  injobs && match($0, /^  [A-Za-z0-9_-]+:[ \t]*(#.*)?$/) {
    sub(/:.*$/, "", $0); sub(/^ +/, "", $0); print
  }
' "$workflow")

if [ -z "$jobs" ]; then
  echo "guards: parity-check could not parse any jobs from $workflow" >&2
  exit 1
fi

# job_body NAME — the lines of a job, up to the next job key.
job_body() {
  awk -v job="$1" '
    $0 ~ "^  " job ":[ \t]*(#.*)?$" { inblock = 1; next }
    inblock && /^  [A-Za-z0-9_-]+:/ { exit }
    inblock { print }
  ' "$workflow"
}

fail=0
count=0
while IFS= read -r job; do
  count=$((count + 1))

  if ! grep -qE "^run \"$job\"" scripts/local-guards.sh; then
    echo "guards: CI job '$job' has no local counterpart in scripts/local-guards.sh" >&2
    echo "guards:   mirror it with a scripts/guards/ script, or add a justified" \
      "pass-through (see scripts/guards/dependency-review.sh)" >&2
    fail=1
  fi

  if [ -n "${NOT_A_SCRIPT[$job]:-}" ]; then
    continue
  fi
  # A guard that scopes itself by diff needs the base branch to compare
  # against, and actions/checkout is shallow by default. Without full history
  # it fails open and does the expensive work on every PR — safe, but the
  # optimisation is silently gone and nothing reports it.
  if grep -qE '^guard_applies ' "scripts/guards/$job.sh" 2>/dev/null &&
    ! job_body "$job" | grep -q 'fetch-depth: 0'; then
    echo "guards: job '$job' runs a scoped guard but checks out shallowly" >&2
    echo "guards:   add 'fetch-depth: 0', or the scope check has no base to" \
      "compare against and quietly stops skipping anything" >&2
    fail=1
  fi

  if ! job_body "$job" | grep -qF "scripts/guards/$job.sh"; then
    echo "guards: CI job '$job' does not run scripts/guards/$job.sh" >&2
    echo "guards:   the job name is what the ruleset requires, so a job that keeps" \
      "its name but not its guard passes every check while enforcing nothing" >&2
    fail=1
  fi
done <<< "$jobs"

# The PR title becomes the squash commit message, and GitHub does not re-run
# checks on a rename unless `edited` is among the triggers — so without it the
# title gate is bypassed by opening with a good title and renaming afterwards.
if ! awk '/^on:/ { in_on = 1; next } /^[^ #]/ { in_on = 0 } in_on' "$workflow" |
  grep -q 'edited'; then
  echo "guards: the pull_request trigger must include 'edited'," \
    "or the PR title can be changed after pr-title has passed" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "guards: all $count CI guard jobs run their own guard and have local counterparts"
