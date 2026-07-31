import { describe, expect, it } from "vitest";

import { WORKLOAD_FIELDS } from "@/features/simulation/fields";
import { defaultWorkload } from "@/lib/topology";

describe("WORKLOAD_FIELDS", () => {
  // A part of the load with no field is one the engine reads and nobody can
  // set: it would keep its default for the life of the design.
  it("covers every part of the load the engine reads", () => {
    expect(WORKLOAD_FIELDS).toHaveLength(Object.keys(defaultWorkload()).length);
  });

  it("reads back what it writes, and disturbs nothing else", () => {
    const before = defaultWorkload();
    for (const field of WORKLOAD_FIELDS) {
      const after = field.set(before, field.min);
      expect(field.get(after)).toBe(field.min);
      const others = WORKLOAD_FIELDS.filter((other) => other.label !== field.label);
      expect(others.map((other) => other.get(after))).toEqual(
        others.map((other) => other.get(before)),
      );
    }
  });

  // The engine refuses a run with no arrivals, no duration, or nothing left to
  // measure after warmup. A spinner that could reach any of those would offer
  // a load the simulation declines.
  it("cannot be dragged to a load the engine refuses", () => {
    const named = (label: string) => WORKLOAD_FIELDS.find((field) => field.label === label);
    expect(named("Arrival rate")?.min).toBeGreaterThan(0);
    expect(named("Duration")?.min).toBeGreaterThan(0);
    expect(named("Warmup")?.max).toBeLessThan(1);
    expect(named("Read fraction")?.min).toBe(0);
    expect(named("Read fraction")?.max).toBe(1);
  });
});
