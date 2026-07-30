#!/usr/bin/env bash
# Guard: the quality settings only ever tighten.
#
# Every other gate in this repository checks the code. This one checks the
# gates, because the cheapest way to make a red check go green is not to fix
# the code — it is to move the limit. Raise `funlen` from 80 to 200, drop
# `gosec` from the enabled linters, add one more `eslint-disable`, lower the
# patch-coverage floor: each is a one-line edit that turns the pipeline green
# while removing the thing that was protecting it, and no existing check can
# tell that apart from a genuine fix. `parity-check` verifies that the jobs
# still run their guards; nothing verified that the guards still demanded
# anything.
#
# So the numbers live in scripts/guards/ratchet.baseline, and this compares
# the tree against it. Any difference fails — in *both* directions:
#
#   looser  the change removes protection. Fix the code instead, or, if the
#           limit really was wrong, edit the baseline in the same PR and say
#           why in the description. It is then one reviewable line saying
#           "this bar was lowered", rather than an invisible config tweak.
#
#   tighter the improvement has to be recorded, or it is not a ratchet: an
#           unrecorded improvement can be silently undone tomorrow.
#
# The baseline is editable — everything in a repository is. The point is that
# editing it is *visible*, and lands next to the reason.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

BASELINE=scripts/guards/ratchet.baseline

golangci=engine/.golangci.yml
eslint=web/eslint.config.mjs

# --- extraction --------------------------------------------------------------
#
# Every extractor below must produce a value. An extractor that quietly
# produces nothing — because a key was renamed, a file moved, a pattern went
# stale — would drop its setting from the comparison and leave that setting
# unguarded, which is the exact failure this guard exists to prevent. So an
# empty result is a hard error, not a skipped line.

measured=$(mktemp)
trap 'rm -f "$measured"' EXIT

metric() {
  local key=$1 value=$2
  if [ -z "$value" ]; then
    echo "guards: ratchet-check could not measure '$key'" >&2
    echo "guards:   the setting was renamed, moved or removed. Fix the extractor" \
      "in $0 — a metric that cannot be read is a setting nobody is watching" >&2
    exit 1
  fi
  printf '%s %s\n' "$key" "$value" >> "$measured"
}

# first_num FILE SECTION KEY — the first number on the first KEY line at or
# after SECTION. Used where a key name repeats under different sections.
first_num() {
  awk -v sec="$2" -v key="$3" '
    index($0, sec) { inblock = 1 }
    inblock && index($0, key) {
      if (match($0, /[0-9]+/)) { print substr($0, RSTART, RLENGTH); exit }
    }
  ' "$1"
}

# max_num FILE REGEX — the largest number matched, so a limit that appears in
# several config blocks is held at its most permissive occurrence.
max_num() {
  grep -oE "$2" "$1" | grep -oE '[0-9]+' | sort -n | tail -1
}

# flag_num FILE -- FLAG — the number a command-line flag is given. Reading it
# off the flag rather than off the line avoids picking up a version number
# that happens to sit earlier on the same command.
flag_num() {
  grep -oE -- "$3 [0-9]+" "$1" | grep -oE '[0-9]+' | head -1
}

# occurrences REGEX PATHSPEC... — how many times a pattern appears across the
# tracked tree. --untracked so a pre-push run sees files the PR will add.
occurrences() {
  local pattern=$1
  shift
  git grep -I --untracked -ohE "$pattern" -- "$@" 2>/dev/null | wc -l
}

# lines_matching FILE REGEX — count, with 0 rather than a non-zero exit.
lines_matching() {
  grep -cE "$2" "$1" || true
}

# --- Go clean-code limits ----------------------------------------------------

metric golangci.cyclop.max-complexity "$(first_num "$golangci" 'cyclop:' 'max-complexity:')"
metric golangci.funlen.lines "$(first_num "$golangci" 'funlen:' 'lines:')"
metric golangci.funlen.statements "$(first_num "$golangci" 'funlen:' 'statements:')"
metric golangci.gocognit.min-complexity "$(first_num "$golangci" 'gocognit:' 'min-complexity:')"
metric golangci.nestif.min-complexity "$(first_num "$golangci" 'nestif:' 'min-complexity:')"
metric golangci.revive.argument-limit "$(first_num "$golangci" 'argument-limit' 'arguments:')"
metric golangci.revive.file-length-limit "$(first_num "$golangci" 'file-length-limit' 'max:')"

# Breadth, not depth: how many linters are switched on, how many architecture
# rules depguard enforces, how many exclusions carve holes in all of it. A
# linter deleted from the list is a whole category of finding that stops being
# reported, and no threshold moves when it happens.
metric golangci.linters.enabled "$(
  sed -n '/^linters:/,/^formatters:/p' "$golangci" |
    awk '/^  enable:/ { inlist = 1; next } /^  [a-z]/ { inlist = 0 } inlist && /^    - / { n++ } END { print n + 0 }'
)"
metric golangci.depguard.rules "$(lines_matching "$golangci" '^ +list-mode:')"
metric golangci.exclusions "$(lines_matching "$golangci" '^      - path:')"
metric golangci.staticcheck.exclusions "$(
  grep -oE 'checks: \["all"[^]]*\]' "$golangci" | grep -o '"-ST' | wc -l
)"

# --- web clean-code limits ---------------------------------------------------

metric eslint.complexity "$(max_num "$eslint" 'complexity: \["error", [0-9]+')"
metric eslint.max-depth "$(max_num "$eslint" '"max-depth": \["error", [0-9]+')"
metric eslint.max-lines "$(max_num "$eslint" '"max-lines": \["error", \{ max: [0-9]+')"
metric eslint.max-lines-per-function "$(max_num "$eslint" '"max-lines-per-function": \["error", \{ max: [0-9]+')"
metric eslint.max-nested-callbacks "$(max_num "$eslint" '"max-nested-callbacks": \["error", [0-9]+')"
metric eslint.max-params "$(max_num "$eslint" '"max-params": \["error", [0-9]+')"
metric eslint.sonarjs-cognitive-complexity "$(max_num "$eslint" '"sonarjs/cognitive-complexity": \["error", [0-9]+')"

# A rule switched off entirely moves no number, so count the offs as well.
metric eslint.rules-disabled "$(grep -c ': "off"' "$eslint" || true)"
# Import boundaries: app -> features -> components|lib, no cross-slice reach,
# no importing a test file from product code.
metric eslint.plugins "$(lines_matching "$eslint" '^import ')"
metric eslint.restricted-import-patterns "$(grep -oE 'group: \[' "$eslint" | wc -l)"

# --- gates that are not lint -------------------------------------------------

metric coverage.patch-min "$(first_num scripts/guards/lib.sh 'PATCH_COVERAGE_MIN' 'PATCH_COVERAGE_MIN')"
metric pr-guard.max-changed-files "$(first_num scripts/guards/pr-guard.sh 'MAX_CHANGED_FILES' 'MAX_CHANGED_FILES')"
metric pr-guard.max-changed-lines "$(first_num scripts/guards/pr-guard.sh 'MAX_CHANGED_LINES' 'MAX_CHANGED_LINES')"
metric hygiene-check.max-bytes "$(first_num scripts/guards/hygiene-check.sh 'MAX_FILE_BYTES' 'MAX_FILE_BYTES')"
metric dup-check.threshold "$(flag_num scripts/guards/dup-check.sh -- --threshold)"
metric dup-check.min-tokens "$(flag_num scripts/guards/dup-check.sh -- --min-tokens)"
metric bundle-budget.bytes "$(
  grep -oE 'BUDGET_BYTES = [0-9_]+' scripts/guards/bundle-budget.mjs |
    grep -oE '[0-9][0-9_]*' | tr -d _
)"

# --- suppressions ------------------------------------------------------------
#
# Each of these is a legitimate tool with a written justification behind it —
# `nolintlint` and `--report-unused-disable-directives` already see to that.
# What no existing check sees is the total. Justified or not, every one of
# them is a line the gates no longer read, and the number only drifts one way
# unless something is counting.

metric suppress.nolint "$(occurrences '//[[:space:]]*nolint' 'engine/*.go')"
metric suppress.eslint-disable "$(occurrences 'eslint-disable' 'web/src' 'web/*.mjs' 'web/*.ts')"
metric suppress.ts-expect-error "$(occurrences '@ts-(expect-error|ignore)' 'web/src' 'web/*.ts' 'web/*.mjs')"
# The pattern is written with a character class so that this line does not
# match itself — the guard would otherwise count its own source and report a
# suppression that does not exist.
metric suppress.shellcheck-disable "$(occurrences 'shellcheck[[:space:]]disable' 'scripts' '.githooks')"
metric suppress.test-skip "$(occurrences '(\.|\b)(skip|only)\(|t\.Skip' 'engine' 'web/src')"
metric suppress.osv-ignored "$(lines_matching osv-scanner.toml '^\[\[IgnoredVulns\]\]')"

# --- the gates themselves ----------------------------------------------------

metric guards.scripts "$(find scripts/guards -maxdepth 1 -name '*.sh' | wc -l)"
metric guards.test-suites "$(find scripts/tests -maxdepth 1 -name '*-test.sh' | wc -l)"
metric guards.ci-jobs "$(
  awk '
    /^jobs:/ { injobs = 1; next }
    injobs && /^[^ #]/ { exit }
    injobs && match($0, /^  [A-Za-z0-9_-]+:[ \t]*(#.*)?$/) { n++ }
    END { print n + 0 }
  ' .github/workflows/guardrails.yml
)"

# --- comparison --------------------------------------------------------------

if [ ! -f "$BASELINE" ]; then
  echo "guards: $BASELINE is missing — without it nothing is being ratcheted" >&2
  exit 1
fi

# Directions, for the message only: the comparison itself is exact equality,
# so a setting cannot move at all without the baseline moving with it.
declare -A LOOSER_WHEN=(
  [golangci.cyclop.max-complexity]=higher
  [golangci.funlen.lines]=higher
  [golangci.funlen.statements]=higher
  [golangci.gocognit.min-complexity]=higher
  [golangci.nestif.min-complexity]=higher
  [golangci.revive.argument-limit]=higher
  [golangci.revive.file-length-limit]=higher
  [golangci.linters.enabled]=lower
  [golangci.depguard.rules]=lower
  [golangci.exclusions]=higher
  [golangci.staticcheck.exclusions]=higher
  [eslint.complexity]=higher
  [eslint.max-depth]=higher
  [eslint.max-lines]=higher
  [eslint.max-lines-per-function]=higher
  [eslint.max-nested-callbacks]=higher
  [eslint.max-params]=higher
  [eslint.sonarjs-cognitive-complexity]=higher
  [eslint.rules-disabled]=higher
  [eslint.plugins]=lower
  [eslint.restricted-import-patterns]=lower
  [coverage.patch-min]=lower
  [pr-guard.max-changed-files]=higher
  [pr-guard.max-changed-lines]=higher
  [dup-check.threshold]=higher
  [hygiene-check.max-bytes]=higher
  [dup-check.min-tokens]=higher
  [bundle-budget.bytes]=higher
  [suppress.nolint]=higher
  [suppress.eslint-disable]=higher
  [suppress.ts-expect-error]=higher
  [suppress.shellcheck-disable]=higher
  [suppress.test-skip]=higher
  [suppress.osv-ignored]=higher
  [guards.scripts]=lower
  [guards.test-suites]=lower
  [guards.ci-jobs]=lower
)

declare -A want
while read -r key value; do
  case "$key" in '' | '#'*) continue ;; esac
  want["$key"]=$value
done < "$BASELINE"

fail=0
seen=()
while read -r key value; do
  seen+=("$key")
  if [ -z "${LOOSER_WHEN[$key]:-}" ]; then
    echo "guards: '$key' has no direction recorded in ratchet-check.sh" >&2
    fail=1
    continue
  fi
  if [ -z "${want[$key]:-}" ]; then
    echo "guards: '$key' is measured but absent from $BASELINE — add '$key $value'" >&2
    fail=1
    continue
  fi
  [ "${want[$key]}" != "$value" ] || continue

  movement=tightened
  if [ "${LOOSER_WHEN[$key]}" = higher ]; then
    [ "$value" -le "${want[$key]}" ] || movement=relaxed
  else
    [ "$value" -ge "${want[$key]}" ] || movement=relaxed
  fi

  if [ "$movement" = relaxed ]; then
    echo "guards: $key was RELAXED — ${want[$key]} in the baseline, $value here" >&2
    echo "guards:   this removes protection. Fix the code rather than the limit;" \
      "if the limit itself was wrong, change the baseline line in this PR and" \
      "say why in the description" >&2
  else
    echo "guards: $key was tightened — ${want[$key]} in the baseline, $value here" >&2
    echo "guards:   record it, or it is not a ratchet: an unrecorded improvement" \
      "can be quietly undone tomorrow. Update $BASELINE to '$key $value'" >&2
  fi
  fail=1
done < "$measured"

for key in "${!want[@]}"; do
  found=0
  for s in "${seen[@]}"; do
    [ "$s" != "$key" ] || found=1
  done
  if [ "$found" -eq 0 ]; then
    echo "guards: '$key' is in $BASELINE but was not measured — the setting it" \
      "tracked is gone, and with it whatever it was protecting" >&2
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "guards: all ${#want[@]} quality settings match the ratchet baseline"
