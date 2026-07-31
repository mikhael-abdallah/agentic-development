import { describe, expect, it } from "vitest";

import {
  CACHE_FIELDS,
  DATABASE_FIELDS,
  LOAD_BALANCER_FIELDS,
  SERVICE_FIELDS,
} from "@/features/inspector/fields";
import { DEFAULT_PARAMS, PARAMS_KEY, type ParamsKey } from "@/lib/topology";

const EDITORS = new Map<ParamsKey, { fields: number; params: object }>([
  ["loadBalancer", { fields: LOAD_BALANCER_FIELDS.length, params: DEFAULT_PARAMS.loadBalancer }],
  ["service", { fields: SERVICE_FIELDS.length, params: DEFAULT_PARAMS.service }],
  ["cache", { fields: CACHE_FIELDS.length, params: DEFAULT_PARAMS.cache }],
  ["database", { fields: DATABASE_FIELDS.length, params: DEFAULT_PARAMS.database }],
]);

describe("the field lists", () => {
  // A parameter with no field is one the engine reads and nobody can set. It
  // would silently keep its default for the life of the design.
  it("cover every number on every kind that carries parameters", () => {
    for (const [, editor] of EDITORS) {
      const numbers = Object.entries(editor.params).filter(
        ([, value]) => typeof value === "number",
      );
      expect(editor.fields).toBe(numbers.length);
    }
  });

  it("exist for every kind that has parameters at all", () => {
    const byName = (a: string, b: string) => a.localeCompare(b);
    const withParams = Object.values(PARAMS_KEY).filter((key) => key !== null);
    expect([...EDITORS.keys()].toSorted(byName)).toEqual(withParams.toSorted(byName));
  });
});

describe("each field", () => {
  const all = [
    ...LOAD_BALANCER_FIELDS,
    ...SERVICE_FIELDS,
    ...CACHE_FIELDS,
    ...DATABASE_FIELDS,
  ];

  it("says what it is and what it does", () => {
    expect(all.filter((field) => field.label !== "" && field.hint !== "")).toHaveLength(all.length);
  });

  it("leaves room between its bounds for the step to move in", () => {
    expect(all.filter((field) => field.max - field.min >= field.step)).toHaveLength(all.length);
  });
});

describe("get and set", () => {
  it("read back what they wrote, and change nothing else", () => {
    const before = { ...DEFAULT_PARAMS.service };
    for (const field of SERVICE_FIELDS) {
      const after = field.set(before, field.min);
      expect(field.get(after)).toBe(field.min);
      // Editing one number must not disturb the others, which is the whole
      // reason a field carries a setter rather than a key.
      const others = SERVICE_FIELDS.filter((other) => other.label !== field.label);
      expect(others.map((other) => other.get(after))).toEqual(others.map((other) => other.get(before)));
    }
  });

  it("does not edit the parameters it was given", () => {
    const params = { ...DEFAULT_PARAMS.cache };
    const field = CACHE_FIELDS[0];
    expect(field).toBeDefined();
    field?.set(params, 0.01);
    expect(params).toEqual(DEFAULT_PARAMS.cache);
  });
});

describe("the bounds", () => {
  // The engine draws service, read and write times from a distribution whose
  // rate is 1/mean, so it refuses a mean of zero. A spinner that could reach
  // zero would offer a design the simulation declines to run.
  it("keep a sampled duration above zero", () => {
    const sampled = [
      ...SERVICE_FIELDS.filter((field) => field.label === "Service time"),
      ...DATABASE_FIELDS.filter((field) => field.label.endsWith("time")),
    ];
    expect(sampled).toHaveLength(3);
    expect(sampled.filter((field) => field.min > 0)).toHaveLength(3);
  });

  it("hold a hit ratio to a fraction", () => {
    const ratio = CACHE_FIELDS.find((field) => field.label === "Hit ratio");
    expect(ratio?.min).toBe(0);
    expect(ratio?.max).toBe(1);
  });

  it("keep a pool and an instance count at one or more", () => {
    expect(SERVICE_FIELDS.find((field) => field.label === "Instances")?.min).toBe(1);
    expect(DATABASE_FIELDS.find((field) => field.label === "Pool size")?.min).toBe(1);
  });
});
