#!/usr/bin/env bash
# Shared helper for guard scripts. Source it, don't execute it.
#
# fetch_tool NAME VERSION URL [TAR_FLAGS...] — downloads the release tarball
# on first use into the tool cache (CI's RUNNER_TOOL_CACHE, or
# ~/.cache/agentic-tools locally) and prints the path of the NAME binary
# found inside it.

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
