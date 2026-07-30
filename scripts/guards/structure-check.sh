#!/usr/bin/env bash
# Guard: the repository layout matches ARCHITECTURE.md.
#
# ARCHITECTURE.md says where every kind of file belongs; this turns that
# document into a check. Agents place new files by pattern-matching on what
# they already see, so an unenforced layout drifts within a few PRs — and once
# it drifts, everything built on top of it stops meaning anything: depguard's
# per-directory import rules match nothing, feature slices bleed into each
# other, and shell scripts appear in directories no linter globs.
#
# The allowlists below are deliberately narrow. Adding a Go package or a web
# feature slice is meant to be an explicit edit here alongside the
# ARCHITECTURE.md change that describes it — in the same PR, where the choice
# is visible — rather than something that happens by accident.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Only tracked files are checked: build output, node_modules and the local
# gitignored notes are not part of the repository's structure.
mapfile -t files < <(git ls-files)

fail=0
violation() {
  echo "structure: $1" >&2
  if [ $# -gt 1 ]; then
    echo "structure:   $2" >&2
  fi
  fail=1
}

# in_list ITEM NAME_OF_ARRAY — membership test against a named array.
in_list() {
  local item=$1 entry
  local -n haystack=$2
  for entry in "${haystack[@]}"; do
    [ "$entry" != "$item" ] || return 0
  done
  return 1
}

# paths_under PREFIX — tracked files below PREFIX, with PREFIX stripped.
paths_under() {
  local prefix=$1 path
  for path in "${files[@]}"; do
    case "$path" in "$prefix"*) printf '%s\n' "${path#"$prefix"}" ;; esac
  done
}

# --- top level ---------------------------------------------------------------

TOP_DIRS=(engine web scripts docs .github .githooks)
TOP_FILES=(AGENTS.md ARCHITECTURE.md LICENSE README.md ROADMAP.md SECURITY.md
  osv-scanner.toml .editorconfig .gitattributes .gitignore)

check_top_level() {
  local path name
  local -A seen=()
  for path in "${files[@]}"; do
    case "$path" in
      */*)
        name=${path%%/*}
        [ -z "${seen[dir:$name]:-}" ] || continue
        seen[dir:$name]=1
        in_list "$name" TOP_DIRS ||
          violation "unexpected top-level directory '$name/'" \
            "allowed: ${TOP_DIRS[*]}"
        ;;
      *)
        in_list "$path" TOP_FILES ||
          violation "unexpected top-level file '$path'" \
            "allowed: ${TOP_FILES[*]}"
        ;;
    esac
  done
}

# --- engine ------------------------------------------------------------------

ENGINE_ROOT_FILES=(go.mod go.sum .golangci.yml)
# ARCHITECTURE.md: the pure core and its adapters. Nothing else appears here
# without that document changing too.
# shellcheck disable=SC2034 # reached through a nameref in check_engine_dir
ENGINE_PACKAGES=(model sim api)
# shellcheck disable=SC2034 # reached through a nameref in check_engine_dir
ENGINE_BINARIES=(engined simwasm)

# check_engine_dir SUBDIR REST ALLOWED_ARRAY LABEL — shared by internal/ and
# cmd/, which differ only in what they hold.
check_engine_dir() {
  local subdir=$1 rest=$2 label=$4 name=${2%%/*}
  local -n allowed=$3
  if [ "$name" = "$rest" ]; then
    violation "engine/$subdir/$rest sits outside any $label directory" \
      "it belongs in engine/$subdir/<$label>/"
    return
  fi
  in_list "$name" "$3" ||
    violation "unknown $label 'engine/$subdir/$name/'" \
      "allowed: ${allowed[*]} — add one here and in ARCHITECTURE.md together"
}

check_engine() {
  local path
  while IFS= read -r path; do
    case "$path" in
      internal/*) check_engine_dir internal "${path#internal/}" ENGINE_PACKAGES package ;;
      cmd/*) check_engine_dir cmd "${path#cmd/}" ENGINE_BINARIES binary ;;
      */*)
        violation "engine/$path is outside cmd/ and internal/" \
          "engine code lives in engine/internal/ (or engine/cmd/ for binaries)"
        ;;
      *)
        in_list "$path" ENGINE_ROOT_FILES ||
          violation "unexpected file 'engine/$path'" \
            "allowed at the engine root: ${ENGINE_ROOT_FILES[*]}"
        ;;
    esac
  done < <(paths_under 'engine/')
}

# --- web ---------------------------------------------------------------------

WEB_SRC_DIRS=(app components features lib server)
# ARCHITECTURE.md's vertical slices — same rule as the Go packages.
WEB_FEATURES=(canvas palette inspector simulation)
# Next.js reserves these filenames inside app/. Anything else in a route
# directory is a component or helper, which belongs in a feature slice.
NEXT_ROUTE_FILES=(layout page loading error global-error not-found template
  default route forbidden unauthorized robots sitemap manifest
  icon apple-icon opengraph-image twitter-image)

check_web_root() {
  local path
  while IFS= read -r path; do
    case "$path" in
      src/* | public/*) ;;
      */*)
        violation "web/$path is outside src/ and public/" \
          "application code lives in web/src/"
        ;;
      package.json | package-lock.json | tsconfig.json | knip.json | \
        next-env.d.ts | .npmrc | .gitignore | \
        *.config.ts | *.config.mts | *.config.mjs) ;;
      *)
        violation "unexpected file 'web/$path'" \
          "the web root holds manifests, dotfiles and *.config.* only"
        ;;
    esac
  done < <(paths_under 'web/')
}

# check_web_app_file PATH — PATH is relative to web/src/app/.
check_web_app_file() {
  local path=$1 base
  base=$(basename "$path")
  case "$base" in
    *.css | favicon.ico) return ;;
  esac
  base=${base%.*}    # drop the extension
  base=${base%.test} # a colocated test of a route file is still one
  in_list "$base" NEXT_ROUTE_FILES ||
    violation "web/src/app/$path is not a Next.js route file" \
      "app/ holds routes only (${NEXT_ROUTE_FILES[*]}); components and logic belong in features/ or components/"
}

check_web_src() {
  local path top rest slice
  while IFS= read -r path; do
    top=${path%%/*}
    if ! in_list "$top" WEB_SRC_DIRS; then
      violation "unexpected directory 'web/src/$top/'" "allowed: ${WEB_SRC_DIRS[*]}"
      continue
    fi
    case "$path" in
      *.js | *.jsx | *.mjs | *.cjs)
        violation "web/src/$path is JavaScript" \
          "the web app is TypeScript; a .js file skips tsc entirely"
        ;;
    esac
    case "$path" in
      __tests__/* | tests/* | */__tests__/* | */tests/*)
        violation "web/src/$path is in a separate test directory" \
          "tests are colocated: foo.ts beside foo.test.ts"
        ;;
    esac
    if [ "$top" = features ]; then
      rest=${path#features/}
      slice=${rest%%/*}
      if [ "$slice" = "$rest" ]; then
        violation "web/src/features/$rest is not inside a slice" \
          "every file belongs to a feature directory"
      elif ! in_list "$slice" WEB_FEATURES; then
        violation "unknown feature slice 'web/src/features/$slice/'" \
          "allowed: ${WEB_FEATURES[*]} — add one here and in ARCHITECTURE.md together"
      fi
    fi
    [ "$top" != app ] || check_web_app_file "${path#app/}"
  done < <(paths_under 'web/src/')
}

# Every test sits beside the module it tests. When a test's subject is renamed
# or moved and the test is not, the test keeps passing while covering nothing,
# and patch coverage cannot tell the difference.
check_colocated_tests() {
  local path stem
  for path in "${files[@]}"; do
    case "$path" in web/src/*.test.ts | web/src/*.test.tsx) ;; *) continue ;; esac
    stem=${path%.test.*}
    [ -f "$stem.ts" ] || [ -f "$stem.tsx" ] ||
      violation "$path has no module beside it" "expected $stem.ts or $stem.tsx"
  done
}

# --- the guardrails themselves -----------------------------------------------

# shell-lint globs scripts/*.sh, scripts/guards/*.sh and scripts/tests/*.sh,
# non-recursively. A script one directory deeper would never be shellchecked,
# which is the quiet way to end up with an unreviewed guard.
check_shell_layout() {
  local path
  for path in "${files[@]}"; do
    case "$path" in *.sh) ;; *) continue ;; esac
    case "$(dirname "$path")" in
      scripts | scripts/guards | scripts/tests) ;;
      *)
        violation "$path is not in a directory shell-lint globs" \
          "shell scripts live directly in scripts/, scripts/guards/ or scripts/tests/"
        ;;
    esac
  done
}

# A guard nobody calls is a guard that silently stopped guarding. Every file in
# scripts/guards/ must be reachable: run by local-guards.sh, referenced by a
# workflow, or sourced by another guard (lib.sh, the *-env.sh bootstraps).
check_no_orphan_guards() {
  local path name
  for path in "${files[@]}"; do
    case "$path" in scripts/guards/*) ;; *) continue ;; esac
    name=$(basename "$path")
    grep -qF "$name" scripts/local-guards.sh && continue
    grep -rqF "$name" .github/workflows/ && continue
    grep -rqF "$name" scripts/guards/ --exclude="$name" && continue
    violation "$path is never invoked" \
      "wire it into scripts/local-guards.sh, or delete it"
  done
}

check_top_level
check_engine
check_web_root
check_web_src
check_colocated_tests
check_shell_layout
check_no_orphan_guards

if [ "$fail" -ne 0 ]; then
  echo "structure: layout does not match ARCHITECTURE.md" >&2
  exit 1
fi
echo "structure: layout matches ARCHITECTURE.md (${#files[@]} tracked files)"
