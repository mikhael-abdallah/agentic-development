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
  removeNode,
  replaceNode,
  selectNode,
  uniqueId,
  whyNotConnect,
  whyNotRemove,
} from "@/lib/design";
import type { Scenario } from "@/lib/topology";

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

describe("removeNode", () => {
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
    workload: { rateRps: 1, readFraction: 1, durationMs: 1, seed: 1, warmupFraction: 0 },
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

// React Flow deletes on a keypress of its own, without consulting the design,
// so this rule is what keeps Backspace from taking the client and leaving a
// design nothing can put load through.
describe("whyNotRemove", () => {
  it("refuses the client, and says why", () => {
    expect(whyNotRemove(chain(), "client")).toMatch(/load comes from/);
  });

  it("allows anything else", () => {
    expect(whyNotRemove(chain(), "service")).toBeNull();
    expect(whyNotRemove(chain(), "database")).toBeNull();
  });

  it("refuses a component that is not in the design", () => {
    expect(whyNotRemove(chain(), "nowhere")).not.toBeNull();
  });
});

describe("removeNode refusing", () => {
  it("keeps the client when something tries to remove it", () => {
    const before = chain();
    const after = removeNode(before, "client");
    expect(after).toBe(before);
    expect(after.topology.nodes.map((node) => node.id)).toContain("client");
  });

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
