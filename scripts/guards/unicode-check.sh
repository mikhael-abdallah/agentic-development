#!/usr/bin/env bash
# Guard: no invisible or direction-changing Unicode in tracked text.
#
# This repository is read by AI agents as a matter of routine — AGENTS.md,
# ARCHITECTURE.md, code comments, PR bodies quoted into a diff. That makes
# text a delivery surface, not just documentation. Characters in the ranges
# below render as nothing (or reorder what surrounds them), so a line can say
# one thing on screen and carry another instruction to whatever reads the
# bytes. The same trick hides a backdoor from a human reviewer: Trojan Source
# (CVE-2021-42574) reorders a comment and a statement so the code executes in
# a different order than it reads.
#
# Nothing legitimate here needs them. Emoji, accents and non-Latin scripts are
# all unaffected — the ranges are specifically the invisible and the
# bidirectional-override ones.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# U+200B-200F  zero-width space/non-joiner/joiner, LTR/RTL marks
# U+202A-202E  bidirectional embedding and override
# U+2060-2064  word joiner and invisible operators
# U+2066-2069  bidirectional isolates
# U+FEFF       zero-width no-break space (byte-order mark)
# U+E0000-E007F  Unicode tag characters: an entire ASCII alphabet that renders
#                as nothing at all
#
# Written as code points rather than as themselves, for the obvious reason —
# this guard's first catch was this comment block.
readonly INVISIBLE='[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{2066}-\x{2069}\x{FEFF}\x{E0000}-\x{E007F}]'

# -I skips binary files; -n reports the line so the finding is actionable.
hits=$(git ls-files -z |
  LC_ALL=C.UTF-8 xargs -0 grep -PIn "$INVISIBLE" 2>/dev/null || true)

if [ -n "$hits" ]; then
  echo "guards: invisible or direction-changing Unicode found in tracked text:" >&2
  # Show the offending code points; the characters themselves print as nothing.
  while IFS= read -r hit; do
    echo "  $hit" >&2
    printf '    code points: '
    printf '%s' "${hit#*:*:}" |
      LC_ALL=C.UTF-8 grep -Po "$INVISIBLE" |
      while IFS= read -r ch; do
        printf 'U+%04X ' "$(printf '%s' "$ch" | iconv -f UTF-8 -t UTF-32LE |
          od -An -tu4 | tr -d ' ')"
      done
    echo
  done <<< "$hits" >&2
  echo "guards: these render as nothing (or reorder what surrounds them), so the" \
    "text can read one way and mean another — remove them" >&2
  exit 1
fi

echo "guards: no invisible Unicode in tracked text"
