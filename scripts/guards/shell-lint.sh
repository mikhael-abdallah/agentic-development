#!/usr/bin/env bash
# Guard: shell scripts lint clean (shellcheck) and the ai-review gate's
# test suite passes (with a stubbed claude — no real reviewer involved).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh

SHELLCHECK_VERSION=0.11.0
bin=$(fetch_tool shellcheck "$SHELLCHECK_VERSION" \
  "https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.linux.x86_64.tar.xz" \
  -xJ)
"$bin" scripts/*.sh scripts/guards/*.sh scripts/tests/*.sh .githooks/*
scripts/tests/ai-review-test.sh
