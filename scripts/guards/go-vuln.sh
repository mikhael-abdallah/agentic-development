#!/usr/bin/env bash
# Guard: known vulnerabilities in Go dependencies or stdlib usage (govulncheck).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh
# shellcheck disable=SC1091
. scripts/guards/go-env.sh
ensure_go

GOVULNCHECK_VERSION=v1.6.0
go -C engine run "golang.org/x/vuln/cmd/govulncheck@$GOVULNCHECK_VERSION" ./...
