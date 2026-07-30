#!/usr/bin/env bash
# Shared Go toolchain bootstrap for the go-* guards. Source it after lib.sh,
# then call ensure_go: installs the pinned Go release into the tool cache
# (CI's RUNNER_TOOL_CACHE, or ~/.cache/agentic-tools locally) on first use
# and prepends it to PATH — CI and local runs get the exact same toolchain.

GO_VERSION=1.26.5
# Official checksum from https://go.dev/dl/ — the toolchain runs everything
# else, so it gets verified, not just pinned.
GO_SHA256=5c2c3b16caefa1d968a94c1daca04a7ca301a496d9b086e17ad77bb81393f053

ensure_go() {
  local dir="$TOOL_CACHE/go/$GO_VERSION" tarball
  if [ ! -x "$dir/go/bin/go" ]; then
    echo "guards: installing go $GO_VERSION into $dir (first run)" >&2
    mkdir -p "$dir"
    tarball="$dir/go.tar.gz"
    if ! curl -sSfL -o "$tarball" "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"; then
      echo "guards: failed to download go $GO_VERSION" >&2
      return 1
    fi
    if ! echo "$GO_SHA256  $tarball" | sha256sum -c --quiet -; then
      echo "guards: go $GO_VERSION tarball failed checksum verification" >&2
      rm -f "$tarball"
      return 1
    fi
    tar -xzf "$tarball" -C "$dir"
    rm -f "$tarball"
  fi
  export PATH="$dir/go/bin:$PATH"
}
