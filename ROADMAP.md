# Guardrails Roadmap

Phased plan for the quality gates that let AI-written code merge without human review. Each gate lands as a **required status check** on `main`.

**Principles**

- **Ratchet, don't relax** — thresholds start moderate and only tighten. Lint suppressions (`//nolint`, `eslint-disable`) require a written justification, enforced by the linter itself; `ratchet-check` enforces the principle itself, holding every limit, enabled-linter count and suppression total against a committed baseline so that lowering a bar is a visible line in a diff rather than a config tweak nobody sees.
- **Same gate, both languages** — patch coverage uses `diff-cover` over Cobertura XML from both Go and TypeScript.
- **Per-PR gates are fast** — expensive analysis (mutation testing, CodeQL) runs on a schedule and reports via issues, keeping the 2-core runner responsive.

## Phase 1 — Stack-agnostic guards ✅

| Check | Tool | Enforces |
|---|---|---|
| `secret-scan` | gitleaks | No credentials in git history |
| `workflow-lint` | actionlint | The CI itself stays valid |
| `pr-guard` | bash | PR ≤ 1000 lines / 30 files — small increments |
| `pr-title` | bash | Conventional Commit PR titles (squash commit hygiene) |
| `workflow-security` | zizmor | Actions security: template injection, unpinned refs, credential exposure |
| `dup-check` | jscpd | Copy-paste duplication ≤ 2% |
| `dependency-review` | dependency-review-action | No known-vulnerable dependencies enter via PRs |
| `parity-check` | bash | Every CI guard has a local pre-push counterpart (or a justified pass-through) |

Plus: all actions pinned to commit SHAs; Dependabot keeps them fresh.

These guards also run **locally on pre-push** (`scripts/local-guards.sh`, shared with CI via `scripts/guards/`), before the AI review — a doomed push costs no reviewer tokens and no runner cycles. CI remains the enforcing backstop.

## Phase 2 — Go engine gates ✅

| Check | Tool | Enforces |
|---|---|---|
| `go-lint` | golangci-lint v2 | Clean-code limits, security lint, architecture boundaries |
| `go-test` | go test + diff-cover | Race-free shuffled tests; **patch coverage ≥ 80%** on changed lines |
| `go-vuln` | govulncheck | No known-vulnerable Go dependencies or stdlib usage |

- **golangci-lint v2** (`engine/.golangci.yml`): `funlen` ≤ 80 lines / 50 statements, `cyclop` ≤ 12, `gocognit` ≤ 20, `nestif` ≤ 4, revive `argument-limit` 4 params, revive `file-length-limit` 600; plus `gosec`, `errorlint`, `exhaustive`, `bodyclose`, `unparam`, `nolintlint` (every suppression needs a written reason), `prealloc`, `makezero`, `errchkjson`, `testifylint`; `gofumpt` + `gci` formatting (deterministic import order). Test files exempt from length/complexity rules.
  - Length limits sit above the original sketch (60/400): Go's explicit `if err != nil` handling spends lines without adding complexity, so `cyclop`/`gocognit` are the real complexity gates and length only catches the egregious. Tuned before enforcement began, not relaxed after — the ratchet holds.
- **`depguard`** — architecture boundary: the engine must not import `net/http`; transport belongs to a future api layer with its own rules.
- **Tests** — `go test -race -shuffle=on`; coverage → `gocover-cobertura` → `diff-cover`, the same patch-coverage mechanism phase 3 will reuse for TypeScript.
- Deliberately **not** included: `nilaway` (see phase 4) — no versioned releases and a known false-positive rate make it wrong for a required check under "ratchet, don't relax".

## Phase 3 — TypeScript / Next.js gates ✅

| Check | Tool | Enforces |
|---|---|---|
| `web-lint` | tsc + ESLint + knip | Strict types, clean-code limits, a11y/hooks/security lint, no dead code |
| `web-test` | vitest + diff-cover | Component and unit tests; **patch coverage ≥ 80%** on changed lines |
| `web-build` | next build + bundle budget | The app builds; each route's first-load JS ≤ **250 kB gzipped** |

- **`tsc --noEmit`** with `strict` + `noUncheckedIndexedAccess`.
- **ESLint 9** (`web/eslint.config.mjs`): typescript-eslint strict + stylistic type-checked, Next core-web-vitals, react-hooks (`exhaustive-deps`), jsx-a11y, sonarjs, security, eslint-comments. Limits: `complexity` ≤ 12, `max-depth` ≤ 4, `max-params` 4, `max-lines` ≤ 400, `max-lines-per-function` ≤ 60 — raised to **150 for `.tsx`**: JSX is declarative markup that outgrows 60 lines without gaining branching, so cognitive complexity (≤ 15) and `max-depth` stay the real guards there. Tuned before enforcement began, not relaxed after — the ratchet holds. Every suppression needs a written reason (`eslint-comments/require-description`, mirroring Go's `nolintlint`); test files exempt from length/complexity rules, like Go.
- **`knip`** — dead exports and unused dependencies (AI leaves corpses).
- **Vitest** (jsdom + testing-library) → Cobertura → the same `diff-cover` ≥ 80% patch gate as Go, with the same report-path assertion against vacuous passes.
- **`next build`** + first-load budget: gzipped JS per prerendered route, measured from the route's actual script tags (survives Next's manifest reshuffles). Budget 250 kB against a measured 181 kB framework floor — complexity limits don't stop a 2 MB chart import; this does. Ratchets down, never up.
- **Toolchain**: Node pinned by SHA-256 into the same tool cache as the Go binaries (`scripts/guards/web-env.sh`); vulnerable transitive pins (`postcss`, `sharp`) patched via npm `overrides` the day `dependency-review` flagged them.
- Deferred until real server code lands: module boundaries (`dependency-cruiser`) and `server-only` poisoning of server modules — the rules are specified in [ARCHITECTURE.md](ARCHITECTURE.md).

## Phase 4 — Deeper correctness (scheduled, not per-PR)

Every gate above checks *how* code is written. None of them check that it does
what was asked — coverage, lint and type checks are all satisfied by code that
confidently implements the wrong thing. This phase is about narrowing that,
and it runs on a schedule because it is too slow for a two-core runner to do
per PR.

- **Property-based tests** (`pgregory.net/rapid` for Go, `fast-check` for TS)
  over the simulation core. Properties are written against the spec rather
  than the implementation, so they do not inherit the bug the implementation
  has — the closest thing to a correctness oracle that can be automated.
- **Mutation testing** — weekly; surviving mutants become issues. It proves the
  coverage gate measures real assertions rather than test theater. StrykerJS
  first: it supports incremental runs and has a usable baseline. Go's options
  are weaker — `gremlins` has no diff mode, no baseline file and no coverage
  filtering, so it needs real integration work and stays scoped to changed
  packages.
- **Semgrep** with rules for this repository's own escaped bugs. Worth being
  clear about why they have to be written here: the off-the-shelf "AI" rule
  packs target code that *calls* an LLM — hardcoded provider keys, prompt
  injection sinks — not code an LLM *wrote*. Nothing off the shelf covers the
  latter. Seed it empirically: every time a bug reaches `main`, add the rule.
- **CodeQL** on GitHub-hosted runners (free for public repos, and it keeps the
  self-hosted box free — the same pattern `scorecard.yml` already uses).
  Overlaps `gosec` and `eslint-plugin-security` on
  single-function patterns, but adds cross-file taint tracking that neither
  has.
- **nilaway** (Uber) — interprocedural nil-flow analysis, which golangci-lint
  cannot do. Advisory rather than required: it ships without versioned releases
  and with a documented false-positive rate, and *ratchet, don't relax* means a
  required check has to be one we will never be tempted to switch off.
- **Playwright** smoke E2E once the app has a UI.
- **Tool freshness.** Dependabot covers Actions, Go modules and npm, but not the
  dozen hand-pinned tool versions in `scripts/guards/`. A stale `gitleaks` or
  `govulncheck` degrades coverage with no signal at all.

## Phase 5 — AI review loop ✅

- `scripts/ai-review.sh` — spawns a headless AI reviewer (`claude -p`) over the branch diff against `origin/main`, with read-only repo access (Read/Grep/Glob) in a clean worktree of the reviewed sha, writing findings to a gitignored `AI_REVIEW.md`; exits non-zero unless the verdict is APPROVE, so the coding agent reads it and fixes issues *before* opening the PR. Enable as a push gate with `git config core.hooksPath .githooks`, or invoke explicitly.
- [`AGENTS.md`](AGENTS.md) — the contract for coding agents: small PRs, conventional titles, run the review loop, never touch guardrail configs outside a `ci:`-titled PR.

*(Implemented out of order — it needs no product code, unlike phases 2–4.)*

## Phase 6 — Guarding the guards ✅

Phases 1–3 assumed the pipeline itself was trustworthy. An audit of the
guardrails against their own threat model — AI writes the code, no human reads
it, the runner is long-lived and public — found that assumption was doing a lot
of unearned work. This phase closes what it found.

| Check | Tool | Enforces |
|---|---|---|
| `structure-check` | bash | The tree matches [ARCHITECTURE.md](ARCHITECTURE.md): package and slice allowlists, route files, colocated tests, no unlinted shell script, no orphan guard |
| `unicode-check` | bash | No invisible or direction-changing Unicode in tracked text |
| `dep-scan` | osv-scanner | Malicious (`MAL-`) and vulnerable packages across **both** lockfiles, re-checked every run |

And, inside the checks that already existed:

- **`parity-check` proves each job runs its own guard.** It compared job *names*
  before. Job names are what the ruleset requires, so a change that kept the name
  and replaced the body — `run: true`, a different script — passed every required
  check while enforcing nothing, including the meta-guard meant to notice exactly
  that. The naming convention is now load-bearing; `dependency-review` is the one
  documented exception.
- **Pinned tool binaries are verified by checksum on every run,** not only on
  download. CI runs PR code on a long-lived runner whose tool cache outlives the
  job, so a single malicious run could otherwise replace `gitleaks` or `zizmor`
  with a binary that exits 0 and silently disarm those gates for every later PR.
- **`ignore-scripts=true`** — an install script in any transitive npm dependency
  is arbitrary code execution on that same runner, and is how most npm
  supply-chain attacks are actually delivered.
- **`lockfile-lint`** — the lockfile is machine-generated and excluded from both
  the size guard and the AI reviewer's diff, making it the least-observed file in
  the repository. Every entry must resolve to the npm registry over https with an
  integrity hash.
- **Dependabot cooldown** (7 days, 14 for npm) — the window in which a malicious
  release is typically found and yanked. Security updates stay exempt.
- **`go mod tidy -diff`** — an import of a module that was never required is the
  shape a hallucinated dependency takes, and `go build` would fix it up in place
  rather than complain.
- **Import boundaries in ESLint**, mirroring the engine's `depguard` rules, plus
  a ban on importing any `*.test.*` file: test files are exempt from the length,
  complexity *and* coverage gates, so importing one moves product logic outside
  all three.
- **Test-quality lint** — `vitest/expect-expect` and friends, `thelper`,
  `tparallel`, `usetesting`, `nilerr`, and a ban on `t.Skip`. Coverage measures
  which lines ran, not whether anything was checked; a test that executes code and
  asserts nothing is the most common way an AI-written suite reports health it has
  not earned.

**Scoped execution.** Language gates now exit early when no changed file is in
their scope, so a front-end PR does not pay for the Go toolchain and vice versa.
The skip lives inside the guard rather than in a workflow `paths:` filter,
because a required check that never *reports* leaves auto-merge waiting forever.

**Tests for the guards themselves.** Every guard added here has a suite with a
negative case per rule, because they share one failure mode: a guard that
silently matches nothing looks exactly like a guard that passes.
