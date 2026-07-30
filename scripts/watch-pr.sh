#!/usr/bin/env bash
# Watch a PR's checks to their CONCLUSIONS and report loudly.
#
# Auto-merge leaves a PR silently OPEN forever when any check fails, so
# watching merge state ("did it leave OPEN?") is a bug: it never fires on
# red. This script is the only sanctioned way for agents to wait on a PR.
# It exits non-zero the moment a check fails and prints the failing jobs,
# so the failure lands in the agent's transcript instead of rotting.
#
# Usage: scripts/watch-pr.sh <pr-number>
set -euo pipefail

pr="${1:?usage: watch-pr.sh <pr-number>}"

# --fail-fast returns as soon as one check fails; exit 0 only if all pass.
if gh pr checks "$pr" --watch --fail-fast --interval 20; then
  echo "CHECKS=GREEN"
else
  echo "CHECKS=RED"
  echo "PR${pr}=FAILED_CHECKS — fix these before anything else:"
  gh pr checks "$pr" | awk '$2 != "pass"'
  exit 1
fi

# All checks green: auto-merge should fire. Give it a grace period and
# confirm, so a green-but-stuck PR (branch behind, ruleset change) is
# also surfaced instead of assumed merged.
for _ in $(seq 1 20); do
  state="$(gh pr view "$pr" --json state --jq .state)"
  if [ "$state" = "MERGED" ]; then
    echo "PR${pr}=MERGED"
    exit 0
  fi
  sleep 15
done

echo "PR${pr}=GREEN_BUT_NOT_MERGED — checks passed but auto-merge did not fire (branch behind? ruleset?)"
exit 1
