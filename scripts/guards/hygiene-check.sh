#!/usr/bin/env bash
# Guard: nothing enters the repository that nobody can review.
#
# structure-check says where a file may live; this says what it may be. The
# two are different questions, and every rule below covers something the rest
# of the pipeline is blind to:
#
#   binary content   a compiled artefact, a captured fixture, a stray archive.
#                    No diff, no review, no way to tell what is inside it. On a
#                    repository whose premise is that automated checks replace
#                    reading the code, an unreadable file is a hole in the
#                    premise — and one an agent opens by accident, committing
#                    a build output it produced while testing.
#
#   size             a file nobody will read is unreviewable for the same
#                    reason, without needing to be binary.
#
#   conflict markers a half-resolved merge that happens to parse. Nothing else
#                    here would catch one inside a comment, a string, or a
#                    Markdown file.
#
#   CRLF             invisible in a diff, but it changes the bytes of every
#                    line, so the next real change reads as a rewrite.
#
#   no final newline the same problem, one line at a time, forever.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Overridable so the test suite can state a small limit instead of generating a
# quarter of a megabyte. The default is what ratchet-check holds to account.
MAX_BYTES="${MAX_FILE_BYTES:-262144}"

# Machine-generated lockfiles are exempt from the size limit only. They are
# read as data by lockfile-lint and dep-scan rather than by a person, and their
# size is a property of the dependency tree, not of anything anyone wrote.
LOCKFILES='(^|/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum)$'

# Files that are legitimately binary. Empty on purpose: there are none today,
# and a new entry should have to be argued for in the pull request that adds
# it. An icon or a font is a fine reason; a build output is not.
BINARY_ALLOWED=()

CONFLICT_MARKERS='^(<{7}|>{7}|\|{7})[ \t]'

fail=0
report() {
  echo "guards: $1" >&2
  echo "guards:   $2" >&2
  fail=1
}

while IFS= read -r -d '' path; do
  # Skip anything git lists but the working tree does not have as a real file:
  # a staged deletion, or a symlink pointing outside the checkout.
  [ -f "$path" ] || continue
  bytes=$(stat -c %s "$path")
  [ "$bytes" -gt 0 ] || continue

  # grep -I treats a binary file as non-matching, so searching for '.' fails on
  # exactly the files git itself would refuse to show as a diff.
  if ! grep -qI . "$path" 2>/dev/null; then
    allowed=0
    for entry in ${BINARY_ALLOWED[@]+"${BINARY_ALLOWED[@]}"}; do
      [ "$entry" != "$path" ] || allowed=1
    done
    if [ "$allowed" -eq 0 ]; then
      report "$path is binary — nothing can review it" \
        "if it must be here (an icon, a font), add it to BINARY_ALLOWED in $0 and say why in the pull request; if it is a build output, it belongs in .gitignore"
      continue
    fi
  fi

  if [ "$bytes" -gt "$MAX_BYTES" ] && ! [[ $path =~ $LOCKFILES ]]; then
    report "$path is $bytes bytes, over the $MAX_BYTES limit" \
      "a file this size is not going to be read, which is the same problem as a binary one — split it, generate it, or ignore it"
  fi

  if grep -qE "$CONFLICT_MARKERS" "$path"; then
    report "$path contains merge conflict markers" \
      "$(grep -nE "$CONFLICT_MARKERS" "$path" | head -3 | tr '\n' ' ')"
  fi

  if grep -qU $'\r$' "$path"; then
    report "$path has CRLF line endings" \
      "invisible in a diff, and it makes every later change to the file read as a rewrite of all of it"
  fi

  if [ "$(tail -c1 "$path" | wc -l)" -eq 0 ]; then
    report "$path does not end with a newline" \
      "the next edit to its last line then shows up as two changed lines instead of one"
  fi
done < <(git ls-files -z)

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "guards: every tracked file is text, readable, and cleanly terminated"
