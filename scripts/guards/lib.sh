#!/usr/bin/env bash
# Shared helper for guard scripts. Source it, don't execute it.
#
# fetch_tool NAME VERSION URL [TAR_FLAGS...] — downloads the release tarball
# on first use into the tool cache (CI's RUNNER_TOOL_CACHE, or
# ~/.cache/agentic-tools locally) and prints the path of the NAME binary
# found inside it.
#
# ensure_diff_cover VERSION — installs diff-cover into a cached venv on
# first use and prints the path of its binary. Shared by the Go and web
# patch-coverage gates so both languages ride the same mechanism.

TOOL_CACHE="${RUNNER_TOOL_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/agentic-tools}"

fetch_tool() {
  local name=$1 version=$2 url=$3
  shift 3
  local dir="$TOOL_CACHE/$name/$version" bin
  # '|| true': under errexit+pipefail a cold cache (missing $dir) or a
  # head-closed pipe must fall through to the download, not abort.
  bin=$(find "$dir" -name "$name" -type f 2>/dev/null | head -1) || true
  if [ -z "$bin" ]; then
    mkdir -p "$dir"
    curl -sSfL "$url" | tar -C "$dir" "$@"
    bin=$(find "$dir" -name "$name" -type f | head -1) || true
  fi
  if [ -z "$bin" ]; then
    echo "guards: could not find '$name' in the v$version release tarball" >&2
    return 1
  fi
  chmod +x "$bin"
  printf '%s\n' "$bin"
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
