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

- **Mutation testing** (Stryker for TS, gremlins for Go) — weekly; surviving mutants become issues. Proves the coverage gate measures real assertions, not test theater.
- **Semgrep** with custom rules for AI failure modes: swallowed errors, `panic()` in library code, TODOs without an issue link.
- **nilaway** (Uber) — nil-panic static analysis over the Go engine; scheduled and advisory rather than a required check, because it ships without versioned releases and with a documented false-positive rate.
- **CodeQL** on GitHub-hosted runners (free for public repos).
- **Playwright** smoke E2E once the app has a UI.

## Phase 5 — AI review loop ✅

- `scripts/ai-review.sh` — spawns a headless AI reviewer (`claude -p`) over the branch diff against `origin/main`, with read-only repo access (Read/Grep/Glob) in a clean worktree of the reviewed sha, writing findings to a gitignored `AI_REVIEW.md`; exits non-zero unless the verdict is APPROVE, so the coding agent reads it and fixes issues *before* opening the PR. Enable as a push gate with `git config core.hooksPath .githooks`, or invoke explicitly.
- [`AGENTS.md`](AGENTS.md) — the contract for coding agents: small PRs, conventional titles, run the review loop, never touch guardrail configs outside a `ci:`-titled PR.

*(Implemented out of order — it needs no product code, unlike phases 2–4.)*
