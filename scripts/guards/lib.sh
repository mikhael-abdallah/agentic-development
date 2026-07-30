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
