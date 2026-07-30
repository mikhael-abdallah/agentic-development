#!/usr/bin/env bash
# Justified CI-only guard (parity-check pass-through): dependency-review
# needs the GitHub API's view of the PR's dependency diff, which doesn't
# exist at pre-push time. The CI job enforces it; locally it passes by design.
set -euo pipefail
echo "guards: dependency-review is CI-only (needs the GitHub API PR diff) — nothing to check locally"
