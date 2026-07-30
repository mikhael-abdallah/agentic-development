#!/usr/bin/env bash
# Guard: web static gates — TypeScript strict mode (tsc --noEmit), ESLint
# clean-code limits (web/eslint.config.mjs), and knip dead-code detection.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh
# Nothing to do when the change cannot affect this gate.
guard_applies web-lint "$WEB_GUARD_SCOPE" || exit 0

# shellcheck disable=SC1091
. scripts/guards/web-env.sh
ensure_node
ensure_web_deps

LOCKFILE_LINT_VERSION=5.0.0

cd web
npm run -s typecheck
npm run -s lint
npm run -s knip

# The lockfile decides what npm ci actually fetches, and it is excluded from
# the size guard and from the AI reviewer's diff because it is machine
# generated. That makes a hand-edited entry — a substituted registry host, an
# http:// tarball, a package name that only looks familiar — the least
# observed change anyone could make here. lockfile-lint reads it as data.
npx --yes lockfile-lint@$LOCKFILE_LINT_VERSION \
  --path package-lock.json --type npm \
  --allowed-hosts npm --validate-https --validate-integrity --validate-package-names
