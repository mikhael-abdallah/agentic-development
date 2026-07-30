#!/usr/bin/env bash
# Guard: Go tests (race + shuffle) and patch coverage >= 80% on changed lines.
# Coverage goes through Cobertura XML + diff-cover so the TypeScript gate
# (ROADMAP phase 3) can share the exact same patch-coverage mechanism.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh
# Nothing to do when the change cannot affect this gate.
guard_applies go-test "$GO_GUARD_SCOPE" || exit 0

# shellcheck disable=SC1091
. scripts/guards/go-env.sh
ensure_go

GOCOVER_COBERTURA_VERSION=v1.5.0
# DIFF_COVER_VERSION and PATCH_COVERAGE_MIN come from lib.sh: one definition
# for both languages, and not overridable from the environment — "ratchet,
# don't relax" has to be a property of the code, not of who runs it.

# Tolerant fetch, same as pr-guard: CI checkouts already have the base.
git fetch -q origin "${GITHUB_BASE_REF:-main}" 2>/dev/null || true
base_branch="origin/${GITHUB_BASE_REF:-main}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

go -C engine test -race -shuffle=on -coverprofile="$tmp/cover.out" ./...
go -C engine run "github.com/boumenot/gocover-cobertura@$GOCOVER_COBERTURA_VERSION" \
  < "$tmp/cover.out" > "$tmp/coverage.xml"

# Path drift between the report and diff-cover's git view would not fail
# this gate — it would silently disable it (no matching lines = vacuous
# pass). Pin the alignment: every file the report names must exist in the
# repo at the path diff-cover will resolve it to.
while IFS= read -r covered; do
  if [ ! -f "engine/$covered" ]; then
    echo "guards: coverage report names '$covered' but engine/$covered does not exist —" \
      "path drift would silently disable the patch-coverage gate" >&2
    exit 1
  fi
done < <(grep -o 'filename="[^"]*"' "$tmp/coverage.xml" | sed 's/^filename="//; s/"$//' | sort -u)

diff_cover=$(ensure_diff_cover "$DIFF_COVER_VERSION")

# gocover-cobertura writes module-relative paths; diff-cover diffs from the
# repo root, so it runs inside engine/ where the two views line up.
cd engine
"$diff_cover" "$tmp/coverage.xml" \
  --compare-branch "$base_branch" --fail-under "$PATCH_COVERAGE_MIN"
