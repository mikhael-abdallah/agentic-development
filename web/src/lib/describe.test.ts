import { describe, expect, it } from "vitest";

import {
  algorithmLabel,
  contractsOf,
  describeParams,
  edgeContract,
  kindBlurb,
  kindLabel,
} from "@/lib/describe";
import { addNode, connect, emptyDesign } from "@/lib/design";
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

/** client → service → cache → database, the shape of the shipped shortener. */
function shortener() {
  let design = addNode(emptyDesign(), "service", { x: 0, y: 0 });
  design = addNode(design, "cache", { x: 0, y: 0 });
  design = addNode(design, "database", { x: 0, y: 0 });
  design = connect(design, "client", "service");
  design = connect(design, "service", "cache");
  design = connect(design, "cache", "database");
  return design;
}

describe("edgeContract", () => {
  it("has something to say for every kind in the contract", () => {
    for (const kind of NODE_KINDS) {
      expect(edgeContract(kind).length).toBeGreaterThan(0);
    }
  });

  // The claim that makes a cache worth drawing, and the only kind that
  // forwards less than it receives. Measured against the engine: at a 0.85 hit
  // ratio and 0.95 reads the store saw 0.1882 of what the cache saw, against
  // 0.15 × 0.95 + 0.05 = 0.1925 predicted.
  it("says a cache forwards only misses and writes", () => {
    expect(edgeContract("cache")).toMatch(/miss/);
    expect(edgeContract("cache")).toMatch(/write/);
  });

  it("says everything else forwards what it was given", () => {
    for (const kind of ["client", "service"] as const) {
      expect(edgeContract(kind)).toBe("every request");
    }
  });
});

describe("contractsOf", () => {
  it("reads a component's wiring off the design's own edges", () => {
    const { incoming, outgoing } = contractsOf(shortener().topology, "cache");
    expect(incoming.map((c) => c.other)).toEqual(["Service"]);
    expect(incoming.map((c) => c.carries)).toEqual(["every request"]);
    expect(outgoing.map((c) => c.other)).toEqual(["Database"]);
    expect(outgoing.map((c) => c.carries)).toEqual(["misses, and every write"]);
  });

  // The reason this is read off edges rather than answered from the kind. The
  // same database is handed different traffic depending on what is in front of
  // it, and a kind-level answer would have to pick one and be quietly wrong
  // about the other.
  it("says a database behind a cache gets less than one read directly", () => {
    const behindCache = contractsOf(shortener().topology, "database");
    expect(behindCache.incoming.map((c) => c.carries)).toEqual(["misses, and every write"]);

    let direct = addNode(emptyDesign(), "service", { x: 0, y: 0 });
    direct = addNode(direct, "database", { x: 0, y: 0 });
    direct = connect(direct, "client", "service");
    direct = connect(direct, "service", "database");
    expect(direct.topology.edges).toHaveLength(2);
    expect(contractsOf(direct.topology, "database").incoming.map((c) => c.carries)).toEqual([
      "every request",
    ]);
  });

  it("uses a component's own name when it has one", () => {
    let design = shortener();
    design = {
      ...design,
      topology: {
        ...design.topology,
        nodes: design.topology.nodes.map((node) =>
          node.id === "database" ? { ...node, label: "Key store" } : node,
        ),
      },
    };
    expect(contractsOf(design.topology, "cache").outgoing[0]?.other).toBe("Key store");
  });

  it("reports both sides as empty for a component nothing is wired to", () => {
    const design = addNode(emptyDesign(), "cache", { x: 0, y: 0 });
    const { incoming, outgoing } = contractsOf(design.topology, "cache");
    expect(incoming).toEqual([]);
    expect(outgoing).toEqual([]);
  });
});

// Two unnamed components of the same kind both read as "Service", and both may
// feed the same target — so the name cannot be what tells one contract from
// another.
describe("contractsOf with components that share a name", () => {
  it("keeps the components apart when their names collide", () => {
    let design = addNode(emptyDesign(), "service", { x: 0, y: 0 });
    design = addNode(design, "service", { x: 0, y: 0 });
    design = addNode(design, "database", { x: 0, y: 0 });
    design = connect(design, "client", "service");
    design = connect(design, "client", "service-2");
    design = connect(design, "service", "database");
    design = connect(design, "service-2", "database");
    expect(design.topology.edges).toHaveLength(4);
    const { incoming } = contractsOf(design.topology, "database");
    expect(incoming.map((c) => c.other)).toEqual(["Service", "Service"]);
    expect(incoming.map((c) => c.id)).toEqual(["service", "service-2"]);
  });
});
