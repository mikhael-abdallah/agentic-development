#!/usr/bin/env bash
# Local AI review loop (ROADMAP phase 5).
#
# Reviews this branch's diff against origin/main with a headless Claude and
# writes the findings to AI_REVIEW.md (gitignored). Exits non-zero unless the
# verdict is APPROVE, so it can gate a push: the coding agent reads the
# findings, fixes them, and reruns until the review is clean.
#
# Usage:  scripts/ai-review.sh          (or automatically via .githooks/pre-push)
# Bypass: SKIP_AI_REVIEW=1 git push    (emergencies only — the PR checks still run)
set -euo pipefail

BASE_REMOTE=origin
BASE_BRANCH=main
OUT=AI_REVIEW.md

if [ "${SKIP_AI_REVIEW:-0}" = "1" ]; then
  echo "ai-review: skipped (SKIP_AI_REVIEW=1)"
  exit 0
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "ai-review: 'claude' CLI not found in PATH" >&2
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "$BASE_BRANCH" ]; then
  echo "ai-review: on $BASE_BRANCH, nothing to review"
  exit 0
fi

git fetch -q "$BASE_REMOTE" "$BASE_BRANCH"
base=$(git merge-base "$BASE_REMOTE/$BASE_BRANCH" HEAD)

if git diff --quiet "$base" HEAD; then
  echo "ai-review: no changes vs $BASE_REMOTE/$BASE_BRANCH"
  exit 0
fi

commits=$(git log --format='%h %s' "$base"..HEAD)
diff=$(git diff "$base" HEAD)

prompt="You are a strict senior code reviewer for a repository where AI agents write all code and no human reviews it. Review the following branch diff.

Focus on: real bugs, security issues, error handling, edge cases, dead or duplicated code, misleading names/comments, missing tests for changed behavior, and violations of clean-code limits (long functions, deep nesting, too many parameters).

Do not comment on style that linters already enforce. Do not praise. Every finding must cite file and line, state the problem concretely, and say what to change.

Output GitHub-flavored markdown:
# AI Review
## Findings
(numbered list, most severe first; write 'None.' if the diff is clean)

The very last line of your reply must be exactly 'VERDICT: APPROVE' if there are no findings that require a change, or exactly 'VERDICT: REQUEST_CHANGES' otherwise.

Commits under review:
$commits

Diff:
\`\`\`diff
$diff
\`\`\`"

echo "ai-review: reviewing $branch against $BASE_REMOTE/$BASE_BRANCH..."
claude -p "$prompt" > "$OUT"

verdict=$(tail -n 1 "$OUT" | tr -d '[:space:]')
if [ "$verdict" = "VERDICT:APPROVE" ]; then
  echo "ai-review: APPROVE — see $OUT"
  exit 0
fi

echo "ai-review: changes requested — read $OUT, fix the findings, rerun." >&2
exit 1
