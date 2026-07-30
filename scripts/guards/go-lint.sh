#!/usr/bin/env bash
# Guard: Go clean-code and security lint (golangci-lint v2, engine/.golangci.yml).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh
# Nothing to do when the change cannot affect this gate.
guard_applies go-lint "$GO_GUARD_SCOPE" || exit 0

# shellcheck disable=SC1091
. scripts/guards/go-env.sh
ensure_go

GOLANGCI_VERSION=2.12.2
# Tarball hash from the release's golangci-lint-${GOLANGCI_VERSION}-checksums.txt;
# binary hash recorded from that tarball (see fetch_tool in lib.sh).
GOLANGCI_TARBALL_SHA256=8df580d2670fed8fa984aac0507099af8df275e665215f5c7a2ae3943893a553
GOLANGCI_BINARY_SHA256=e26335d9bd381a60e5769a13b0ccc7967db5b6fb9c39a896a1f6fd0befe0a661
bin=$(fetch_tool golangci-lint "$GOLANGCI_VERSION" \
  "$GOLANGCI_TARBALL_SHA256" "$GOLANGCI_BINARY_SHA256" \
  "https://github.com/golangci/golangci-lint/releases/download/v${GOLANGCI_VERSION}/golangci-lint-${GOLANGCI_VERSION}-linux-amd64.tar.gz" \
  -xz)

cd engine
"$bin" config verify
"$bin" run ./...
