# agentic-development

A public lab where I practice **agentic development** and **system architecture design**.

The premise: code here is written by AI agents, not reviewed line-by-line by me. Instead, the repository itself enforces quality through automated guardrails — my job is designing the system, the constraints, and the pipeline that keeps the AI honest.

## Guardrails

`main` is protected: changes land only through pull requests, no direct pushes,
no force pushes, squash merges only. Auto-merge is on — a green PR merges
itself, a red one goes back to the agent. **18 status checks** are required
before that can happen.

They exist in four groups, each answering a different question.

**Does the change work?** — `go-test` and `web-test` run the suites (race
detector and shuffled ordering on the Go side) and hold **patch coverage at 80%
of changed lines**. `web-build` builds the app and caps each route's first-load
JavaScript at 250 kB gzipped, because no complexity limit stops a 2 MB chart
import. Coverage measures which lines *ran*, though, not whether anything was
checked — so `expect-expect`, `thelper` and a ban on skipped tests cover the
difference. A test that executes the code and asserts nothing is the most common
way an AI-written suite reports health it has not earned.

**Is it readable a year from now?** — `go-lint` and `web-lint` enforce function
length, cyclomatic and cognitive complexity, nesting depth, parameter counts and
file length, plus dead-code detection. Every suppression needs a written reason,
enforced by the linter itself.

**Does it still fit the design?** — `structure-check` holds the tree to
[ARCHITECTURE.md](ARCHITECTURE.md): package and feature-slice allowlists, routes
only in `app/`, tests beside the modules they test. `depguard` and ESLint enforce
the import direction, so the boundaries are checks rather than conventions.

**Can it be trusted?** — `secret-scan` reads the full history, `dep-scan` and
`go-vuln` scan for vulnerable *and* malicious packages, `dependency-review`
blocks new ones, `unicode-check` rejects invisible characters (this repository is
read by agents, so its text is a delivery surface), and `workflow-security`
audits the CI itself. Every pinned tool is verified by checksum on **every** run,
because the runner's tool cache outlives the job.

And two that guard the rest. `parity-check` proves every CI job runs its own
guard script and has a local pre-push counterpart — job names are what the
ruleset requires, so without it a job could keep its name, lose its body, and
pass. `ratchet-check` proves the guards still demand something: every limit,
enabled linter and suppression count is recorded in
[`ratchet.baseline`](scripts/guards/ratchet.baseline), and any movement fails,
in either direction. Raising `funlen` to 200 or adding an `eslint-disable` is
the cheapest way to turn a red check green, and it looks exactly like a fix.
Now it costs a line in the baseline, next to the reason.

Every guard is a script in `scripts/guards/`, run identically by CI and by the
pre-push hook, so a doomed push never reaches the runner. The guards have their
own test suites — they share a failure mode where a broken check and a passing
one look exactly alike.

## Roadmap

First project: an interactive **system design simulator** — drag components onto a canvas (databases, caches, queues), set a target load, and watch simulated latency/throughput expose the bottlenecks. Structure and boundaries are specified up front in [ARCHITECTURE.md](ARCHITECTURE.md), so both the agents and the guardrails know where every file belongs.

## Status

Bootstrap phase — the pipeline comes first, the product second. The guardrails
are in place; the simulator is next.
