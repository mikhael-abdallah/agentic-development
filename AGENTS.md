# Agent Contract

Rules for AI coding agents working in this repository. `main` is locked; every change lands through a PR that must pass all required checks — there is no human review to catch you.

## Workflow

1. Branch from `main`, keep the PR small: **≤ 1000 changed lines, ≤ 30 files** (`pr-guard` rejects more).
2. PR titles follow **Conventional Commits** (`feat|fix|docs|refactor|test|perf|ci|chore|build`, optional scope, ≤ 72-char description). Squash merge makes the title the commit message.
3. **Before opening a PR, run `scripts/ai-review.sh`.** Read `AI_REVIEW.md`, fix every finding, rerun until the verdict is APPROVE. Wire it as a push gate with `git config core.hooksPath .githooks` (bypass in emergencies with `SKIP_AI_REVIEW=1 git push` — the CI checks still apply).
4. Auto-merge is on: a green PR merges itself; a red one is yours to fix. Watch check *conclusions*, not the PR state — a failed check leaves the PR open forever.

## Hard rules

- Never commit `AI_REVIEW.md` or `PRIVATE.md` (both gitignored — do not "fix" that).
- Never modify `.github/**` (workflows, guards, dependabot) outside a PR titled `ci: ...` that changes nothing else.
- Never loosen a guardrail threshold to make a check pass; fix the code instead.
- New dependencies must be justified in the PR body — `dependency-review` and Dependabot watch them.

See [ROADMAP.md](ROADMAP.md) for the gates that apply as the codebase grows.
