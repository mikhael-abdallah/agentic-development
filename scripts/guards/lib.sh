#!/usr/bin/env bash
# Shared helper for guard scripts. Source it, don't execute it.
#
# fetch_tool NAME VERSION TARBALL_SHA256 BINARY_SHA256 URL [TAR_FLAGS...] —
# downloads the release tarball on first use into the tool cache (CI's
# RUNNER_TOOL_CACHE, or ~/.cache/agentic-tools locally) and prints the path
# of the NAME binary found inside it.
#
# ensure_diff_cover VERSION — installs diff-cover into a cached venv on
# first use and prints the path of its binary. Shared by the Go and web
# patch-coverage gates so both languages ride the same mechanism.

TOOL_CACHE="${RUNNER_TOOL_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/agentic-tools}"

# Patch-coverage settings live here so the Go and web gates cannot drift
# apart, and so raising the bar is a one-line change in one file.
# shellcheck disable=SC2034 # read by the guards that source this file
DIFF_COVER_VERSION=10.4.1
# shellcheck disable=SC2034 # read by the guards that source this file
PATCH_COVERAGE_MIN=80

verify_sha256() {
  local file=$1 want=$2 label=$3 got
  got=$(sha256sum "$file" | cut -d' ' -f1)
  if [ "$got" != "$want" ]; then
    echo "guards: $label failed checksum verification" >&2
    echo "guards:   expected $want" >&2
    echo "guards:   got      $got" >&2
    return 1
  fi
}

# Every pinned tool is verified twice: the tarball on download (against the
# checksum its project publishes, where it publishes one), and the extracted
# binary on *every* invocation — including cache hits.
#
# The second check is the one that matters here. CI runs pull-request code on
# a long-lived self-hosted runner whose tool cache outlives the job, so a
# single malicious run could otherwise swap gitleaks or zizmor for a binary
# that exits 0, silently disarming those gates for every later PR. Comparing
# against a hash committed to a protected branch closes that.
fetch_tool() {
  local name=$1 version=$2 tarball_sha=$3 binary_sha=$4 url=$5
  shift 5
  local dir="$TOOL_CACHE/$name/$version" bin tarball
  # '|| true': under errexit+pipefail a cold cache (missing $dir) or a
  # head-closed pipe must fall through to the download, not abort.
  # 'sort' keeps the pick deterministic when a tarball ships two matches.
  bin=$(find "$dir" -name "$name" -type f 2>/dev/null | sort | head -1) || true

  if [ -z "$bin" ]; then
    rm -rf "$dir"
    mkdir -p "$dir"
    tarball="$dir/.download"
    if ! curl -sSfL -o "$tarball" "$url"; then
      echo "guards: failed to download $name $version" >&2
      rm -rf "$dir"
      return 1
    fi
    if ! verify_sha256 "$tarball" "$tarball_sha" "$name $version tarball"; then
      rm -rf "$dir"
      return 1
    fi
    tar -C "$dir" -f "$tarball" "$@"
    rm -f "$tarball"
    bin=$(find "$dir" -name "$name" -type f | sort | head -1) || true
  fi

  if [ -z "$bin" ]; then
    echo "guards: could not find '$name' in the $version release tarball" >&2
    return 1
  fi
  if ! verify_sha256 "$bin" "$binary_sha" "cached $name $version binary"; then
    echo "guards: the cached copy does not match the pinned hash — the tool" \
      "cache may have been tampered with. Removing it; re-run to reinstall." >&2
    rm -rf "$dir"
    return 1
  fi
  chmod +x "$bin"
  printf '%s\n' "$bin"
}

# Scopes for guard_applies. A language gate cares about its own tree, plus
# the guard plumbing and CI wiring that decide how it runs — change either of
# those and every gate re-runs.
# shellcheck disable=SC2034 # read by the guards that source this file
GO_GUARD_SCOPE='^(engine/|scripts/|\.github/)'
# shellcheck disable=SC2034 # read by the guards that source this file
WEB_GUARD_SCOPE='^(web/|scripts/|\.github/)'

# guard_applies NAME SCOPE_REGEX — 0 when this guard has work to do, 1 (with
# an explanatory line) when nothing in its scope changed. A front-end-only PR
# should not pay for the Go toolchain download, and vice versa.
#
# The skip lives here rather than in a workflow `paths:` filter or a job
# `if:` because a required status check that never *reports* leaves auto-merge
# waiting forever. The job still runs and still reports green — it just exits
# before doing any expensive work.
#
# Fail-open by design: if the base ref or the merge base cannot be resolved,
# or the diff comes back empty (a push to main, say), the guard RUNS. Skipping
# has to be a positive decision about a diff we could actually read, never a
# side effect of a git view we could not.
guard_applies() {
  local name=$1 scope=$2 base merge_base changed
  base="origin/${GITHUB_BASE_REF:-main}"
  git rev-parse --verify -q "$base" >/dev/null || return 0
  merge_base=$(git merge-base "$base" HEAD 2>/dev/null) || return 0
  # Working tree and untracked files count too, so a local pre-push run sees
  # the same scope the eventual PR will.
  changed=$({
    git diff --name-only "$merge_base"
    git ls-files --others --exclude-standard
  } 2>/dev/null) || return 0
  [ -n "$changed" ] || return 0
  if grep -qE "$scope" <<<"$changed"; then
    return 0
  fi
  echo "guards: $name skipped — no changed file matches $scope" >&2
  return 1
}

# diff-cover is Python-only, so it lives in a cached venv, versioned like
# every other pinned tool. --without-pip + get-pip.py works on machines
# that lack the python3-venv apt package (ensurepip), so CI and local
# machines share one code path with no system packages beyond python3.
ensure_diff_cover() {
  local version=$1 venv="$TOOL_CACHE/diff-cover/$1"
  if [ ! -x "$venv/bin/diff-cover" ]; then
    echo "guards: installing diff-cover $version into $venv (first run)" >&2
    rm -rf "$venv" # a half-built venv from an earlier failure must not linger
    python3 -m venv --without-pip "$venv"
    curl -sSfL https://bootstrap.pypa.io/get-pip.py | "$venv/bin/python3" - -q
    "$venv/bin/pip" -q install "diff_cover==$version"
  fi
  printf '%s\n' "$venv/bin/diff-cover"
}
