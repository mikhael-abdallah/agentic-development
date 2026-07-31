"use client";

import { useState } from "react";

import { Numbers } from "@/components/Field";
import { Results } from "@/features/simulation/Results";
import { type SimulationResult, simulate } from "@/features/simulation/client";
import { WORKLOAD_FIELDS } from "@/features/simulation/fields";
import { type Topology, type Workload, defaultWorkload } from "@/lib/topology";

interface SimulationPanelProps {
  readonly topology: Topology;
}

/** What the panel is doing. A single value rather than a pair of booleans,
 *  because "running and also failed" is a state the UI would have to decide
 *  about and this way it cannot arise. */
type Run =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: SimulationResult }
  | { status: "failed"; reason: string };

export function SimulationPanel({ topology }: SimulationPanelProps) {
  const [workload, setWorkload] = useState<Workload>(defaultWorkload);
  const [run, setRun] = useState<Run>({ status: "idle" });

  const start = () => {
    setRun({ status: "running" });
    simulate(topology, workload)
      .then((result) => {
        setRun({ status: "done", result });
      })
      .catch((error: unknown) => {
        // Every failure the engine reports is a statement about the design or
        // the load, and its prose is the useful part. Showing it beats showing
        // "something went wrong" over a message that already said what.
        setRun({ status: "failed", reason: error instanceof Error ? error.message : String(error) });
      });
  };

  return (
    <section className="panel simulation" aria-label="Run settings">
      {/* Named for its scope, not its contents. These numbers describe the
          traffic offered to the design as a whole; the panel above describes
          one component. Both draw the same rows, so nothing but the heading
          tells them apart. */}
      <p className="panel__scope">Whole design</p>
      <h2 className="panel__title">The load to put through it</h2>
      <Numbers subject={workload} fields={WORKLOAD_FIELDS} onChange={setWorkload} />
      <button
        type="button"
        className="simulation__run"
        onClick={start}
        disabled={run.status === "running"}
      >
        {run.status === "running" ? "Running…" : "Run simulation"}
      </button>
      <p className="simulation__error" role="alert">
        {run.status === "failed" ? run.reason : ""}
      </p>
      {run.status === "done" ? <Results result={run.result} /> : null}
    </section>
  );
}
