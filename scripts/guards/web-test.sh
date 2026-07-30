#!/usr/bin/env bash
# Guard: web tests and patch coverage >= 80% on changed lines — the same
# Cobertura + diff-cover mechanism as the Go gate (go-test.sh).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh
# Nothing to do when the change cannot affect this gate.
guard_applies web-test "$WEB_GUARD_SCOPE" || exit 0

# shellcheck disable=SC1091
. scripts/guards/web-env.sh
ensure_node
ensure_web_deps

# DIFF_COVER_VERSION and PATCH_COVERAGE_MIN come from lib.sh: one definition
# for both languages, and not overridable from the environment — "ratchet,
# don't relax" has to be a property of the code, not of who runs it.

# Tolerant fetch, same as pr-guard: CI checkouts already have the base.
git fetch -q origin "${GITHUB_BASE_REF:-main}" 2>/dev/null || true
base_branch="origin/${GITHUB_BASE_REF:-main}"

cd web
npm run -s test:coverage

report=coverage/cobertura-coverage.xml
# vitest writes paths relative to web/, which is the directory this runs in.
assert_coverage_paths "$report" .

# The report's paths are relative to web/, so diff-cover runs here too.
diff_cover=$(ensure_diff_cover "$DIFF_COVER_VERSION")
"$diff_cover" "$report" --compare-branch "$base_branch" \
  --fail-under "$PATCH_COVERAGE_MIN"
