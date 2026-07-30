#!/usr/bin/env bash
# Guard: GitHub Actions workflows stay valid (actionlint).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh

ACTIONLINT_VERSION=1.7.12
# Tarball hash from the release's actionlint_${ACTIONLINT_VERSION}_checksums.txt;
# binary hash recorded from that tarball (see fetch_tool in lib.sh).
ACTIONLINT_TARBALL_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
ACTIONLINT_BINARY_SHA256=c872d6db8c6bf83a8eaa704fc93999f027d55dffbc63b8a6abdccb47df5f4cd4
bin=$(fetch_tool actionlint "$ACTIONLINT_VERSION" \
  "$ACTIONLINT_TARBALL_SHA256" "$ACTIONLINT_BINARY_SHA256" \
  "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" \
  -xz actionlint)
"$bin" -color
