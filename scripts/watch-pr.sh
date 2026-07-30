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

head_sha() { gh pr view "$pr" --json headRefOid --jq .headRefOid; }

# Watching is pinned to a commit. Right after a force-push, `gh pr checks` can
# still be reporting the *previous* run, and taking that green at face value
# would declare a commit healthy that nothing has actually tested yet. If the
# head moved while we were watching, watch again.
for _ in $(seq 1 5); do
  before=$(head_sha)

  # --fail-fast returns as soon as one check fails; exit 0 only if all pass.
  if ! gh pr checks "$pr" --watch --fail-fast --interval 20; then
    echo "CHECKS=RED"
    echo "PR${pr}=FAILED_CHECKS — fix these before anything else:"
    gh pr checks "$pr" | awk '$2 != "pass"'
    exit 1
  fi

  after=$(head_sha)
  if [ "$before" = "$after" ]; then
    echo "CHECKS=GREEN ($after)"
    break
  fi
  echo "watch-pr: head moved ${before:0:7} -> ${after:0:7}, re-watching"
done

# All checks green: auto-merge should fire. Give it a grace period and
# confirm, so a green-but-stuck PR is surfaced instead of assumed merged.
for _ in $(seq 1 20); do
  if [ "$(gh pr view "$pr" --json state --jq .state)" = MERGED ]; then
    echo "PR${pr}=MERGED"
    exit 0
  fi
  sleep 15
done

# Still open. Say which of the two usual causes it is, because they need
# different fixes and neither announces itself.
echo "PR${pr}=GREEN_BUT_NOT_MERGED — checks passed but the PR did not merge:"
if [ "$(gh pr view "$pr" --json autoMergeRequest --jq '.autoMergeRequest')" = null ]; then
  echo "  auto-merge is NOT enabled — run: gh pr merge $pr --auto --squash"
  echo "  (scripts/open-pr.sh does this for you; use it to open PRs)"
else
  echo "  auto-merge is enabled but the merge is blocked. State:" \
    "$(gh pr view "$pr" --json mergeStateStatus --jq .mergeStateStatus)"
  echo "  BEHIND means the branch needs a rebase onto main;"
  echo "  BLOCKED usually means a required check has not reported yet."
fi
exit 1
