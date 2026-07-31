import { describe, expect, it } from "vitest";

import { algorithmLabel, describeParams, kindBlurb, kindLabel } from "@/lib/describe";
import { ALGORITHMS, NODE_KINDS, newNode } from "@/lib/topology";

describe("kindLabel and kindBlurb", () => {
  // A kind with no name renders as an empty palette button — visible only to
  // whoever is looking at that one entry, which is nobody until it ships.
  it("name every kind in the contract", () => {
    expect(NODE_KINDS.map(kindLabel).filter((label) => label.length > 0)).toHaveLength(
      NODE_KINDS.length,
    );
    expect(NODE_KINDS.map(kindBlurb).filter((blurb) => blurb.length > 0)).toHaveLength(
      NODE_KINDS.length,
    );
  });

  it("give every kind a different name", () => {
    expect(new Set(NODE_KINDS.map(kindLabel)).size).toBe(NODE_KINDS.length);
  });
});

describe("algorithmLabel", () => {
  it("names every balancing strategy", () => {
    expect(new Set(ALGORITHMS.map(algorithmLabel)).size).toBe(ALGORITHMS.length);
  });
});

describe("describeParams", () => {
  it("says something about every kind a palette can produce", () => {
    const summaries = NODE_KINDS.map((kind) => describeParams(newNode(kind, kind)));
    expect(summaries.filter((summary) => summary.length > 0)).toHaveLength(NODE_KINDS.length);
  });

  it("reports the two numbers that decide how a service behaves", () => {
    const summary = describeParams({
      id: "s",
      kind: "service",
      service: { instances: 6, meanServiceMs: 12, queueCapacity: 0 },
    });
    expect(summary).toContain("6");
    expect(summary).toContain("12 ms");
  });

  it("reports a hit ratio as a percentage, which is how anyone says it", () => {
    const summary = describeParams({
      id: "c",
      kind: "cache",
      cache: { hitRatio: 0.85, hitLatencyMs: 0.5 },
    });
    expect(summary).toBe("85% hits");
  });

  it("names the balancing strategy rather than its wire spelling", () => {
    const summary = describeParams({
      id: "lb",
      kind: "loadBalancer",
      loadBalancer: { algorithm: "leastConnections", overheadMs: 0 },
    });
    expect(summary).toBe("least connections");
  });

  it("reports replicas and read time for a database", () => {
    const summary = describeParams({
      id: "db",
      kind: "database",
      database: { replicas: 2, meanReadMs: 12, meanWriteMs: 30, poolSize: 4 },
    });
    expect(summary).toContain("2 replicas");
    expect(summary).toContain("12 ms");
  });

  // The parameter union is guaranteed by construction, not by the type system:
  // a node arriving over the wire could be missing it. Rendering nothing beats
  // rendering "undefined" on the canvas.
  it("says nothing rather than something wrong when the parameters are absent", () => {
    for (const kind of NODE_KINDS.filter((k) => k !== "client")) {
      expect(describeParams({ id: "x", kind })).toBe("");
    }
  });
});
