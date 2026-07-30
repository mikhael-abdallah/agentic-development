# Security policy

## Reporting a vulnerability

Please report privately, through GitHub's
[private vulnerability reporting](https://github.com/mikhael-abdallah/agentic-development/security/advisories/new)
— **not** as a public issue, which would disclose the problem before there is
anything to update to.

If that form is unavailable to you, open a public issue asking for a private
channel and say nothing about the finding itself.

Useful in a report, in rough order of usefulness: what an attacker gains, the
smallest sequence of steps that shows it, and the commit you were looking at.
A proof of concept is welcome and never required.

## What to expect

This is a personal project, so the honest commitment is a modest one: an
acknowledgement within a week, and an assessment of whether it is a real
problem within two. If a report is valid you will be credited in the advisory
unless you would rather not be.

There is no bounty.

## Scope

Everything in this repository, which is currently a development pipeline
rather than a deployed product:

- **The guardrails themselves are in scope, and are the most interesting
  target here.** Automated checks stand in for human code review in this
  repository, so a way to make a gate pass without enforcing anything is a
  real finding — a pattern that silently matches nothing, a check that can be
  bypassed from a pull request, a way to reach the CI configuration without
  the checks that guard it.
- The CI workflows and the guard scripts under `scripts/`.
- The application code under `engine/` and `web/`.

Out of scope:

- Findings in third-party dependencies with no exploitable path through this
  code. Report those upstream; this repository scans for them already
  (`dep-scan`, `go-vuln`, `dependency-review`), and known ones carry a written
  decision in `osv-scanner.toml`.
- Infrastructure that is not part of this repository.
- Results from an automated scanner pasted without an argument for why they
  matter here.

## Supported versions

`main` only. Nothing is released or tagged yet, so there are no older versions
to patch — fixes land on `main` and that is the whole supported surface.
