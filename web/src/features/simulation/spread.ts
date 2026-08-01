import type { SimulationResult } from "@/features/simulation/client";

/**
 * How many runs a spread is taken over.
 *
 * Five: enough that the range is visibly wider than a rounding error, few
 * enough that the extra runs are not a wait. It is not a confidence interval
 * and does not pretend to be one — it is the smallest thing that answers "was
 * that number luck", which is the question a single result cannot even raise.
 */
export const SEEDS = 5;

/**
 * The seeds a spread is measured over, starting from the one that was set.
 *
 * Counting down near the top of the safe range rather than up. A seed one past
 * `MAX_SAFE_INTEGER` is not the next integer — it is the same integer again —
 * so counting up there would run the identical seed five times and report the
 * result as evidence that luck does not matter, which is the exact opposite of
 * what this exists to show.
 */
export function seedsFrom(seed: number): number[] {
  const step = seed > Number.MAX_SAFE_INTEGER - SEEDS ? -1 : 1;
  return Array.from({ length: SEEDS }, (_, index) => seed + index * step);
}

/** Not exported: `Spread` below is what a caller reads, and it names its own
 *  fields. */
interface Range {
  readonly low: number;
  readonly high: number;
}

/**
 * What the same design did under different luck.
 *
 * A simulation draws when each request arrives and how long each one takes, so
 * a single run is one sample and not the answer. The seed decides which sample
 * — which is why the same design, load and seed always agree, and why changing
 * only the seed is the one experiment that says how much of a result was the
 * design and how much was the draw.
 *
 * Explaining that in a hint on the seed field has been tried and did not land.
 * A range printed under the number it qualifies does not need to be read to be
 * understood.
 *
 * p99 and throughput, because they move for opposite reasons. p99 is the tail
 * and is the most sensitive thing here to luck; throughput is bounded by what
 * the design can serve and barely moves at all once something is saturated. A
 * wide p99 beside a still throughput is the shape of a design at its limit.
 */
export interface Spread {
  readonly runs: number;
  readonly p99: Range;
  readonly throughput: Range;
}

/**
 * The spread across several runs, or null if there is nothing to compare.
 *
 * Null rather than a range of one value repeated. A "spread" from a single run
 * is a claim that the number does not vary, which is precisely what one run
 * cannot establish.
 */
export function spreadOf(results: SimulationResult[]): Spread | null {
  if (results.length < 2) {
    return null;
  }
  const p99 = results.map((result) => result.latency.p99Ms);
  const throughput = results.map((result) => result.throughputRps);
  return {
    runs: results.length,
    p99: { low: Math.min(...p99), high: Math.max(...p99) },
    throughput: { low: Math.min(...throughput), high: Math.max(...throughput) },
  };
}
