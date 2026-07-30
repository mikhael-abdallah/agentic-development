#!/usr/bin/env bash
# Guard: copy-paste duplication stays under the threshold (jscpd).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if ! command -v npx >/dev/null 2>&1; then
  echo "guards: npx not found — Node.js is required to run jscpd" >&2
  exit 1
fi
# Lockfiles are machine-generated and structurally repetitive — duplication
# there says nothing about the code.
npx --yes jscpd@5.0.14 --threshold 2 --min-tokens 50 \
  --ignore "**/.git/**,**/package-lock.json,**/npm-shrinkwrap.json,**/yarn.lock,**/pnpm-lock.yaml" .
