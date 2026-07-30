#!/usr/bin/env bash
# Meta-guard: every CI guard must have a local counterpart. Each job in
# .github/workflows/guardrails.yml must appear as `run "<job>"` in
# scripts/local-guards.sh — a real local mirror when possible, otherwise a
# pass-through script that prints why the guard can only run in CI
# (see scripts/guards/dependency-review.sh). Keeps CI and pre-push in sync.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

jobs=$(awk '
  /^jobs:/ { injobs = 1; next }
  injobs && /^[^ #]/ { exit }
  injobs && /^  [A-Za-z0-9_-]+:[ ]*$/ { gsub(/[: ]/, ""); print }
' .github/workflows/guardrails.yml)

if [ -z "$jobs" ]; then
  echo "guards: parity-check could not parse any jobs from guardrails.yml" >&2
  exit 1
fi

missing=0
while IFS= read -r job; do
  if ! grep -qE "^run \"$job\"" scripts/local-guards.sh; then
    echo "guards: CI job '$job' has no local counterpart in scripts/local-guards.sh" >&2
    missing=1
  fi
done <<< "$jobs"

if [ "$missing" -ne 0 ]; then
  echo "guards: mirror the job with a scripts/guards/ script, or add a justified pass-through (see scripts/guards/dependency-review.sh)" >&2
  exit 1
fi
echo "guards: all $(wc -l <<< "$jobs") CI guard jobs have local counterparts"
