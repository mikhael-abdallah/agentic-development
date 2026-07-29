# agentic-development

A public lab where I practice **agentic development** and **system architecture design**.

The premise: code here is written by AI agents, not reviewed line-by-line by me. Instead, the repository itself enforces quality through automated guardrails — my job is designing the system, the constraints, and the pipeline that keeps the AI honest.

## Guardrails

- `main` is protected: changes land only through pull requests, no direct pushes, no force pushes.
- Every PR must pass required status checks before merging:
  - **secret-scan** — gitleaks scans the full history for leaked credentials.
  - **workflow-lint** — actionlint validates the CI itself, so the guardrails can't silently rot.
  - **pr-guard** — rejects oversized PRs; AI agents must ship small, reviewable increments.
- Auto-merge is enabled: a green PR merges itself. A red one goes back to the agent.
- CI runs on a self-hosted runner; workflow runs from outside contributors require manual approval.

Stack-specific checks (lint, tests, coverage) are added to the same pipeline as the codebase grows — see the [guardrails roadmap](ROADMAP.md).

## Roadmap

First project: an interactive **system design simulator** — drag components onto a canvas (databases, caches, queues), set a target load, and watch simulated latency/throughput expose the bottlenecks.

## Status

Bootstrap phase — the pipeline comes first, the product second.
