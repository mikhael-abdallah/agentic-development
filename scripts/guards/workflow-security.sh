#!/usr/bin/env bash
# Guard: Actions security audit — template injection, unpinned refs,
# credential exposure (zizmor).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh

ZIZMOR_VERSION=1.28.0
bin=$(fetch_tool zizmor "$ZIZMOR_VERSION" \
  "https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-x86_64-unknown-linux-gnu.tar.gz" \
  -xz)

# Online audits need a GitHub token; fall back to the gh CLI's, or skip them.
if [ -z "${GH_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
  GH_TOKEN=$(gh auth token 2>/dev/null || true)
  export GH_TOKEN
fi
args=(--min-severity medium)
if [ -z "${GH_TOKEN:-}" ]; then
  args+=(--no-online-audits)
fi
"$bin" "${args[@]}" .github/workflows/
