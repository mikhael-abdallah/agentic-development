# Guardrails Roadmap

Phased plan for the quality gates that let AI-written code merge without human review. Each gate lands as a **required status check** on `main`.

**Principles**

- **Ratchet, don't relax** — thresholds start moderate and only tighten. Lint suppressions (`//nolint`, `eslint-disable`) require a written justification, enforced by the linter itself.
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

## Phase 3 — TypeScript / Next.js gates (when frontend lands)

- **`tsc --noEmit`** with `strict` + `noUncheckedIndexedAccess`.
- **ESLint** (typescript-eslint, type-checked): `complexity` ≤ 12, `max-lines-per-function` ≤ 60, `max-params` 4, `max-lines` ~400, `max-depth` 4, sonarjs cognitive complexity, `no-explicit-any` as error.
- **`knip`** — dead code, unused exports and dependencies.
- **Vitest** coverage → same `diff-cover` patch gate (≥ 80% on changed lines).
- **`next build`** as a required check; module boundaries via `dependency-cruiser`.

## Phase 4 — Deeper correctness (scheduled, not per-PR)

- **Mutation testing** (Stryker for TS, gremlins for Go) — weekly; surviving mutants become issues. Proves the coverage gate measures real assertions, not test theater.
- **Semgrep** with custom rules for AI failure modes: swallowed errors, `panic()` in library code, TODOs without an issue link.
- **nilaway** (Uber) — nil-panic static analysis over the Go engine; scheduled and advisory rather than a required check, because it ships without versioned releases and with a documented false-positive rate.
- **CodeQL** on GitHub-hosted runners (free for public repos).
- **Playwright** smoke E2E once the app has a UI.

## Phase 5 — AI review loop ✅

- `scripts/ai-review.sh` — spawns a headless AI reviewer (`claude -p`) over the branch diff against `origin/main`, with read-only repo access (Read/Grep/Glob) in a clean worktree of the reviewed sha, writing findings to a gitignored `AI_REVIEW.md`; exits non-zero unless the verdict is APPROVE, so the coding agent reads it and fixes issues *before* opening the PR. Enable as a push gate with `git config core.hooksPath .githooks`, or invoke explicitly.
- [`AGENTS.md`](AGENTS.md) — the contract for coding agents: small PRs, conventional titles, run the review loop, never touch guardrail configs outside a `ci:`-titled PR.

*(Implemented out of order — it needs no product code, unlike phases 2–4.)*
