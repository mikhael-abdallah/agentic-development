#!/usr/bin/env bash
# Guard: shell scripts lint clean (shellcheck) and the ai-review gate's
# test suite passes (with a stubbed claude — no real reviewer involved).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh

SHELLCHECK_VERSION=0.11.0
# ShellCheck publishes no checksum file, so both hashes were recorded from the
# release asset. Pinning them still detects a re-uploaded asset and a tampered
# tool cache — it is not an independent upstream attestation. (The tool's name
# is capitalised here so the line is not parsed as a shellcheck directive.)
SHELLCHECK_TARBALL_SHA256=8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198
SHELLCHECK_BINARY_SHA256=4da528ddb3a4d1b7b24a59d4e16eb2f5fd960f4bd9a3708a15baddbdf1d5a55b
bin=$(fetch_tool shellcheck "$SHELLCHECK_VERSION" \
  "$SHELLCHECK_TARBALL_SHA256" "$SHELLCHECK_BINARY_SHA256" \
  "https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.linux.x86_64.tar.xz" \
  -xJ)
"$bin" scripts/*.sh scripts/guards/*.sh scripts/tests/*.sh .githooks/*

# Every file in scripts/tests/ runs, rather than a hand-listed few — a new
# test suite is picked up by existing, and cannot be left orphaned.
for suite in scripts/tests/*.sh; do
  echo "── $suite"
  "$suite"
done
