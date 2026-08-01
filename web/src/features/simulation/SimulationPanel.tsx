"use client";

import { useState } from "react";

import { Numbers } from "@/components/Field";
import { Operations } from "@/features/simulation/Operations";
import { Results } from "@/features/simulation/Results";
import { type SimulationResult, simulate } from "@/features/simulation/client";
import { WORKLOAD_FIELDS } from "@/features/simulation/fields";
import { type Spread, seedsFrom, spreadOf } from "@/features/simulation/spread";
import { whyNotOffer, whyNotRun } from "@/lib/design";
import type { Topology, Workload } from "@/lib/topology";

interface SimulationPanelProps {
  readonly topology: Topology;
  /**
   * Held by the page rather than here, because the library can replace it.
   *
   * Loading a preset brings the traffic that preset was written for, and the
   * library and this panel are siblings — so the one thing they both speak
   * about lives above them both. Keeping a copy here would mean a preset's
   * operations were on screen in one panel and ignored by the other.
   */
  readonly workload: Workload;
  readonly onWorkloadChange: (workload: Workload) => void;
}

/** What the panel is doing. A single value rather than a pair of booleans,
 *  because "running and also failed" is a state the UI would have to decide
 *  about and this way it cannot arise. */
type Run =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: SimulationResult; spread: Spread | null }
  | { status: "failed"; reason: string };

export function SimulationPanel({
  topology,
  workload,
  onWorkloadChange,
}: SimulationPanelProps) {
  const [run, setRun] = useState<Run>({ status: "idle" });
  // What stops this design being run at all, asked before the button rather
  // than discovered by pressing it. The engine checks the same things and more
  // on every run; this is the subset a design can drift into while it is drawn.
  // The design and the load are two ways for a run to be impossible, and the
  // design is asked first: a load nobody can put anywhere is the less useful
  // thing to be told about.
  const blocked = whyNotRun(topology) ?? whyNotOffer(workload);

  // Every run is run several times, at consecutive seeds, and the first of
  // them is the one reported. The rest are there to say how much of it was
  // luck — a question a single number cannot even raise, and one that two
  // rewrites of the seed's hint failed to answer in prose.
  //
  // All of them together rather than showing the first and filling the range
  // in afterwards: a second state transition would need guarding against a
  // run started before the last one finished, and the extra runs cost
  // milliseconds against a simulation that has already been decided.
  const start = () => {
    setRun({ status: "running" });
    // The run that was asked for, first and named, then the rest. Written this
    // way rather than as one map over every seed because the first result is
    // the one reported: taken out of an array it is `Result | undefined`, and
    // the branch for a case that cannot happen would be a line no test could
    // ever reach.
    const [, ...others] = seedsFrom(workload.seed);
    Promise.all([
      simulate(topology, workload),
      ...others.map((seed) => simulate(topology, { ...workload, seed })),
    ])
      .then(([asked, ...rest]) => {
        setRun({ status: "done", result: asked, spread: spreadOf([asked, ...rest]) });
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
      <Numbers subject={workload} fields={WORKLOAD_FIELDS} onChange={onWorkloadChange} />
      <Operations
        operations={workload.operations}
        onChange={(operations) => {
          onWorkloadChange({ ...workload, operations });
        }}
      />
      <button
        type="button"
        className="simulation__run"
        onClick={start}
        disabled={run.status === "running" || blocked !== null}
      >
        {run.status === "running" ? "Running…" : "Run simulation"}
      </button>
      {/* Why the button is off, next to the button. A control that is disabled
          and says nothing is indistinguishable from one that is broken — which
          is the shape the canvas was in when the client could not be deleted
          at all. */}
      <p className="simulation__blocked" role="status">
        {blocked ?? ""}
      </p>
      <p className="simulation__error" role="alert">
        {run.status === "failed" ? run.reason : ""}
      </p>
      {run.status === "done" ? <Results result={run.result} spread={run.spread} /> : null}
    </section>
  );
}
