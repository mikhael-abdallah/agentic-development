#!/usr/bin/env bash
# Guard: web static gates — TypeScript strict mode (tsc --noEmit), ESLint
# clean-code limits (web/eslint.config.mjs), and knip dead-code detection.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh
# shellcheck disable=SC1091
. scripts/guards/web-env.sh
ensure_node
ensure_web_deps

cd web
npm run -s typecheck
npm run -s lint
npm run -s knip
