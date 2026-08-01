import { describe, expect, it } from "vitest";

import {
  type Design,
  addNode,
  componentSignature,
  connect,
  designOf,
  disconnect,
  emptyDesign,
  freeSpot,
  layoutOf,
  moveNode,
  pasteNode,
  removeNode,
  replaceNode,
  selectNode,
  uniqueId,
  whyNotConnect,
  whyNotRun,
} from "@/lib/design";
import { type DesignNode, type Scenario, newNode } from "@/lib/topology";

const SOMEWHERE = { x: 100, y: 100 };

/** A design shaped like the shortener: client → service → database. */
function chain(): Design {
  let design = addNode(emptyDesign(), "service", SOMEWHERE);
  design = addNode(design, "database", SOMEWHERE);
  design = connect(design, "client", "service");
  return connect(design, "service", "database");
}

function edgeList(design: Design): string[] {
  return design.topology.edges.map((edge) => `${edge.from}->${edge.to}`);
}

describe("emptyDesign", () => {
  it("starts with the one client every design needs", () => {
    const design = emptyDesign();
    expect(design.topology.nodes.map((node) => node.kind)).toEqual(["client"]);
    expect(design.topology.edges).toEqual([]);
    expect(design.positions.has("client")).toBe(true);
  });
});

describe("uniqueId", () => {
  it("names the first of a kind after the kind", () => {
    expect(uniqueId(emptyDesign().topology, "service")).toBe("service");
  });

  it("numbers the ones after it", () => {
    const design = addNode(addNode(emptyDesign(), "service", SOMEWHERE), "service", SOMEWHERE);
    expect(design.topology.nodes.map((node) => node.id)).toEqual([
      "client",
      "service",
      "service-2",
    ]);
    expect(uniqueId(design.topology, "service")).toBe("service-3");
  });

  // Ids are the engine's key for a component, and two nodes sharing one is a
  // design it refuses outright.
  it("never returns an id already in the design", () => {
    let design = emptyDesign();
    for (let i = 0; i < 5; i++) {
      design = addNode(design, "cache", SOMEWHERE);
    }
    const ids = design.topology.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("addNode", () => {
  it("places the component where it was dropped and selects it", () => {
    const design = addNode(emptyDesign(), "cache", SOMEWHERE);
    expect(design.positions.get("cache")).toEqual(SOMEWHERE);
    expect(design.selected).toBe("cache");
  });

  it("leaves the design it was given alone", () => {
    const before = emptyDesign();
    addNode(before, "cache", SOMEWHERE);
    expect(before.topology.nodes).toHaveLength(1);
    expect(before.positions.has("cache")).toBe(false);
  });
});

describe("removeNode leaving the design consistent", () => {
  it("takes the component's edges with it", () => {
    const design = removeNode(chain(), "service");
    expect(design.topology.nodes.map((node) => node.id)).toEqual(["client", "database"]);
    expect(edgeList(design)).toEqual([]);
    expect(design.positions.has("service")).toBe(false);
  });

  it("clears the selection when the selected component goes", () => {
    const design = removeNode(selectNode(chain(), "database"), "database");
    expect(design.selected).toBeNull();
  });

  it("keeps a selection that is not the component being removed", () => {
    const design = removeNode(selectNode(chain(), "client"), "database");
    expect(design.selected).toBe("client");
  });
});

describe("moveNode", () => {
  it("moves a component that is there", () => {
    const design = moveNode(chain(), "service", { x: 5, y: 6 });
    expect(design.positions.get("service")).toEqual({ x: 5, y: 6 });
  });

  it("ignores one that is not, rather than inventing a position for it", () => {
    const before = chain();
    const after = moveNode(before, "nothing", { x: 5, y: 6 });
    expect(after).toBe(before);
  });
});

describe("replaceNode", () => {
  it("swaps a component for the edited one and leaves the rest alone", () => {
    const design = replaceNode(chain(), {
      id: "service",
      kind: "service",
      service: { instances: 9, meanServiceMs: 1, queueCapacity: 0 },
    });
    expect(design.topology.nodes.find((node) => node.id === "service")?.service?.instances).toBe(9);
    expect(design.topology.nodes).toHaveLength(3);
    expect(edgeList(design)).toEqual(["client->service", "service->database"]);
  });
});

describe("whyNotConnect", () => {
  // Every one of these is a rule the engine enforces as well. Refusing them
  // while the pointer is down beats accepting a design that will not run.
  const cases: [string, string, string, RegExp][] = [
    ["a component calling itself", "service", "service", /cannot call itself/],
    ["an edge to a component that is not there", "service", "ghost", /not in this design/],
    ["an edge from a component that is not there", "ghost", "service", /not in this design/],
    ["traffic back to the client", "service", "client", /[Nn]othing sends traffic back to it/],
    ["a connection already drawn", "client", "service", /already there/],
    ["a client reaching past its service", "client", "database", /Put a service in front/],
    ["a database calling back", "database", "service", /does not call anything/],
  ];

  for (const [name, from, to, reason] of cases) {
    it(`refuses ${name}`, () => {
      expect(whyNotConnect(chain(), from, to)).toMatch(reason);
    });
  }

  it("allows an edge that is none of those", () => {
    const design = addNode(chain(), "cache", SOMEWHERE);
    expect(whyNotConnect(design, "service", "cache")).toBeNull();
  });

  // A diamond reaches the same component down two paths. The walk has to stop
  // at the one it has already been to, or a design that merely fans out and
  // back in would be reported as a circle.
  it("allows an edge into a design that fans out and back in", () => {
    let design = addNode(emptyDesign(), "loadBalancer", SOMEWHERE);
    design = addNode(design, "service", SOMEWHERE);
    design = addNode(design, "service", SOMEWHERE);
    design = addNode(design, "cache", SOMEWHERE);
    design = addNode(design, "database", SOMEWHERE);
    design = connect(design, "client", "loadBalancer");
    design = connect(design, "loadBalancer", "service");
    design = connect(design, "loadBalancer", "service-2");
    design = connect(design, "service", "cache");
    design = connect(design, "cache", "database");
    expect(edgeList(design)).toHaveLength(5);
    expect(whyNotConnect(design, "service-2", "cache")).toBeNull();
  });

  // The cycle check follows the whole chain, not just the edge in front of it.
  // Built out of services, because a circle needs a back edge and the only
  // kind that may legally call its own upstream is a service.
  it("refuses a circle closed through a longer path", () => {
    let design = addNode(emptyDesign(), "service", SOMEWHERE);
    design = addNode(design, "service", SOMEWHERE);
    design = addNode(design, "service", SOMEWHERE);
    design = connect(design, "client", "service");
    design = connect(design, "service", "service-2");
    design = connect(design, "service-2", "service-3");
    expect(edgeList(design)).toHaveLength(3);
    expect(whyNotConnect(design, "service-3", "service")).toMatch(/circle/);
  });
});

describe("connect", () => {
  it("draws an edge that is allowed", () => {
    expect(edgeList(chain())).toEqual(["client->service", "service->database"]);
  });

  it("leaves the design untouched when the edge is refused", () => {
    const before = chain();
    expect(connect(before, "database", "service")).toBe(before);
  });
});

describe("disconnect", () => {
  it("removes the one edge and no other", () => {
    expect(edgeList(disconnect(chain(), "client", "service"))).toEqual(["service->database"]);
  });

  it("ignores an edge that was never drawn", () => {
    expect(edgeList(disconnect(chain(), "client", "database"))).toHaveLength(2);
  });
});

describe("layoutOf", () => {
  it("puts a chain in the order a request meets it", () => {
    const positions = layoutOf(chain().topology);
    const x = (id: string) => positions.get(id)?.x ?? 0;
    expect(x("client")).toBeLessThan(x("service"));
    expect(x("service")).toBeLessThan(x("database"));
  });

  it("stacks components of the same layer rather than overlapping them", () => {
    let design = emptyDesign();
    design = addNode(design, "service", SOMEWHERE);
    design = addNode(design, "service", SOMEWHERE);
    design = connect(design, "client", "service");
    design = connect(design, "client", "service-2");
    expect(edgeList(design)).toHaveLength(2);
    const positions = layoutOf(design.topology);
    expect(positions.get("service")?.x).toBe(positions.get("service-2")?.x);
    expect(positions.get("service")?.y).not.toBe(positions.get("service-2")?.y);
  });

  // Longest path, not shortest: a component reached both directly and through
  // a chain belongs after the chain, or it lands on top of what feeds it.
  it("places a component after the longest path that reaches it", () => {
    let design = addNode(emptyDesign(), "service", SOMEWHERE);
    design = addNode(design, "service", SOMEWHERE);
    design = connect(design, "client", "service");
    design = connect(design, "client", "service-2");
    design = connect(design, "service", "service-2");
    // Asserted, because every edge above is one `connect` could refuse — and a
    // refused edge would leave this test passing on a design it never built.
    expect(edgeList(design)).toHaveLength(3);
    const positions = layoutOf(design.topology);
    const x = (id: string) => positions.get(id)?.x ?? 0;
    expect(x("service-2")).toBeGreaterThan(x("service"));
  });

  it("gives every component a position", () => {
    const design = chain();
    const positions = layoutOf(design.topology);
    for (const node of design.topology.nodes) {
      expect(positions.get(node.id), `${node.id} was not placed`).toBeDefined();
    }
  });

  // A design being edited is allowed to be wrong in ways a validated one is
  // not, and a layout pass that ran forever on one would take the tab with it.
  it("terminates on a topology with a circle in it", () => {
    const positions = layoutOf({
      nodes: [
        { id: "a", kind: "service" },
        { id: "b", kind: "service" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    });
    expect(positions.size).toBe(2);
  });
});

describe("designOf", () => {
  const scenario: Scenario = {
    id: "s",
    title: "t",
    description: "d",
    goal: "g",
    topology: chain().topology,
    workload: {
      rateRps: 1,
      operations: [{ name: "read", kind: "read", share: 1 }],
      durationMs: 1,
      seed: 1,
      warmupFraction: 0,
    },
  };

  it("lays out a scenario that arrived without coordinates", () => {
    const design = designOf(scenario);
    expect(design.positions.size).toBe(design.topology.nodes.length);
    expect(design.selected).toBeNull();
  });
});

// Clicking a palette entry has no position in mind. Every click used to drop
// its component on one fixed point, so the second landed exactly on top of the
// first: three components, one visible box, and nothing on screen saying the
// others were there.
describe("freeSpot", () => {
  it("puts the first extra component beside the client, not on it", () => {
    const design = emptyDesign();
    const client = design.positions.get("client");
    const spot = freeSpot(design);
    expect(spot).not.toEqual(client);
  });

  it("never lands on a component that is already there", () => {
    let design = emptyDesign();
    const spots: string[] = [];
    for (const kind of ["service", "cache", "database", "loadBalancer"] as const) {
      const spot = freeSpot(design);
      spots.push([spot.x, spot.y].join(","));
      design = addNode(design, kind, spot);
    }
    expect(new Set(spots).size).toBe(spots.length);
    const placed = [...design.positions.values()].map((at) => [at.x, at.y].join(","));
    expect(new Set(placed).size).toBe(placed.length);
  });

  // A component dragged a little off its cell still occupies it: the question
  // is whether something would land on top, and near enough is on top.
  it("treats a component nudged off its cell as still standing there", () => {
    const design = moveNode(emptyDesign(), "client", { x: 68, y: 54 });
    expect(freeSpot(design)).not.toEqual({ x: 60, y: 60 });
  });

  it("fills a hole left by a component that was removed", () => {
    const beside = freeSpot(emptyDesign());
    const design = removeNode(addNode(emptyDesign(), "cache", beside), "cache");
    expect(freeSpot(design)).toEqual(beside);
  });
});

// The canvas re-fits the view on this and not on the design, because the
// design changes on every pixel of a drag and re-fitting mid-drag would fight
// the hand doing the dragging.
describe("componentSignature", () => {
  it("changes when a component arrives", () => {
    const before = emptyDesign();
    const after = addNode(before, "cache", SOMEWHERE);
    expect(componentSignature(after.topology)).not.toBe(componentSignature(before.topology));
  });

  it("changes when a component leaves", () => {
    const design = addNode(emptyDesign(), "cache", SOMEWHERE);
    expect(componentSignature(removeNode(design, "cache").topology)).not.toBe(
      componentSignature(design.topology),
    );
  });

  it("does not change when a component is only moved", () => {
    const design = addNode(emptyDesign(), "cache", SOMEWHERE);
    const moved = moveNode(design, "cache", { x: 900, y: 900 });
    expect(componentSignature(moved.topology)).toBe(componentSignature(design.topology));
  });

  it("does not change when a component is only connected", () => {
    const design = addNode(emptyDesign(), "service", SOMEWHERE);
    const linked = connect(design, "client", "service");
    // Asserted, because a refused edge would leave this passing on a design
    // nothing was connected in.
    expect(linked.topology.edges).toHaveLength(1);
    expect(componentSignature(linked.topology)).toBe(componentSignature(design.topology));
  });
});

// The client was the one component that could not be removed. It can now: a
// design being drawn is allowed to be unfinished, and the rule that a run needs
// a client lives in `whyNotRun`, where it is actually true.
describe("removeNode taking the client", () => {
  it("removes the client, and the edges it was on", () => {
    const design = removeNode(chain(), "client");
    expect(design.topology.nodes.map((node) => node.id)).toEqual(["service", "database"]);
    expect(design.topology.edges).toEqual([{ from: "service", to: "database" }]);
    expect(design.positions.has("client")).toBe(false);
  });

  it("leaves a design that can be run again once a client is put back", () => {
    let design = removeNode(chain(), "client");
    expect(whyNotRun(design.topology)).toMatch(/no client/);
    design = addNode(design, "client", { x: 0, y: 0 });
    design = connect(design, "client", "service");
    expect(whyNotRun(design.topology)).toBeNull();
  });
});

describe("removeNode", () => {
  it("still removes the edges of a component it does remove", () => {
    const design = removeNode(chain(), "service");
    expect(design.topology.nodes.map((node) => node.id)).toEqual(["client", "database"]);
    expect(design.topology.edges).toEqual([]);
  });

  it("keeps the design untouched when the component is not there", () => {
    const before = chain();
    expect(removeNode(before, "nowhere")).toBe(before);
  });
});

// What a design can drift into while it is being drawn. Every one of these is
// also refused by the engine — this is here so the Run button can say which,
// rather than being pressed to find out.
describe("whyNotRun", () => {
  it("allows a design that is wired up", () => {
    expect(whyNotRun(chain().topology)).toBeNull();
  });

  it("names the missing client", () => {
    expect(whyNotRun(removeNode(chain(), "client").topology)).toMatch(/no client/);
  });

  it("refuses a second client, because a run has one place to start", () => {
    const two = addNode(chain(), "client", { x: 0, y: 0 });
    expect(two.topology.nodes.filter((node) => node.kind === "client")).toHaveLength(2);
    expect(whyNotRun(two.topology)).toMatch(/more than one client/);
  });

  it("refuses a client wired to nothing", () => {
    const design = disconnect(chain(), "client", "service");
    expect(whyNotRun(design.topology)).toMatch(/not connected to anything/);
  });

  // A component nothing reaches contributes nothing and says nothing about it:
  // its absence from the results reads as "not a bottleneck".
  it("names a component the client cannot reach", () => {
    const design = addNode(chain(), "cache", { x: 0, y: 0 });
    expect(whyNotRun(design.topology)).toMatch(/Nothing reaches Cache/);
  });

  it("stops naming it once it is wired in", () => {
    let design = addNode(chain(), "cache", { x: 0, y: 0 });
    design = connect(design, "service", "cache");
    expect(design.topology.edges).toHaveLength(3);
    expect(whyNotRun(design.topology)).toBeNull();
  });
});

// The twin of the rule that refuses fan-out: a pool of instances only behaves
// like a pool if something is spreading requests across it, and a client is
// outside the design, so nothing there can be.
describe("a client calling a pool", () => {
  function pooled(instances: number): Design {
    const design = addNode(emptyDesign(), "service", { x: 0, y: 0 });
    const service = design.topology.nodes.find((node) => node.id === "service");
    if (service?.service === undefined) {
      throw new Error("a new service arrived without its parameters");
    }
    return replaceNode(design, { ...service, service: { ...service.service, instances } });
  }

  it("refuses the connection, and says what to put in front", () => {
    const why = whyNotConnect(pooled(4), "client", "service");
    expect(why).toMatch(/runs 4 instances/);
    expect(why).toMatch(/load balancer/);
  });

  it("allows it when there is only one instance to choose from", () => {
    expect(whyNotConnect(pooled(1), "client", "service")).toBeNull();
  });

  // The other way in: the edge is legal when it is drawn and the design is
  // edited into breaking it afterwards.
  it("catches a pool grown under an edge that was already there", () => {
    let design = connect(pooled(1), "client", "service");
    expect(design.topology.edges).toHaveLength(1);
    expect(whyNotRun(design.topology)).toBeNull();
    const service = design.topology.nodes.find((node) => node.id === "service");
    if (service?.service === undefined) {
      throw new Error("the service lost its parameters");
    }
    design = replaceNode(design, { ...service, service: { ...service.service, instances: 8 } });
    expect(whyNotRun(design.topology)).toMatch(/runs 8 instances/);
  });

  // A load balancer in front is the fix the message names, so it has to work.
  it("is happy once a load balancer is doing the choosing", () => {
    let design = addNode(pooled(4), "loadBalancer", { x: 0, y: 0 });
    design = connect(design, "client", "loadBalancer");
    design = connect(design, "loadBalancer", "service");
    expect(design.topology.edges).toHaveLength(2);
    expect(whyNotRun(design.topology)).toBeNull();
  });
});

/** A component of a design, by id. Throws rather than returning undefined: a
 *  test that went on with a missing component would assert about nothing. */
function nodeIn(design: Design, id: string): DesignNode {
  const node = design.topology.nodes.find((existing) => existing.id === id);
  if (node === undefined) {
    throw new Error(`the design has no ${id}`);
  }
  return node;
}

/** The chain, with its service named and tuned away from the defaults, so a
 *  copy that quietly came back with default settings would be visible. */
function tuned(): Design {
  const design = chain();
  const service = nodeIn(design, "service");
  return replaceNode(design, {
    ...service,
    label: "Redirect API",
    service: { instances: 7, meanServiceMs: 3.5, queueCapacity: 250 },
  });
}

describe("pasteNode", () => {
  it("copies the settings and gives the copy an id of its own", () => {
    const design = tuned();
    const pasted = pasteNode(design, nodeIn(design, "service"), SOMEWHERE);
    const copy = nodeIn(pasted, "service-2");
    expect(copy.service).toEqual({ instances: 7, meanServiceMs: 3.5, queueCapacity: 250 });
    expect(copy.label).toBe("Redirect API");
  });

  it("names the copy after the component it came from", () => {
    const design = chain();
    const pasted = pasteNode(design, { ...nodeIn(design, "service"), id: "api" }, SOMEWHERE);
    expect(pasted.topology.nodes.map((node) => node.id)).toContain("api");
  });

  it("places the copy where it was put, and selects it", () => {
    const design = chain();
    const pasted = pasteNode(design, nodeIn(design, "service"), SOMEWHERE);
    expect(pasted.positions.get("service-2")).toEqual(SOMEWHERE);
    expect(pasted.selected).toBe("service-2");
  });

  // An edge is a fact about two components, and there is no answer to which of
  // a copy's ends to keep. Wiring the copy the way the original was wired
  // would be a design decision the user did not make and would have to undo.
  it("copies the component and not its connections", () => {
    const design = chain();
    const pasted = pasteNode(design, nodeIn(design, "service"), SOMEWHERE);
    expect(edgeList(pasted)).toEqual(["client->service", "service->database"]);
  });

  it("leaves the design it was given alone", () => {
    const before = chain();
    pasteNode(before, nodeIn(before, "service"), SOMEWHERE);
    expect(before.topology.nodes).toHaveLength(3);
    expect(before.positions.has("service-2")).toBe(false);
  });

  // Two copies of one component used to share a parameters object, because a
  // spread copies it by reference. Raising the instance count on either raised
  // it on both, and nothing on screen said why.
  //
  // Asked of every kind that carries parameters, because each is a line of its
  // own in `unshared` — a loop over the keys would type-check against any
  // member of the union and so against none of them — and three of those lines
  // being right says nothing about the fourth.
  it("gives each copy parameters of its own", () => {
    // Named accessors rather than `node[kind]`: a key read out of a variable
    // is the shape prototype pollution takes, and the rule that says so does
    // not care that this one came from a literal.
    const kinds = [
      { kind: "loadBalancer", of: (node: DesignNode) => node.loadBalancer },
      { kind: "service", of: (node: DesignNode) => node.service },
      { kind: "cache", of: (node: DesignNode) => node.cache },
      { kind: "database", of: (node: DesignNode) => node.database },
    ] as const;
    for (const { kind, of } of kinds) {
      const source = newNode(kind, kind);
      const twice = pasteNode(pasteNode(emptyDesign(), source, SOMEWHERE), source, SOMEWHERE);
      const first = of(nodeIn(twice, kind));
      const second = of(nodeIn(twice, `${kind}-2`));
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(first).not.toBe(of(source));
    }
  });

  it("copies the parameters rather than only their reference", () => {
    const design = chain();
    const source = nodeIn(design, "service");
    const twice = pasteNode(pasteNode(design, source, SOMEWHERE), source, SOMEWHERE);
    const first = nodeIn(twice, "service-2");
    const second = nodeIn(twice, "service-3");
    if (first.service === undefined || second.service === undefined) {
      throw new Error("a copy lost its parameters");
    }
    first.service.instances = 99;
    expect(second.service.instances).not.toBe(99);
    expect(source.service?.instances).not.toBe(99);
  });
});
