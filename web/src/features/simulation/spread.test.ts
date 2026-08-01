import { describe, expect, it } from "vitest";

import type { SimulationResult } from "@/features/simulation/client";
import { SEEDS, seedsFrom, spreadOf } from "@/features/simulation/spread";

/** A run reduced to the two figures a spread is taken over. */
function ran(p99Ms: number, throughputRps: number): SimulationResult {
  return {
    arrived: 100,
    completed: 100,
    dropped: 0,
    throughputRps,
    latency: { meanMs: 1, p50Ms: 1, p95Ms: 1, p99Ms, maxMs: p99Ms },
    nodes: new Map(),
    bottleneck: "api",
  };
}

describe("seedsFrom", () => {
  it("starts at the seed that was set", () => {
    expect(seedsFrom(1)[0]).toBe(1);
  });

  it("takes as many seeds as a spread is measured over", () => {
    expect(seedsFrom(1)).toHaveLength(SEEDS);
  });

  it("never runs the same seed twice", () => {
    for (const seed of [0, 1, 42, Number.MAX_SAFE_INTEGER]) {
      expect(new Set(seedsFrom(seed)).size).toBe(SEEDS);
    }
  });

  // Past MAX_SAFE_INTEGER, adding one gives back the same integer. Counting up
  // from the top of the range would run one seed five times and print the
  // identical results as proof that luck does not matter — the exact opposite
  // of what the spread exists to show.
  it("counts down rather than off the end of the integers", () => {
    const seeds = seedsFrom(Number.MAX_SAFE_INTEGER);
    expect(seeds[0]).toBe(Number.MAX_SAFE_INTEGER);
    expect(seeds[1]).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(seeds.every(Number.isSafeInteger)).toBe(true);
  });
});

describe("spreadOf", () => {
  it("reports the range the tail moved over", () => {
    const spread = spreadOf([ran(60, 300), ran(84, 299), ran(71, 301)]);
    expect(spread?.p99).toEqual({ low: 60, high: 84 });
    expect(spread?.throughput).toEqual({ low: 299, high: 301 });
    expect(spread?.runs).toBe(3);
  });

  // A range built from one run is a claim that the number does not vary, which
  // is exactly what one run cannot establish.
  it("has nothing to say about a single run", () => {
    expect(spreadOf([ran(60, 300)])).toBeNull();
    expect(spreadOf([])).toBeNull();
  });

  it("reports a range of nothing when every run agreed", () => {
    const spread = spreadOf([ran(60, 300), ran(60, 300)]);
    expect(spread?.p99).toEqual({ low: 60, high: 60 });
  });
});
