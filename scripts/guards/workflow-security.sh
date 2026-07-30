#!/usr/bin/env bash
# Guard: Actions security audit — template injection, unpinned refs,
# credential exposure (zizmor).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh

ZIZMOR_VERSION=1.28.0
# zizmor publishes no checksum file, so both hashes were recorded from the
# release asset. Pinning them still detects a re-uploaded asset and a
# tampered tool cache — it is not an independent upstream attestation.
ZIZMOR_TARBALL_SHA256=e87b67160194884e375a46a12c57ccc904f762b53845f254fab7f17d98809c09
ZIZMOR_BINARY_SHA256=79c9d685e41691920f75f4820435f8fd9e8922e4c6a5f7c70ab2e69bd69fe448
bin=$(fetch_tool zizmor "$ZIZMOR_VERSION" \
  "$ZIZMOR_TARBALL_SHA256" "$ZIZMOR_BINARY_SHA256" \
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
