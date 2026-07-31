"use client";

import type { CSSProperties } from "react";

import type { SimulationResult } from "@/features/simulation/client";
import { formatLatency, formatRate } from "@/lib/format";

interface ResultsProps {
  readonly result: SimulationResult;
}

/** A percentage with no decimals, which is about the precision a utilization
 *  estimated from a single run actually has. */
function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

interface FiguresProps {
  readonly className: string;
  readonly figures: [label: string, value: string, bad?: boolean][];
}

function Figures({ className, figures }: FiguresProps) {
  return (
    <dl className={className}>
      {figures.map(([label, value, bad]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd data-bad={bad === true}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * What the run said.
 *
 * The percentiles are shown together and in order because the shape of that
 * row is the answer: a p99 near the mean is a system with headroom, and a p99
 * an order of magnitude above it is a queue, whatever the mean says. A mean on
 * its own is precisely the number that hides that.
 */
export function Results({ result }: ResultsProps) {
  const { latency } = result;
  return (
    <div className="results">
      <Figures
        className="results__headline"
        figures={[
          ["Throughput", formatRate(result.throughputRps)],
          ["Completed", result.completed.toLocaleString("en")],
          ["Dropped", result.dropped.toLocaleString("en"), result.dropped > 0],
        ]}
      />
      <h3 className="results__heading">Latency</h3>
      <Figures
        className="results__latency"
        figures={[
          ["mean", formatLatency(latency.meanMs)],
          ["p50", formatLatency(latency.p50Ms)],
          ["p95", formatLatency(latency.p95Ms)],
          ["p99", formatLatency(latency.p99Ms)],
          ["max", formatLatency(latency.maxMs)],
        ]}
      />
      <h3 className="results__heading">Components</h3>
      <ul className="results__nodes">
        {[...result.nodes.entries()].map(([id, stats]) => (
          <li key={id} className="results__node" data-bottleneck={id === result.bottleneck}>
            <span className="results__node-id">{id}</span>
            {/* The one place on this page where a number is worth seeing as a
                shape rather than read as a figure. */}
            <span
              className="results__bar"
              style={{ "--fill": percent(stats.utilization) } as CSSProperties}
            />
            <span className="results__node-figure">{percent(stats.utilization)}</span>
          </li>
        ))}
      </ul>
      <p className="field__hint">
        {result.bottleneck === ""
          ? "Nothing in this design has a capacity, so nothing can be a bottleneck. Add a service or a database."
          : `${result.bottleneck} is the busiest thing here. Its utilization is what decides how much more load this design will take.`}
      </p>
    </div>
  );
}
