#!/usr/bin/env bash
# Shared Node toolchain bootstrap for the web-* guards. Source it after
# lib.sh, then call ensure_node (pinned Node into the tool cache, same
# toolchain in CI and locally) and ensure_web_deps (npm ci for web/, skipped
# when node_modules already matches the lockfile).

NODE_VERSION=24.18.1
# Official checksum from https://nodejs.org/dist/v24.18.1/SHASUMS256.txt —
# the toolchain runs everything else, so it gets verified, not just pinned.
NODE_SHA256=9f5eb6ac21845a66c493c91a253b1da32fd684e89e9b7202d4936982336be4ca

ensure_node() {
  local dir="$TOOL_CACHE/node/$NODE_VERSION" tarball
  if [ ! -x "$dir/node-v$NODE_VERSION-linux-x64/bin/node" ]; then
    echo "guards: installing node $NODE_VERSION into $dir (first run)" >&2
    mkdir -p "$dir"
    tarball="$dir/node.tar.gz"
    if ! curl -sSfL -o "$tarball" \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz"; then
      echo "guards: failed to download node $NODE_VERSION" >&2
      return 1
    fi
    if ! echo "$NODE_SHA256  $tarball" | sha256sum -c --quiet -; then
      echo "guards: node $NODE_VERSION tarball failed checksum verification" >&2
      rm -f "$tarball"
      return 1
    fi
    tar -xzf "$tarball" -C "$dir"
    rm -f "$tarball"
  fi
  export PATH="$dir/node-v$NODE_VERSION-linux-x64/bin:$PATH"
}

# npm ci wipes node_modules on every run, which is too slow to sit in front
# of every push. Stamp the lockfile hash after a successful install and
# skip the reinstall while it still matches.
ensure_web_deps() {
  local stamp=web/node_modules/.agentic-lock-sha want have
  want=$(sha256sum web/package-lock.json | cut -d' ' -f1)
  have=$(cat "$stamp" 2>/dev/null || true)
  if [ "$want" != "$have" ]; then
    echo "guards: installing web/ dependencies (npm ci)" >&2
    (cd web && npm ci --prefer-offline --no-audit --no-fund \
      --cache "$TOOL_CACHE/npm-cache")
    printf '%s\n' "$want" > "$stamp"
  fi
}
