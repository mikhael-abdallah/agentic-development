#!/usr/bin/env bash
# Guard: Conventional Commit title. CI runs it on the PR title (which squash
# merge turns into the commit message); the pre-push hook runs it on each
# pushed commit subject.
set -euo pipefail

title="${1:?usage: pr-title.sh <title>}"

TYPES='feat|fix|docs|refactor|test|perf|ci|chore|build'
SCOPE='(\([a-z0-9./-]+\))?!?'

# Dependabot writes its own titles, and a grouped update names everything it
# touched: "chore(deps-dev): bump eslint from 9.39.5 to 10.7.0 in /web in the
# npm group across 1 directory" is 79 characters of description.
#
# The 72-character cap exists to keep hand-written subjects scannable in a log.
# Enforcing it against a machine-generated title we cannot shorten improves
# nothing and makes every dependency update permanently unmergeable — which
# switches off the update pipeline without ever reporting that it did. So the
# exemption is exactly as wide as the problem: the deps scopes, length only.
# Everything else about the format still has to hold.
if printf '%s' "$title" | grep -qE "^($TYPES)\((deps|deps-dev)\)!?: .+$"; then
  exit 0
fi

if ! printf '%s' "$title" | grep -qE "^($TYPES)$SCOPE: .{1,72}$"; then
  echo "guards: not a Conventional Commit title: '$title'" >&2
  echo "guards: expected e.g. 'feat(engine): add latency model'" >&2
  echo "guards: type is one of $TYPES, description 1-72 characters" >&2
  exit 1
fi
