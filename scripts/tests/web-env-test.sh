#!/usr/bin/env bash
# Tests for ensure_web_deps in scripts/guards/web-env.sh — the shared,
# run-scoped node_modules cache the three web gates install through.
#
# The failure this suite exists for does not look like a failure. A cache that
# quietly stops sharing reinstalls three times and every gate still passes,
# only slower — the optimisation it replaced had been dead in CI for weeks
# without a single red check. A cache that shares too much hands one pull
# request's node_modules to the next, and every gate still passes then too.
# So every case asserts how many installs happened and which tree came back,
# never just that the call returned zero.
#
# Run from anywhere inside the real repo:  scripts/tests/web-env-test.sh
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# A stand-in for npm that records every `npm ci` and leaves a tree shaped like
# the real one. The real npm would put the network and two minutes between
# this suite and its answer, and it is not what is under test — the caching
# around it is. The sleep widens the window the concurrency case needs.
mkdir -p "$work/bin"
cat > "$work/bin/npm" <<'SH'
#!/usr/bin/env bash
[ "${1:-}" = "ci" ] || exit 0
echo install >> "$NPM_CI_LOG"
sleep 0.5
mkdir -p node_modules/pkg
cat "$NPM_CI_LOG" | wc -l > node_modules/pkg/generation
SH
chmod +x "$work/bin/npm"
export PATH="$work/bin:$PATH"
export NPM_CI_LOG="$work/installs"
export TOOL_CACHE="$work/toolcache"

fail=0

# ensure_web_deps runs relative to the repo root, so each case gets a throwaway
# tree with a web/package-lock.json and nothing else.
new_fixture() {
  rm -rf "$work/repo" "$work/installs" "$work/cache"
  mkdir -p "$work/repo/web"
  printf 'lock-v1\n' > "$work/repo/web/package-lock.json"
  : > "$work/installs"
}

# Sourced fresh per call, in a subshell, so one case cannot leak an exported
# variable or a held lock into the next. call_in takes the tree because the
# concurrency case needs three of them.
call_in() {
  (
    cd "$1"
    # shellcheck disable=SC1091 # sourced by a path built from $repo_root
    . "$repo_root/scripts/guards/web-env.sh"
    ensure_web_deps
  )
}

call() { call_in "$work/repo"; }

installs() { grep -c install "$work/installs" 2>/dev/null || echo 0; }

check() { # check DESCRIPTION EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FAIL $1 — expected '$2', got '$3'"
    fail=1
  fi
}

# git clean -ffdx is what stands between one CI job and the next, and -x takes
# gitignored paths, so node_modules is gone every time. Every warm case below
# has to survive this.
simulate_checkout() { rm -rf "$work/repo/web/node_modules"; }

echo "── no shared cache configured (every local run, and the pre-push hook)"
new_fixture
unset AGENTIC_RUN_CACHE GITHUB_RUN_ID
call
check "installs once" 1 "$(installs)"
check "node_modules is a real directory" directory \
  "$(stat -c %F "$work/repo/web/node_modules")"
call
check "second call reuses the stamp rather than reinstalling" 1 "$(installs)"
simulate_checkout
call
check "reinstalls after the tree is removed, having nowhere to share from" \
  2 "$(installs)"

echo "── one run, three jobs (the case this cache exists for)"
new_fixture
export AGENTIC_RUN_CACHE="$work/cache" GITHUB_RUN_ID=run-1 GITHUB_RUN_ATTEMPT=1
call
check "first job installs" 1 "$(installs)"
first_generation=$(cat "$work/repo/web/node_modules/pkg/generation")
simulate_checkout
call
check "second job does not install" 1 "$(installs)"
simulate_checkout
call
check "third job does not install" 1 "$(installs)"
check "and gets the tree the first job built" "$first_generation" \
  "$(cat "$work/repo/web/node_modules/pkg/generation")"

# The regression that a symlink caused: Turbopack refuses a node_modules
# symlink pointing out of the project root and fails the build outright, so
# web-build was the only gate that noticed. Assert the shape here instead.
check "the tree is a directory, not a symlink out of the project" directory \
  "$(stat -c %F "$work/repo/web/node_modules")"

echo "── a tree never crosses runs"
simulate_checkout
GITHUB_RUN_ID=run-2 call
check "the next run installs its own copy" 2 "$(installs)"

echo "── a lockfile edited mid-run invalidates the shared tree"
new_fixture
export AGENTIC_RUN_CACHE="$work/cache" GITHUB_RUN_ID=run-3 GITHUB_RUN_ATTEMPT=1
call
check "installs for the first lockfile" 1 "$(installs)"
simulate_checkout
printf 'lock-v2\n' > "$work/repo/web/package-lock.json"
call
check "reinstalls rather than serving the tree built for the old one" \
  2 "$(installs)"

echo "── three jobs arriving at once install once between them"
new_fixture
export AGENTIC_RUN_CACHE="$work/cache" GITHUB_RUN_ID=run-4 GITHUB_RUN_ATTEMPT=1
for i in 1 2 3; do
  # Each in its own tree: concurrent jobs are on separate runners with
  # separate workspaces, sharing only the cache directory and its lock.
  rm -rf "$work/repo-c$i"
  cp -a "$work/repo" "$work/repo-c$i"
done
for i in 1 2 3; do
  call_in "$work/repo-c$i" &
done
wait
check "the lock let exactly one of them run npm ci" 1 "$(installs)"

echo "── trees older than the collection age are removed"
new_fixture
export AGENTIC_RUN_CACHE="$work/cache" GITHUB_RUN_ID=run-5 GITHUB_RUN_ATTEMPT=1
mkdir -p "$work/cache/web-deps/ancient"
touch -d '1 day ago' "$work/cache/web-deps/ancient"
call
check "the old tree is gone" absent \
  "$([ -e "$work/cache/web-deps/ancient" ] && echo present || echo absent)"
# Counted with find rather than a glob: the lock file sits beside the tree
# and shares its prefix, so `[ -d prefix* ]` gets handed two words.
check "this run's tree is not" 1 \
  "$(find "$work/cache/web-deps" -maxdepth 1 -type d -name 'run-5-1-*' | wc -l)"

if [ "$fail" -ne 0 ]; then
  echo "web-env-test: FAILED" >&2
  exit 1
fi
echo "web-env-test: all cases passed"
