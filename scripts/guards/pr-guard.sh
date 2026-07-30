#!/usr/bin/env bash
# Guard: small increments — the change set against the base branch stays
# within the PR size limits.
# Usage: pr-guard.sh [ref]   (default HEAD)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MAX_CHANGED_LINES="${MAX_CHANGED_LINES:-1000}"
MAX_CHANGED_FILES="${MAX_CHANGED_FILES:-30}"
ref="${1:-HEAD}"
base_branch="origin/${GITHUB_BASE_REF:-main}"

# Refresh the base ref when possible; tolerate failure (CI checks out with
# fetch-depth 0, and offline local runs can still use the last-known ref).
git fetch -q origin "${GITHUB_BASE_REF:-main}" 2>/dev/null || true

# Machine-generated lockfiles don't count against the budget — a one-line
# dependency change can regenerate thousands of lock lines, and the limit
# is about reviewable increments, not generated noise. Everything else
# (including go.sum, which stays small per change) still counts.
exclude=(
  ':(glob,exclude)**/package-lock.json'
  ':(glob,exclude)**/npm-shrinkwrap.json'
  ':(glob,exclude)**/yarn.lock'
  ':(glob,exclude)**/pnpm-lock.yaml'
)

base=$(git merge-base "$base_branch" "$ref")
files=$(git diff --name-only "$base" "$ref" -- . "${exclude[@]}" | wc -l)
lines=$(git diff --numstat "$base" "$ref" -- . "${exclude[@]}" | awk '{ added += $1; deleted += $2 } END { print added + deleted }')
echo "Changed files: $files (max $MAX_CHANGED_FILES)"
echo "Changed lines: $lines (max $MAX_CHANGED_LINES)"
if [ "$files" -gt "$MAX_CHANGED_FILES" ] || [ "$lines" -gt "$MAX_CHANGED_LINES" ]; then
  echo "guards: change set too large — split it into smaller increments" >&2
  exit 1
fi
