#!/usr/bin/env bash
# Guard: GitHub Actions workflows stay valid (actionlint).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh

ACTIONLINT_VERSION=1.7.12
bin=$(fetch_tool actionlint "$ACTIONLINT_VERSION" \
  "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" \
  -xz actionlint)
"$bin" -color
