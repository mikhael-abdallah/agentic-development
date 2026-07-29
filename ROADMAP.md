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

Plus: all actions pinned to commit SHAs; Dependabot keeps them fresh.

## Phase 2 — Go engine gates (when Go code lands)

- **golangci-lint v2** with clean-code limits: `funlen` ≤ 60 lines, `cyclop` ≤ 12, `gocognit` ≤ 20, `nestif` ≤ 4, revive `argument-limit` 4 params, `file-length-limit` ~400 lines; plus `gosec`, `errorlint`, `exhaustive`, `bodyclose`, `unparam`, `nolintlint`; `gofumpt` + `goimports` formatting. Test files exempt from length/complexity rules.
- **`depguard`** — architecture boundaries (simulation engine must not import HTTP/UI layers).
- **`govulncheck`** — Go vulnerability scanner.
- **Tests** — `go test -race -shuffle=on -cover`; **patch coverage ≥ 80%** on changed lines via `gocover-cobertura` + `diff-cover`.

## Phase 3 — TypeScript / Next.js gates (when frontend lands)

- **`tsc --noEmit`** with `strict` + `noUncheckedIndexedAccess`.
- **ESLint** (typescript-eslint, type-checked): `complexity` ≤ 12, `max-lines-per-function` ≤ 60, `max-params` 4, `max-lines` ~400, `max-depth` 4, sonarjs cognitive complexity, `no-explicit-any` as error.
- **`knip`** — dead code, unused exports and dependencies.
- **Vitest** coverage → same `diff-cover` patch gate (≥ 80% on changed lines).
- **`next build`** as a required check; module boundaries via `dependency-cruiser`.

## Phase 4 — Deeper correctness (scheduled, not per-PR)

- **Mutation testing** (Stryker for TS, gremlins for Go) — weekly; surviving mutants become issues. Proves the coverage gate measures real assertions, not test theater.
- **Semgrep** with custom rules for AI failure modes: swallowed errors, `panic()` in library code, TODOs without an issue link.
- **CodeQL** on GitHub-hosted runners (free for public repos).
- **Playwright** smoke E2E once the app has a UI.

## Phase 5 — AI review loop

- `scripts/ai-review.sh` — spawns a headless AI reviewer over the branch diff, writing findings to a gitignored `AI_REVIEW.md`; the coding agent reads it and fixes issues *before* opening the PR. Runs as a `pre-push` hook or invoked explicitly.
- `AGENTS.md` — the contract for coding agents: small PRs, conventional titles, run the review loop, never touch guardrail configs outside a `ci:`-titled PR.
