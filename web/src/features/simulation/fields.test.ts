import { describe, expect, it } from "vitest";

import { WORKLOAD_FIELDS } from "@/features/simulation/fields";
import { defaultWorkload } from "@/lib/topology";

/**
 * The parts of the load that are not a number, and so cannot be a row in this
 * table.
 *
 * `operations` is a list of named things rather than a value with a spinner.
 * Listed here rather than filtered out by type, so that adding another such
 * field is a decision someone takes in this file instead of a field quietly
 * dropping out of a count that used to guard it.
 */
const NOT_A_NUMBER = ["operations"];

describe("WORKLOAD_FIELDS", () => {
  // A part of the load with no control is one the engine reads and nobody can
  // set: it would keep its default for the life of the design.
  it("covers every part of the load the engine reads", () => {
    const covered = [...WORKLOAD_FIELDS.map((field) => field.label), ...NOT_A_NUMBER];
    expect(covered).toHaveLength(Object.keys(defaultWorkload()).length);
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
  });
});
