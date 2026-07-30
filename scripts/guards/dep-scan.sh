#!/usr/bin/env bash
# Guard: no known-malicious or known-vulnerable package in either lockfile.
#
# This overlaps dependency-review and go-vuln deliberately, because each of
# them is blind where this one is not:
#
#  - dependency-review only inspects packages a PR *changes*, so anything that
#    was already in the tree when an advisory appeared is never re-examined.
#  - both work from advisories about *vulnerable* code. OSV also carries the
#    MAL- feed: packages that are malicious rather than merely buggy. A
#    slopsquatted or hijacked package has no CVE, because the package is not
#    vulnerable — it is the attack. That is precisely the failure mode of a
#    dependency an AI agent invented the name of.
#
# It re-reads the whole tree every run, so a package that becomes malicious
# after it was added is caught on the next PR rather than never.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. scripts/guards/lib.sh

OSV_SCANNER_VERSION=2.4.0
# Hash from the release's osv-scanner_SHA256SUMS.
OSV_SCANNER_SHA256=15314940c10d26af9c6649f150b8a47c1262e8fc7e17b1d1029b0e479e8ed8a0
bin=$(fetch_binary osv-scanner "$OSV_SCANNER_VERSION" "$OSV_SCANNER_SHA256" \
  "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64")

# Suppressions live in osv-scanner.toml, with a reason and an expiry date.
"$bin" scan source --config osv-scanner.toml \
  --lockfile engine/go.mod --lockfile web/package-lock.json
