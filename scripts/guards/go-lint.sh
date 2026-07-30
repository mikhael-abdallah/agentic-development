#!/usr/bin/env bash
# Guard: Go clean-code and security lint (golangci-lint v2, engine/.golangci.yml).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh
# shellcheck disable=SC1091
. scripts/guards/go-env.sh
ensure_go

GOLANGCI_VERSION=2.12.2
bin=$(fetch_tool golangci-lint "$GOLANGCI_VERSION" \
  "https://github.com/golangci/golangci-lint/releases/download/v${GOLANGCI_VERSION}/golangci-lint-${GOLANGCI_VERSION}-linux-amd64.tar.gz" \
  -xz)

cd engine
"$bin" config verify
"$bin" run ./...
