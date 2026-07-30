#!/usr/bin/env bash
# Guard: Conventional Commit title. CI runs it on the PR title (which squash
# merge turns into the commit message); the pre-push hook runs it on each
# pushed commit subject.
set -euo pipefail

title="${1:?usage: pr-title.sh <title>}"
if ! printf '%s' "$title" | grep -qE '^(feat|fix|docs|refactor|test|perf|ci|chore|build)(\([a-z0-9./-]+\))?!?: .{1,72}$'; then
  echo "guards: not a Conventional Commit title: '$title'" >&2
  echo "guards: expected e.g. 'feat(engine): add latency model'" >&2
  exit 1
fi
