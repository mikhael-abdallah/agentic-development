#!/usr/bin/env bash
# Shared Node toolchain bootstrap for the web-* guards. Source it after
# lib.sh, then call ensure_node (pinned Node into the tool cache, same
# toolchain in CI and locally) and ensure_web_deps (npm ci for web/, skipped
# when node_modules already matches the lockfile, and shared by the jobs of
# one CI run rather than installed once per job).

NODE_VERSION=24.18.1
# Official checksum from https://nodejs.org/dist/v24.18.1/SHASUMS256.txt —
# the toolchain runs everything else, so it gets verified, not just pinned.
NODE_SHA256=9f5eb6ac21845a66c493c91a253b1da32fd684e89e9b7202d4936982336be4ca

ensure_node() {
  local dir="$TOOL_CACHE/node/$NODE_VERSION" tarball
  if [ ! -x "$dir/node-v$NODE_VERSION-linux-x64/bin/node" ]; then
    echo "guards: installing node $NODE_VERSION into $dir (first run)" >&2
    mkdir -p "$dir"
    tarball="$dir/node.tar.gz"
    if ! curl -sSfL -o "$tarball" \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz"; then
      echo "guards: failed to download node $NODE_VERSION" >&2
      return 1
    fi
    if ! echo "$NODE_SHA256  $tarball" | sha256sum -c --quiet -; then
      echo "guards: node $NODE_VERSION tarball failed checksum verification" >&2
      rm -f "$tarball"
      return 1
    fi
    tar -xzf "$tarball" -C "$dir"
    rm -f "$tarball"
  fi
  export PATH="$dir/node-v$NODE_VERSION-linux-x64/bin:$PATH"
}

# WEB_DEPS_MAX_AGE_MIN — how long a run's dependency tree may sit in the
# shared cache before it is collected. Well above the longest a run can take
# (the web jobs time out at 15 minutes) and well below a working day.
WEB_DEPS_MAX_AGE_MIN=120

# The shared directory for this run's node_modules, or nothing when there is
# no shared cache to use: any local run, and any runner without
# AGENTIC_RUN_CACHE set. Absence is not an error — the caller falls back to
# installing its own copy, which is exactly what happened before this existed.
#
# Keyed by run *and* lockfile. The run id alone would hand a tree to a later
# job after a mid-run push changed package-lock.json; the lockfile alone would
# hand it to the next pull request, which is the case the comment on
# ensure_web_deps is about.
web_deps_dir() {
  local lock_sha=$1
  [ -n "${AGENTIC_RUN_CACHE:-}" ] || return 1
  [ -n "${GITHUB_RUN_ID:-}" ] || return 1
  printf '%s/web-deps/%s-%s-%s\n' "$AGENTIC_RUN_CACHE" \
    "$GITHUB_RUN_ID" "${GITHUB_RUN_ATTEMPT:-1}" "$lock_sha"
}

web_npm_ci() {
  echo "guards: installing web/ dependencies (npm ci)" >&2
  rm -rf web/node_modules
  (cd web && npm ci --prefer-offline --no-audit --no-fund \
    --cache "$TOOL_CACHE/npm-cache")
}

# Put the shared tree at web/node_modules. Hardlinked, not symlinked: a
# symlink out of the project root is the one thing Turbopack refuses outright
# ("Symlink [project]/node_modules is invalid, it points out of the filesystem
# root"), and it fails the build rather than falling back. cp -al rebuilds the
# directories and hardlinks the files, so every tool sees an ordinary
# directory — the same trick pnpm's store uses. Measured at 0.3s for the
# 30,122 files npm ci takes twenty seconds to produce.
#
# Hardlinks share inodes, so a tool that rewrote a file inside node_modules in
# place would rewrite it for the other jobs too. Nothing here does — the gates
# read the tree and write to web/.next and web/coverage — and anything that
# did could only reach the jobs of its own run, which the tree does not
# outlive.
link_web_deps() {
  local src=$1
  rm -rf web/node_modules
  # Falls back to a real copy when the cache is on another filesystem, which
  # is a local run's problem rather than CI's. Still cheaper than resolving
  # and unpacking 429 packages.
  cp -al "$src" web/node_modules 2>/dev/null && return 0
  rm -rf web/node_modules
  cp -a "$src" web/node_modules
}

# npm ci wipes node_modules on every run, which is too slow to sit in front
# of every push. Stamp the lockfile hash after a successful install and skip
# the reinstall while it still matches.
#
# That stamp never survived in CI. actions/checkout defaults to clean: true,
# which runs `git clean -ffdx`, and -x takes gitignored paths — so web-lint,
# web-test and web-build each arrived at an empty tree and installed the same
# 429 packages. Measured on a green run: 61 seconds out of 364, spent three
# times on an identical result.
#
# So the install happens once per run, in a directory outside every workspace,
# and the other two jobs hardlink it into place. `git clean` empties the
# workspace copy and never touches the shared one, which is what lets the tree
# outlive the job.
#
# It does not outlive the run, and that part is deliberate. node_modules holds
# eslint, knip, vitest and tsc — the binaries three of these gates are made of
# — so a cache keyed by lockfile alone would be an unverified channel from one
# pull request into the next, and a pull request that wrote a stub eslint into
# it would silently disarm web-lint for everything that followed. That is the
# attack fetch_tool's verify-on-every-use rule closes for the tool cache, and
# the same defence is not available here: a tree of thirty thousand files has
# no published checksum to compare it against. Per run, every run still
# installs from the committed lockfile exactly once, which is what it does
# today — only two fewer times.
ensure_web_deps() {
  local stamp=web/node_modules/.agentic-lock-sha want have shared
  want=$(sha256sum web/package-lock.json | cut -d' ' -f1)
  have=$(cat "$stamp" 2>/dev/null || true)
  [ "$want" != "$have" ] || return 0

  if ! shared=$(web_deps_dir "$want"); then
    web_npm_ci
    printf '%s\n' "$want" > "$stamp"
    return 0
  fi

  mkdir -p "${shared%/*}"
  # Runs that finished hours ago left their trees behind, and nothing tells a
  # job that a run has ended. Collect by age instead, before adding another.
  find "${shared%/*}" -maxdepth 1 -mindepth 1 -mmin "+$WEB_DEPS_MAX_AGE_MIN" \
    -exec rm -rf {} + 2>/dev/null || true

  # flock, not a test for the directory. The three web jobs now start on three
  # runners in the same second; two of them asking "is it there yet" would
  # both answer no, and both install into the same path.
  exec 9>"$shared.lock"
  flock 9
  if [ ! -f "$shared/node_modules/.agentic-lock-sha" ]; then
    rm -rf "$shared"
    mkdir -p "$shared"
    web_npm_ci
    printf '%s\n' "$want" > "$stamp"
    # Moved rather than copied, so a reader can never see a half-written tree:
    # the stamp is inside it, and it appears at the shared path atomically.
    mv web/node_modules "$shared/node_modules"
  fi
  exec 9>&-

  link_web_deps "$shared/node_modules"
}
