#!/usr/bin/env bash
# Guard: no credentials anywhere in git history (gitleaks).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh

GITLEAKS_VERSION=8.30.1
# Tarball hash from the release's gitleaks_${GITLEAKS_VERSION}_checksums.txt;
# binary hash recorded from that tarball (see fetch_tool in lib.sh).
GITLEAKS_TARBALL_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
GITLEAKS_BINARY_SHA256=88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509
bin=$(fetch_tool gitleaks "$GITLEAKS_VERSION" \
  "$GITLEAKS_TARBALL_SHA256" "$GITLEAKS_BINARY_SHA256" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
  -xz gitleaks)
"$bin" git --no-banner --redact .
