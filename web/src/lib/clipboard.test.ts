import { describe, expect, it } from "vitest";

import { decodeNode, encodeNode } from "@/lib/clipboard";
import { type DesignNode, NODE_KINDS, newNode } from "@/lib/topology";

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
