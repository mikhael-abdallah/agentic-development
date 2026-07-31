# agentic-development

A public lab where I practice **agentic development** and **system architecture design**.

The premise: code here is written by AI agents, not reviewed line-by-line by me. Instead, the repository itself enforces quality through automated guardrails — my job is designing the system, the constraints, and the pipeline that keeps the AI honest.

## Guardrails

`main` is protected: changes land only through pull requests, no direct pushes,
no force pushes, squash merges only. Auto-merge is on — a green PR merges
itself, a red one goes back to the agent. **21 status checks** are required
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
`hygiene-check` answers the neighbouring question of what a file may *be*: no
binaries, nothing too large to read, no conflict markers, no CRLF. If checks
replace reading the code, a file nothing can read is a hole in the premise.

**Can it be trusted?** — `secret-scan` reads the full history, `dep-scan` and
`go-vuln` scan for vulnerable *and* malicious packages, `dependency-review`
blocks new ones and refuses copyleft licences, `unicode-check` rejects invisible
characters (this repository is read by agents, so its text is a delivery
surface), and `workflow-security` audits the CI itself. `npm audit signatures`
verifies every installed package against the registry's signing key — advisory
scanners only know a package is bad once someone has said so, while a broken
signature is what fails first when a tarball is replaced after publication.
Every pinned tool is verified by checksum on **every** run, because the runner's
tool cache outlives the job.

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

The exception is `docker-build`, which builds the image and runs it: no shell
in it, not running as root, the page served, the shipped scenario simulated
through the API the image serves. It cannot have a local counterpart — the
self-hosted runner has no Docker — so it lives in its own workflow rather than
making `parity-check` carry an exception. It earned its place on its first run,
by failing: twenty checks had passed on a Dockerfile that could not build.

## Running the simulator

```
docker build -t simulator .
docker run --rm -p 8080:8080 simulator
```

Then open <http://localhost:8080>: drag components onto the canvas, or start
from the URL shortener under **Start from**, set the load, and run it. The same
process answers the API:

```
curl -s localhost:8080/healthz
curl -s localhost:8080/scenarios | jq '.[0].id'
```

One image, one process, no Node in it. `next build` exports the app to static
files and `engined` serves them beside `/simulate`, so the page and the API
share an origin. To run the two halves separately while developing:

```
scripts/web-npm.sh run dev                        # the app, on :3000
cd engine && go run ./cmd/engined -addr :8080     # the API, on :8080
```

with `NEXT_PUBLIC_ENGINE_URL=http://localhost:8080` in `web/.env.local` so the
app knows where the engine went.

## Roadmap

First project: an interactive **system design simulator** — drag components onto a canvas (databases, caches, queues), set a target load, and watch simulated latency/throughput expose the bottlenecks. Structure and boundaries are specified up front in [ARCHITECTURE.md](ARCHITECTURE.md), so both the agents and the guardrails know where every file belongs.

## Status

The guardrails are in place and the simulator runs: a discrete-event engine
checked against a closed-form queue model, a canvas to design on, and the URL
shortener as the first scenario.

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md). The
guardrails are in scope, and are the most interesting target: a way to make a
gate pass without enforcing anything is the defect this repository most wants
to hear about.

## License

[MIT](LICENSE).
