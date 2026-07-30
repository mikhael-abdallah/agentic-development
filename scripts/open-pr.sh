#!/usr/bin/env bash
# Open a pull request the way this repository requires: create it, turn on
# auto-merge, then watch its checks through to a conclusion.
#
# `gh pr create` does not enable auto-merge — the repository setting only
# *permits* it, and each PR has to opt in. A PR opened without
# `gh pr merge --auto` sits green and unmerged indefinitely, which looks
# exactly like "still running" unless somebody thinks to check. That has
# happened; this script exists so the step cannot be skipped again.
#
# Usage: scripts/open-pr.sh --title "<conventional commit title>" \
#                           --body-file <path> [more gh pr create args...]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ "$#" -eq 0 ]; then
  echo "usage: open-pr.sh --title \"<title>\" --body-file <path> [gh args...]" >&2
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = main ]; then
  echo "open-pr: refusing to open a pull request from main" >&2
  exit 1
fi

# A no-op when the branch is already pushed: git skips the pre-push hook when
# there is nothing to send, so this does not re-run the guards or the review.
git push -q -u origin "$branch"

pr=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number')
if [ -n "$pr" ]; then
  echo "open-pr: reusing open PR #$pr for $branch"
else
  pr=$(gh pr create "$@" | tail -1)
  pr=${pr##*/}
  echo "open-pr: created PR #$pr"
fi

# Squash-only, matching the ruleset: the PR title becomes the commit message.
gh pr merge "$pr" --auto --squash
echo "open-pr: auto-merge enabled on PR #$pr"

exec scripts/watch-pr.sh "$pr"
