#!/usr/bin/env bash
# Guard: the app builds, and every route's first-load JS stays within the
# gzipped bundle budget — complexity gates don't stop a 2 MB import for a
# sparkline; this does.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh
# shellcheck disable=SC1091
. scripts/guards/web-env.sh
ensure_node
ensure_web_deps

cd web
npm run -s build
node ../scripts/guards/bundle-budget.mjs
