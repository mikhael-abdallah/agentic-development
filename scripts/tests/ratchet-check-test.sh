#!/usr/bin/env bash
# Tests for scripts/guards/ratchet-check.sh — the guard that stops the other
# guards being quietly loosened.
#
# Its own failure mode is the one it exists to prevent. An extractor whose
# pattern goes stale reads nothing, the setting drops out of the comparison,
# and the guard reports success over a limit nobody is watching any more. So
# every case here changes one setting in a fixture repository and requires the
# guard to notice — including the cases where the change is an improvement,
# because an unrecorded improvement can be undone tomorrow.
#
# Run from anywhere inside the real repo:  scripts/tests/ratchet-check-test.sh
set -euo pipefail

guard="$(git rev-parse --show-toplevel)/scripts/guards/ratchet-check.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git init -q -b main "$work/repo"
cd "$work/repo"
git config user.name test
git config user.email test@test
mkdir -p engine web scripts/guards scripts/tests .github/workflows

cp "$guard" scripts/guards/ratchet-check.sh

cat > engine/.golangci.yml <<'YAML'
version: "2"

linters:
  default: standard
  enable:
    - bodyclose
    - cyclop
    - gosec
  settings:
    cyclop:
      max-complexity: 12
    funlen:
      lines: 80
      statements: 50
    gocognit:
      min-complexity: 20
    nestif:
      min-complexity: 4
    depguard:
      rules:
        boundary-one:
          list-mode: lax
    staticcheck:
      checks: ["all", "-ST1000", "-ST1020"]
    revive:
      rules:
        - name: argument-limit
          arguments: [4]
        - name: file-length-limit
          arguments:
            - max: 600
  exclusions:
    rules:
      - path: _test\.go
        linters: [funlen]

formatters:
  enable:
    - gofumpt
YAML

cat > web/eslint.config.mjs <<'MJS'
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

const BOUNDARIES = [
  {
    group: ["@/app", "@/app/*"],
    message: "app/ holds routes; nothing may import from it.",
  },
];

export default tseslint.config(
  {
    rules: {
      complexity: ["error", 12],
      "max-depth": ["error", 4],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      "max-nested-callbacks": ["error", 3],
      "max-params": ["error", 4],
      "sonarjs/cognitive-complexity": ["error", 15],
    },
  },
  {
    files: ["**/*.test.*"],
    rules: { "max-lines": "off" },
  },
);
MJS

printf 'PATCH_COVERAGE_MIN=80\n' > scripts/guards/lib.sh
# A quoted heredoc, so the fixture keeps the real guard's shape: the limits
# are written as defaults for an environment override, and the extractor has
# to read the number out of that rather than off a bare assignment.
cat > scripts/guards/pr-guard.sh <<'SH'
MAX_CHANGED_LINES="${MAX_CHANGED_LINES:-1000}"
MAX_CHANGED_FILES="${MAX_CHANGED_FILES:-30}"
SH
cat > scripts/guards/hygiene-check.sh <<'SH'
MAX_BYTES="${MAX_FILE_BYTES:-262144}"
SH
printf 'npx --yes jscpd@5.0.14 --threshold 2 --min-tokens 50 .\n' > scripts/guards/dup-check.sh
printf 'const BUDGET_BYTES = 250_000;\n' > scripts/guards/bundle-budget.mjs
printf '[[IgnoredVulns]]\nid = "GHSA-test"\n' > osv-scanner.toml
printf '#!/usr/bin/env bash\ntrue\n' > scripts/tests/alpha-test.sh
cat > .github/workflows/guardrails.yml <<'YAML'
name: guardrails
jobs:
  alpha:
    steps:
      - run: scripts/guards/alpha.sh
  beta:
    steps:
      - run: scripts/guards/beta.sh
YAML

# The baseline the fixture is meant to match, written out the way the guard
# itself reports it so the two cannot drift.
cat > scripts/guards/ratchet.baseline <<'BASE'
bundle-budget.bytes 250000
coverage.patch-min 80
dup-check.min-tokens 50
dup-check.threshold 2
eslint.complexity 12
eslint.max-depth 4
eslint.max-lines 400
eslint.max-lines-per-function 60
eslint.max-nested-callbacks 3
eslint.max-params 4
eslint.plugins 2
eslint.restricted-import-patterns 1
eslint.rules-disabled 1
eslint.sonarjs-cognitive-complexity 15
golangci.cyclop.max-complexity 12
golangci.depguard.rules 1
golangci.exclusions 1
golangci.funlen.lines 80
golangci.funlen.statements 50
golangci.gocognit.min-complexity 20
golangci.linters.enabled 3
golangci.nestif.min-complexity 4
golangci.revive.argument-limit 4
golangci.revive.file-length-limit 600
golangci.staticcheck.exclusions 2
guards.ci-jobs 2
guards.scripts 5
hygiene-check.max-bytes 262144
guards.test-suites 1
pr-guard.max-changed-files 30
pr-guard.max-changed-lines 1000
suppress.eslint-disable 0
suppress.nolint 0
suppress.allow-ghsas 0
suppress.osv-ignored 1
suppress.shellcheck-disable 0
suppress.test-skip 0
suppress.ts-expect-error 0
BASE

git add -A
git commit -qm "chore: fixture"

fail=0
out=$work/out

# check NAME EXPECTED_EXIT [EXPECTED_TEXT] — runs the guard against whatever
# the working tree currently says, then restores the fixture.
check() {
  local name=$1 expected=$2 wanted=${3:-} got=0
  scripts/guards/ratchet-check.sh > "$out" 2>&1 || got=$?
  git checkout -q -- .
  if [ "$got" -ne "$expected" ]; then
    echo "FAIL: $name (expected exit $expected, got $got)"
    fail=1
    return
  fi
  if [ -n "$wanted" ] && ! grep -qF "$wanted" "$out"; then
    echo "FAIL: $name (output did not mention '$wanted')"
    fail=1
    return
  fi
  echo "ok: $name"
}

check "the fixture matches its own baseline" 0

# --- a limit moved -----------------------------------------------------------

sed -i 's/lines: 80/lines: 200/' engine/.golangci.yml
check "a raised funlen limit is reported as relaxed" 1 "golangci.funlen.lines was RELAXED"

# The other direction still fails: an improvement nobody recorded is an
# improvement that can be reversed without trace.
sed -i 's/lines: 80/lines: 40/' engine/.golangci.yml
check "a lowered funlen limit must be recorded" 1 "golangci.funlen.lines was tightened"

sed -i 's/PATCH_COVERAGE_MIN=80/PATCH_COVERAGE_MIN=50/' scripts/guards/lib.sh
check "a lowered coverage floor is reported as relaxed" 1 "coverage.patch-min was RELAXED"

sed -i 's/max: 400/max: 4000/' web/eslint.config.mjs
check "a raised eslint max-lines is caught" 1 "eslint.max-lines was RELAXED"

sed -i 's/--threshold 2/--threshold 20/' scripts/guards/dup-check.sh
check "a raised duplication threshold is caught" 1 "dup-check.threshold was RELAXED"

# --- protection removed rather than loosened ---------------------------------
#
# None of these move a number, which is why counting them is the only way to
# see them at all.

sed -i '/- gosec/d' engine/.golangci.yml
check "deleting an enabled linter is caught" 1 "golangci.linters.enabled was RELAXED"

sed -i '/- name: argument-limit/,+1d' engine/.golangci.yml
check "deleting a revive rule is caught" 1 "could not measure"

sed -i 's/"sonarjs\/cognitive-complexity": \["error", 15\]/"sonarjs\/cognitive-complexity": "off"/' \
  web/eslint.config.mjs
check "switching an eslint rule off is caught" 1

sed -i '/boundary-one:/,+1d' engine/.golangci.yml
check "deleting an architecture boundary is caught" 1 "golangci.depguard.rules was RELAXED"

# --- suppressions ------------------------------------------------------------

printf '// eslint-disable-next-line\nexport const x = 1;\n' > web/src.mjs
mkdir -p web/src && printf '/* eslint-disable */\n' > web/src/thing.ts
check "a new eslint-disable is counted" 1 "suppress.eslint-disable was RELAXED"
rm -rf web/src web/src.mjs

printf '[[IgnoredVulns]]\nid = "GHSA-a"\n[[IgnoredVulns]]\nid = "GHSA-b"\n' > osv-scanner.toml
check "a second suppressed advisory is counted" 1 "suppress.osv-ignored was RELAXED"

# --- the baseline itself -----------------------------------------------------

sed -i '/^coverage.patch-min/d' scripts/guards/ratchet.baseline
check "a setting missing from the baseline is caught" 1 "absent from"

printf 'invented.metric 1\n' >> scripts/guards/ratchet.baseline
check "a baseline entry nothing measures is caught" 1 "was not measured"

rm scripts/guards/ratchet.baseline
check "a missing baseline fails rather than passing vacuously" 1 "is missing"

# --- an extractor that has gone stale ----------------------------------------
#
# The worst case: the setting is still there, the guard just cannot see it any
# more. It must refuse to run, not quietly measure one fewer thing.

sed -i 's/max-complexity: 12/maxComplexity: 12/' engine/.golangci.yml
check "an unreadable setting stops the guard" 1 "could not measure"

exit "$fail"
