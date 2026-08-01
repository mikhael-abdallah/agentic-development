import { describe, expect, it } from "vitest";

import { decodeNode, encodeNode } from "@/lib/clipboard";
import { type DesignNode, NODE_KINDS, PARAM_FIELDS, newNode } from "@/lib/topology";

/** Clipboard text for a node with `node` replaced by whatever is given, so a
 *  test can put one field wrong and leave the rest well-formed. */
function tagged(node: unknown): string {
  return JSON.stringify({ tag: "system-design-simulator/component@1", node });
}

/** A service with parameters nobody would arrive at by accident, so that a
 *  round trip returning defaults would be visible rather than plausible. */
function tuned(): DesignNode {
  return {
    id: "api",
    kind: "service",
    label: "Redirect API",
    service: { instances: 7, meanServiceMs: 3.5, queueCapacity: 250 },
  };
}

/**
 * A component of each kind with every field that kind may carry set.
 *
 * The fixture the round-trip test below leans on, and the reason it is written
 * out rather than built from `newNode`: a default component does not carry the
 * optional fields, so a copy that dropped one would round-trip perfectly.
 */
const FULLY_DESCRIBED: DesignNode[] = [
  { id: "client", kind: "client", label: "Browsers" },
  { id: "lb", kind: "loadBalancer", label: "Edge", loadBalancer: { algorithm: "random", overheadMs: 0.4 } },
  {
    id: "api",
    kind: "service",
    label: "Redirect service",
    service: {
      instances: 4,
      meanServiceMs: 8,
      queueCapacity: 500,
      endpoints: [
        { name: "GET /{code}", operation: "resolve", meanServiceMs: 7 },
        { name: "POST /shorten", operation: "shorten", meanServiceMs: 25 },
      ],
    },
  },
  { id: "cache", kind: "cache", label: "Key cache", cache: { hitRatio: 0.8, hitLatencyMs: 0.4, writePolicy: "writeBack" } },
  { id: "db", kind: "database", label: "Key store", database: { replicas: 2, meanReadMs: 11, meanWriteMs: 29, poolSize: 6 } },
];

/** The parameters a described component carries, without indexing an object
 *  by a key held in a variable. */
const paramsOf = new Map<string, object>(
  FULLY_DESCRIBED.flatMap((node) =>
    [node.loadBalancer, node.service, node.cache, node.database]
      .filter((params) => params !== undefined)
      .map((params) => [node.kind, params]),
  ),
);

// The guard the compiler cannot give.
//
// A reader that drops a *required* parameter fails to compile, because the
// return type is the contract's own interface. An optional one does not — and
// that is not hypothetical: `endpoints` was added to `ServiceParams`,
// `serviceOf` went on returning the three fields it knew, and copying the
// shortener's service pasted one whose per-operation costs had silently
// reverted to its flat mean.
//
// So the fixture above is held against `PARAM_FIELDS`. If a field is added to
// the contract and not to the fixture, this fails before the round trip gets a
// chance to pass for the wrong reason.
describe("every field a component can carry", () => {
  it("is set on the fixture the round trip uses", () => {
    for (const [kind, fields] of Object.entries(PARAM_FIELDS)) {
      const params = paramsOf.get(kind);
      expect(params, `no ${kind} in the fixture`).toBeDefined();
      const named = (value: object) => Object.keys(value).sort((a, b) => a.localeCompare(b));
      expect(named(params ?? {})).toEqual(named(fields));
    }
  });

  it("survives a copy and a paste unchanged", () => {
    for (const node of FULLY_DESCRIBED) {
      expect(decodeNode(encodeNode(node))).toEqual(node);
    }
  });
});

describe("encodeNode and decodeNode", () => {
  it("brings a component back exactly as it went", () => {
    expect(decodeNode(encodeNode(tuned()))).toEqual(tuned());
  });

  it("brings every kind back", () => {
    for (const node of [
      newNode("client", "client", "Browser"),
      newNode("loadBalancer", "lb"),
      newNode("service", "api"),
      newNode("cache", "cache"),
      newNode("database", "db"),
    ]) {
      expect(decodeNode(encodeNode(node))).toEqual(node);
    }
  });

  it("writes text a person could read", () => {
    expect(encodeNode(tuned())).toContain("Redirect API");
  });
});

// The clipboard holds whatever was last copied from anywhere, so every one of
// these is a thing the app will genuinely be handed. What matters is that the
// answer to all of them is the same: no component, and no attempt to repair
// one — a repaired component carries numbers nobody chose, and the simulation
// would go on to answer questions about them.
describe("decodeNode refusing what is not a component", () => {
  it("refuses text that is not JSON", () => {
    expect(decodeNode("the quick brown fox")).toBeNull();
  });

  it("refuses nothing at all", () => {
    expect(decodeNode("")).toBeNull();
  });

  it("refuses JSON without the tag", () => {
    expect(decodeNode(JSON.stringify({ node: tuned() }))).toBeNull();
  });

  it("refuses a tag from another version", () => {
    const text = JSON.stringify({ tag: "system-design-simulator/component@2", node: tuned() });
    expect(decodeNode(text)).toBeNull();
  });

  it("refuses JSON that is not an object", () => {
    expect(decodeNode("[1,2,3]")).toBeNull();
    expect(decodeNode("42")).toBeNull();
    expect(decodeNode("null")).toBeNull();
  });

  it("refuses a kind this build does not have", () => {
    expect(decodeNode(tagged({ ...tuned(), kind: "messageQueue" }))).toBeNull();
  });

  it("refuses a component with no id", () => {
    expect(decodeNode(tagged({ ...tuned(), id: "" }))).toBeNull();
  });

  it("refuses a label that is not a string", () => {
    expect(decodeNode(tagged({ ...tuned(), label: 7 }))).toBeNull();
  });

  it("refuses a component that is not an object", () => {
    expect(decodeNode(tagged("service"))).toBeNull();
    expect(decodeNode(tagged(null))).toBeNull();
  });

  it("refuses a kind that is not text", () => {
    expect(decodeNode(tagged({ ...tuned(), kind: 42 }))).toBeNull();
  });

  // Asked of every kind, because each has a reader of its own and one that
  // accepted a component with no parameters at all would look exactly like the
  // three that do not.
  it("refuses parameters that are missing", () => {
    for (const kind of NODE_KINDS.filter((each) => each !== "client")) {
      expect(decodeNode(tagged({ id: kind, kind }))).toBeNull();
    }
  });

  it("refuses parameters that are not an object", () => {
    for (const kind of NODE_KINDS.filter((each) => each !== "client")) {
      expect(decodeNode(tagged({ id: kind, kind, [kind]: "fast" }))).toBeNull();
    }
  });

  // Half an API is a component whose costs are not the ones that were copied,
  // so a malformed entry refuses the whole paste rather than being skipped.
  it("refuses an API that is not a list", () => {
    const node = { ...tuned(), service: { ...tuned().service, endpoints: "GET /{code}" } };
    expect(decodeNode(tagged(node))).toBeNull();
  });

  it("refuses an endpoint that is not an object", () => {
    const node = { ...tuned(), service: { ...tuned().service, endpoints: ["GET /{code}"] } };
    expect(decodeNode(tagged(node))).toBeNull();
  });

  it("refuses an endpoint missing any of its fields", () => {
    const whole = { name: "GET /{code}", operation: "resolve", meanServiceMs: 7 };
    for (const missing of ["name", "operation", "meanServiceMs"]) {
      const endpoint = Object.fromEntries(
        Object.entries(whole).filter(([field]) => field !== missing),
      );
      const node = { ...tuned(), service: { ...tuned().service, endpoints: [endpoint] } };
      expect(decodeNode(tagged(node)), `an endpoint with no ${missing}`).toBeNull();
    }
  });

  it("refuses an endpoint whose cost is not a number", () => {
    const endpoint = { name: "GET /{code}", operation: "resolve", meanServiceMs: "fast" };
    const node = { ...tuned(), service: { ...tuned().service, endpoints: [endpoint] } };
    expect(decodeNode(tagged(node))).toBeNull();
  });

  // One good endpoint beside one broken one still refuses, because a paste
  // that kept the good half would be a component the user never copied.
  it("refuses an API where only one endpoint is wrong", () => {
    const endpoints = [
      { name: "GET /{code}", operation: "resolve", meanServiceMs: 7 },
      { name: "POST /shorten", operation: "", meanServiceMs: 25 },
    ];
    const node = { ...tuned(), service: { ...tuned().service, endpoints } };
    expect(decodeNode(tagged(node))).toBeNull();
  });

  it("refuses a database missing its pool size", () => {
    const node = { id: "db", kind: "database", database: { replicas: 1, meanReadMs: 12, meanWriteMs: 30 } };
    expect(decodeNode(tagged(node))).toBeNull();
  });

  it("refuses parameters of the wrong kind", () => {
    const node = { id: "api", kind: "service", cache: newNode("cache", "c").cache };
    expect(decodeNode(tagged(node))).toBeNull();
  });

  it("refuses a number given as a string", () => {
    const node = { ...tuned(), service: { instances: "7", meanServiceMs: 3.5, queueCapacity: 250 } };
    expect(decodeNode(tagged(node))).toBeNull();
  });

  it("refuses a number that is not one", () => {
    const node = { ...tuned(), service: { instances: null, meanServiceMs: 3.5, queueCapacity: 250 } };
    expect(decodeNode(tagged(node))).toBeNull();
  });

  it("refuses a field left out of the parameters", () => {
    const node = { ...tuned(), service: { instances: 7, meanServiceMs: 3.5 } };
    expect(decodeNode(tagged(node))).toBeNull();
  });

  it("refuses an algorithm that is not one of the three", () => {
    const node = { id: "lb", kind: "loadBalancer", loadBalancer: { algorithm: "fastest", overheadMs: 1 } };
    expect(decodeNode(tagged(node))).toBeNull();
  });

  it("refuses a write policy that is not one of the three", () => {
    const node = { id: "c", kind: "cache", cache: { hitRatio: 0.9, hitLatencyMs: 1, writePolicy: "later" } };
    expect(decodeNode(tagged(node))).toBeNull();
  });
});

// The engine refuses unknown fields outright and answers a request in the same
// shape it received, so a component carrying one field the contract has never
// heard of is a run that fails on a design that looks fine. Dropping them here
// is what makes text written by a later build — or by hand — safe to paste.
describe("decodeNode and fields it does not know", () => {
  it("drops a field the contract does not have", () => {
    const node = { ...tuned(), colour: "blue", service: { ...tuned().service, replicas: 3 } };
    expect(decodeNode(tagged(node))).toEqual(tuned());
  });

  it("keeps a component that never had a label", () => {
    const node = newNode("database", "db");
    expect(decodeNode(encodeNode(node))).toEqual(node);
    expect(decodeNode(encodeNode(node))).not.toHaveProperty("label");
  });
});
