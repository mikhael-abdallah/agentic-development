#!/usr/bin/env bash
# Guard: no credentials anywhere in git history (gitleaks).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh

GITLEAKS_VERSION=8.30.1
bin=$(fetch_tool gitleaks "$GITLEAKS_VERSION" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
  -xz gitleaks)
"$bin" git --no-banner --redact .
