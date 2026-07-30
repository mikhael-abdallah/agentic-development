#!/usr/bin/env bash
# Guard: web tests and patch coverage >= 80% on changed lines — the same
# Cobertura + diff-cover mechanism as the Go gate (go-test.sh).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh
# shellcheck disable=SC1091
. scripts/guards/web-env.sh
ensure_node
ensure_web_deps

# DIFF_COVER_VERSION and PATCH_COVERAGE_MIN come from lib.sh: one definition
# for both languages, and not overridable from the environment — "ratchet,
# don't relax" has to be a property of the code, not of who runs it.

# Tolerant fetch, same as size-guard: CI checkouts already have the base.
git fetch -q origin "${GITHUB_BASE_REF:-main}" 2>/dev/null || true
base_branch="origin/${GITHUB_BASE_REF:-main}"

cd web
npm run -s test:coverage

report=coverage/cobertura-coverage.xml
if [ ! -f "$report" ]; then
  echo "guards: vitest did not produce $report" >&2
  exit 1
fi

# Path drift between the report and diff-cover's git view would not fail
# this gate — it would silently disable it (no matching lines = vacuous
# pass). Pin the alignment: every file the report names must exist at the
# path diff-cover will resolve it to (relative to web/).
while IFS= read -r covered; do
  if [ ! -f "$covered" ]; then
    echo "guards: coverage report names '$covered' but web/$covered does not exist —" \
      "path drift would silently disable the patch-coverage gate" >&2
    exit 1
  fi
done < <(grep -o 'filename="[^"]*"' "$report" | sed 's/^filename="//; s/"$//' | sort -u)

# The report's paths are relative to web/, so diff-cover runs here too.
diff_cover=$(ensure_diff_cover "$DIFF_COVER_VERSION")
"$diff_cover" "$report" --compare-branch "$base_branch" \
  --fail-under "$PATCH_COVERAGE_MIN"
