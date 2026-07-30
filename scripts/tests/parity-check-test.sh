#!/usr/bin/env bash
# Tests for scripts/guards/parity-check.sh.
#
# This is the guard that guards the guards, so its own failure mode is the
# worst one available: if it silently matches nothing, every other gate can be
# hollowed out behind a green check. Each bypass it exists to catch therefore
# gets a case that must fail.
#
# Run from anywhere inside the real repo:  scripts/tests/parity-check-test.sh
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git init -q -b main "$work/repo"
cd "$work/repo"
git config user.name test
git config user.email test@test
mkdir -p .github/workflows scripts/guards scripts/tests
cp "$repo_root/scripts/guards/parity-check.sh" scripts/guards/
# parity-check branches, so by its own rule it needs a suite of its own; the
# real one is what is running right now.
touch scripts/tests/parity-check-test.sh

workflow=.github/workflows/guardrails.yml

# write_workflow BODY — a valid two-job workflow, with BODY substituted for
# the second job so each case changes exactly one thing.
write_workflow() {
  cat > "$workflow" <<EOF
name: guardrails
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
jobs:
  alpha:
    steps:
      - run: scripts/guards/alpha.sh
$1
EOF
}

good_beta='  beta:
    steps:
      - run: scripts/guards/beta.sh'

write_local_guards() {
  printf '%s\n' "$@" > scripts/local-guards.sh
}
write_local_guards 'run "alpha" scripts/guards/alpha.sh' \
  'run "beta" scripts/guards/beta.sh'

fail=0
check() {
  local name=$1 expected=$2 got=0
  scripts/guards/parity-check.sh >/dev/null 2>&1 || got=$?
  if [ "$got" -eq "$expected" ]; then
    echo "ok: $name"
  else
    echo "FAIL: $name (expected exit $expected, got $got)"
    fail=1
  fi
}

write_workflow "$good_beta"
check "a faithful workflow passes" 0

# The bypass this guard was written for: keep the job name the ruleset
# requires, drop the guard it runs.
write_workflow '  beta:
    steps:
      - run: "true"'
check "rejects a job that no longer runs its guard" 1

write_workflow '  beta:
    steps:
      - run: scripts/guards/alpha.sh'
check "rejects a job running a different guard" 1

# A job key with a trailing comment is valid YAML; an earlier version of the
# parser did not see it, so such a job escaped both checks entirely.
write_workflow '  beta: # ci only
    steps:
      - run: "true"'
check "sees a job key with a trailing comment" 1

write_workflow "$good_beta"
write_local_guards 'run "alpha" scripts/guards/alpha.sh'
check "rejects a job with no local counterpart" 1
write_local_guards 'run "alpha" scripts/guards/alpha.sh' \
  'run "beta" scripts/guards/beta.sh'

# Without 'edited', a PR can be opened with a conventional title and renamed
# after pr-title has already passed.
cat > "$workflow" <<EOF
name: guardrails
on:
  pull_request:
    types: [opened, synchronize]
jobs:
  alpha:
    steps:
      - run: scripts/guards/alpha.sh
$good_beta
EOF
check "rejects a pull_request trigger without 'edited'" 1

# A workflow it cannot parse must fail loudly rather than report zero jobs.
printf 'name: guardrails\non:\n  pull_request:\n    types: [edited]\njobs:\n' > "$workflow"
check "rejects a workflow with no parsable jobs" 1

# --- guards that branch need a test suite ------------------------------------

write_workflow "$good_beta"
check "the baseline is green again" 0

# No control flow of its own: nothing here can quietly take the do-nothing
# path, so there is nothing for a suite to assert.
printf '#!/usr/bin/env bash\nset -euo pipefail\nsome-tool .\n' > scripts/guards/alpha.sh
check "a guard that only runs a tool needs no suite" 0

printf '#!/usr/bin/env bash\nset -euo pipefail\nif [ -f marker ]; then\n  exit 1\nfi\n' \
  > scripts/guards/alpha.sh
check "rejects a branching guard with no test suite" 1

touch scripts/tests/alpha-test.sh
check "accepts a branching guard once it has one" 0

# The loop form of the same hole: a glob that matches nothing runs the body
# zero times and exits 0.
printf '#!/usr/bin/env bash\nset -euo pipefail\nfor f in *.x; do\n  echo found\ndone\n' \
  > scripts/guards/gamma.sh
check "rejects a looping guard with no test suite" 1

exit "$fail"
