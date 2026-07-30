#!/usr/bin/env bash
# Tests for scripts/guards/structure-check.sh.
#
# A layout guard's failure mode is silence: an allowlist that accidentally
# matches everything, or a loop that never runs, passes every PR while
# enforcing nothing. So each rule gets a negative case that must fail, and the
# clean tree must pass — proving the guard can say both words.
#
# Run from anywhere inside the real repo:  scripts/tests/structure-check-test.sh
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# A minimal repository shaped exactly like ARCHITECTURE.md describes. Every
# case below adds one file to it and expects the guard to object.
git init -q -b main "$work/repo"
cd "$work/repo"
git config user.name test
git config user.email test@test
mkdir -p engine/internal/sim engine/cmd/engined \
  web/src/app web/src/lib web/src/features/canvas \
  scripts/guards scripts/tests .githooks
cp "$repo_root/scripts/guards/structure-check.sh" scripts/guards/
printf 'module example\n' > engine/go.mod
printf 'package sim\n' > engine/internal/sim/sim.go
printf 'package main\n' > engine/cmd/engined/main.go
printf '{}\n' > web/package.json
printf 'export default {}\n' > web/next.config.ts
printf 'x\n' > web/src/app/page.tsx
printf 'x\n' > web/src/app/page.test.tsx
printf 'x\n' > web/src/lib/format.ts
printf 'x\n' > web/src/lib/format.test.ts
printf 'x\n' > web/src/features/canvas/canvas.tsx
printf 'run "structure-check" scripts/guards/structure-check.sh\n' \
  > scripts/local-guards.sh
printf 'README\n' > README.md
mkdir -p .github/workflows
printf 'jobs:\n' > .github/workflows/guardrails.yml
git add -A
git commit -qm "chore: init"

fail=0
# expect NAME EXPECTED_EXIT [FILE_TO_ADD] — runs the guard against the clean
# tree plus FILE_TO_ADD, then removes it again.
expect() {
  local name=$1 expected=$2 extra=${3:-} got=0
  if [ -n "$extra" ]; then
    mkdir -p "$(dirname "$extra")"
    printf 'x\n' > "$extra"
    git add -A
  fi
  scripts/guards/structure-check.sh >/dev/null 2>&1 || got=$?
  if [ "$got" -eq "$expected" ]; then
    echo "ok: $name"
  else
    echo "FAIL: $name (expected exit $expected, got $got)"
    fail=1
  fi
  if [ -n "$extra" ]; then
    rm -f "$extra"
    git add -A
  fi
}

expect "a layout matching ARCHITECTURE.md passes" 0

# Top level
expect "rejects an unexpected top-level directory" 1 "tools/thing.txt"
expect "rejects an unexpected top-level file" 1 "notes.txt"

# Engine
expect "rejects a Go package outside internal/ and cmd/" 1 "engine/sim/sim.go"
expect "rejects an unknown engine package" 1 "engine/internal/storage/db.go"
expect "rejects an unknown engine binary" 1 "engine/cmd/scratch/main.go"
expect "rejects a loose file in engine/internal" 1 "engine/internal/helpers.go"
expect "rejects an unexpected file at the engine root" 1 "engine/notes.md"

# Web
expect "rejects application code outside src/" 1 "web/helpers/util.ts"
expect "rejects an unknown directory under src/" 1 "web/src/utils/util.ts"
expect "rejects an unknown feature slice" 1 "web/src/features/toolbar/toolbar.tsx"
expect "rejects a file loose in features/" 1 "web/src/features/shared.ts"
expect "rejects a non-route file in app/" 1 "web/src/app/button.tsx"
expect "accepts a nested route directory" 0 "web/src/app/designs/page.tsx"
expect "accepts a dynamic route segment" 0 "web/src/app/designs/[id]/page.tsx"
expect "rejects JavaScript under src/" 1 "web/src/lib/legacy.js"
expect "rejects a separate test directory" 1 "web/src/lib/__tests__/format.test.ts"
expect "rejects a test with no module beside it" 1 "web/src/lib/ghost.test.ts"

# The guardrails' own structure
expect "rejects a shell script shell-lint does not glob" 1 "scripts/ci/deploy.sh"
expect "rejects a guard nothing invokes" 1 "scripts/guards/orphan.sh"

exit "$fail"
