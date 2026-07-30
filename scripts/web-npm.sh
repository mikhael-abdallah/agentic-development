#!/usr/bin/env bash
# Run npm (or node) inside web/ with the SAME pinned toolchain the guards
# use — never the system node. A lockfile written by a different npm gets
# rejected by the guards' npm ci, so this wrapper is the only sanctioned
# way to run package commands by hand:
#
#   scripts/web-npm.sh install
#   scripts/web-npm.sh run test
#   scripts/web-npm.sh exec node --version
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/guards/lib.sh
source scripts/guards/lib.sh
# shellcheck source=scripts/guards/web-env.sh
source scripts/guards/web-env.sh

ensure_node
cd web

if [ "${1:-}" = "exec" ]; then
  shift
  exec "$@"
fi
exec npm "$@"
