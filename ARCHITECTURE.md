# Architecture

The product is a **system design simulator**: an interactive canvas where you
assemble a system out of components (load balancer, service, cache, queue,
database), wire them together, set parameters (request rate, capacity, latency
distributions), and run a discrete-event simulation that reports throughput,
latency percentiles, and bottlenecks per component.

The repository is built for **agentic development**: AI agents write all code,
guardrails replace human review. That drives every structural decision below —
boundaries exist so that a machine can enforce them, and the layout is
predictable enough that an agent can find (or place) any file without asking.

## Top-level layout

```
engine/     Go simulation engine (pure core + thin adapters)
web/        Next.js frontend (canvas UI)
scripts/    guards + agent tooling (single source of truth for CI and local)
docs/       architecture decisions, roadmap support material
.github/    workflows (thin wrappers around scripts/guards/*.sh)
.githooks/  pre-push hook (guards + AI review)
```

No other top-level directories. The structure guard enforces this allowlist.

## Go engine (`engine/`)

```
engine/
  cmd/
    engined/        HTTP server binary (thin main, wiring only)
    simwasm/        WASM build target exporting the engine to the browser
  internal/
    model/          topology types: components, edges, parameters, validation
    sim/            discrete-event simulation core; deterministic, seedable
    api/            HTTP/JSON transport for engined
```

Rules (enforced by `depguard` / `go-arch-lint`):

- `model` imports nothing from this repo. `sim` imports only `model`.
- `sim` and `model` are **pure**: no `net/http`, no I/O, no clocks other than
  the simulated one. Determinism (same seed → same result) is a test invariant.
- Only `api` and `cmd/*` may import `sim`. Nothing imports `cmd`.
- The engine reaches the browser two ways from the same core: `engined`
  (HTTP API) and `simwasm` (client-side WASM). Adapters stay thin; anything
  worth testing lives in `internal`.

## Web app (`web/src/`)

```
web/src/
  app/            routes only: layouts, pages, route handlers — thin, no logic
  components/     shared presentational components (dumb, stateless)
  features/       vertical slices, one directory per feature:
    canvas/       the design surface: nodes, edges, drag/drop
    palette/      component catalog to drag from
    inspector/    parameter editing for the selected component
    simulation/   run control, engine client (WASM worker / API), results
  lib/            pure utilities (formatting, math) — no React
  server/         server-only modules, each importing the `server-only` marker
```

Rules (enforced by ESLint/dependency-cruiser once server code lands):

- Dependencies point one way: `app → features → components|lib`.
  Features never import `app`; `components` and `lib` never import `features`.
- Feature slices don't import each other's internals — shared state or types
  move down into `lib` (or a dedicated store module) instead of cross-linking.
- Client modules never import `server/`; server modules are poisoned against
  client bundles via the `server-only` package.
- Tests are colocated: `foo.ts` + `foo.test.ts` in the same directory.
- All source lives under `src/`; `app/` contains only Next.js route files.

## Why this shape works for agents

- **Small units by construction.** Vertical slices plus the lint budgets
  (≤400-line files, complexity caps) keep every module within a single
  context window, and parallel agents working on different features rarely
  touch the same files.
- **Boundaries are checks, not conventions.** Every arrow above is (or will
  be) a lint/guard failure when violated — an agent can't drift the
  architecture without a red check saying so.
- **Pure core, thin edges.** The simulation is deterministic and I/O-free, so
  its tests are fast, seedable, and meaningful for patch coverage; transports
  (HTTP, WASM) stay too thin to hide bugs.
