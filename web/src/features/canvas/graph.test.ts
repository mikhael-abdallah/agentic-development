import { describe, expect, it, vi } from "vitest";

import {
  applyEdits,
  edgeId,
  editsFromEdgeChanges,
  editsFromNodeChanges,
  toFlowEdges,
  toFlowNodes,
} from "@/features/canvas/graph";
import { type Design, addNode, connect, emptyDesign, selectNode } from "@/lib/design";

const SOMEWHERE = { x: 10, y: 20 };

/** client -> service -> database. The service is not decoration: a client does
 *  not call a database, and `connect` refuses the edge that says it does. */
function chain(): Design {
  let design = addNode(emptyDesign(), "service", SOMEWHERE);
  design = addNode(design, "database", SOMEWHERE);
  design = connect(design, "client", "service");
  return connect(design, "service", "database");
}

describe("toFlowNodes", () => {
  it("places every component where the design put it", () => {
    const nodes = toFlowNodes(chain());
    expect(nodes.map((node) => node.id)).toEqual(["client", "service", "database"]);
    expect(nodes[2]?.position).toEqual(SOMEWHERE);
  });

  // A component with no position would otherwise be laid out by React Flow at
  // whatever `undefined` means to it, which is a crash in some versions and a
  // stack of nodes at the origin in others.
  it("gives a component with no position one anyway", () => {
    const design = chain();
    design.positions.delete("database");
    expect(toFlowNodes(design)[2]?.position).toEqual({ x: 0, y: 0 });
  });

  it("carries the selection so the canvas does not keep its own", () => {
    const nodes = toFlowNodes(selectNode(chain(), "database"));
    expect(nodes.map((node) => node.selected)).toEqual([false, false, true]);
  });

  it("shows a component's own label when it has one", () => {
    expect(toFlowNodes(emptyDesign())[0]?.data.name).toBe("Client");
  });

  it("falls back to the name of the kind when it has none", () => {
    expect(toFlowNodes(chain())[2]?.data.name).toBe("Database");
  });

  it("summarises the parameters that decide how it behaves", () => {
    expect(toFlowNodes(chain())[2]?.data.summary).toContain("replicas");
  });
});

describe("toFlowEdges", () => {
  it("carries both endpoints, so nothing has to parse an id to find them", () => {
    const edges = toFlowEdges(chain().topology);
    expect(edges.map(({ id, source, target }) => ({ id, source, target }))).toEqual([
      { id: edgeId("client", "service"), source: "client", target: "service" },
      { id: edgeId("service", "database"), source: "service", target: "database" },
    ]);
  });

  it("gives two edges between different components different ids", () => {
    let design = addNode(chain(), "cache", SOMEWHERE);
    design = connect(design, "service", "cache");
    const ids = toFlowEdges(design.topology).map((edge) => edge.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("editsFromNodeChanges", () => {
  it("turns a drag into a move", () => {
    expect(
      editsFromNodeChanges([
        { id: "db", type: "position", position: { x: 3, y: 4 }, dragging: true },
      ]),
    ).toEqual([{ type: "move", id: "db", to: { x: 3, y: 4 } }]);
  });

  // React Flow reports a position change with no position while a drag is
  // starting. Treating that as a move would snap the component to nowhere.
  it("ignores a position change that carries no position", () => {
    expect(editsFromNodeChanges([{ id: "db", type: "position", dragging: true }])).toEqual([]);
  });

  it("turns a deletion into a removal", () => {
    expect(editsFromNodeChanges([{ id: "db", type: "remove" }])).toEqual([
      { type: "remove", id: "db" },
    ]);
  });

  // Selection and measurement are React Flow's business. Treating either as an
  // edit would rewrite the design every time a pointer moved over it.
  it("ignores everything that is not an edit to the design", () => {
    expect(
      editsFromNodeChanges([
        { id: "db", type: "select", selected: true },
        { id: "db", type: "dimensions", dimensions: { width: 10, height: 10 } },
      ]),
    ).toEqual([]);
  });
});

describe("editsFromEdgeChanges", () => {
  it("finds both endpoints of a removed connection", () => {
    const topology = chain().topology;
    expect(
      editsFromEdgeChanges([{ id: edgeId("service", "database"), type: "remove" }], topology),
    ).toEqual([{ type: "unlink", from: "service", to: "database" }]);
  });

  // Endpoints are looked up through the same function that built the id, not
  // split back out of it — so a component named with an arrow in it removes
  // the connection it was asked to rather than a different one, or none.
  it("handles a component whose id contains the id separator", () => {
    const topology = {
      nodes: [
        { id: "a->b", kind: "service" as const },
        { id: "c", kind: "cache" as const },
      ],
      edges: [{ from: "a->b", to: "c" }],
    };
    expect(editsFromEdgeChanges([{ id: edgeId("a->b", "c"), type: "remove" }], topology)).toEqual([
      { type: "unlink", from: "a->b", to: "c" },
    ]);
  });

  it("ignores a removal of a connection the design does not have", () => {
    expect(editsFromEdgeChanges([{ id: "ghost->ghost", type: "remove" }], chain().topology)).toEqual(
      [],
    );
  });

  it("ignores a change that is not a removal", () => {
    expect(
      editsFromEdgeChanges(
        [{ id: edgeId("client", "service"), type: "select", selected: true }],
        chain().topology,
      ),
    ).toEqual([]);
  });
});

describe("applyEdits", () => {
  it("sends every edit to the matching operation and nothing else", () => {
    const controller = { move: vi.fn(), drop: vi.fn(), unlink: vi.fn() };
    applyEdits(
      [
        { type: "move", id: "a", to: { x: 1, y: 2 } },
        { type: "remove", id: "b" },
        { type: "unlink", from: "c", to: "d" },
      ],
      controller,
    );
    expect(controller.move).toHaveBeenCalledExactlyOnceWith("a", { x: 1, y: 2 });
    expect(controller.drop).toHaveBeenCalledExactlyOnceWith("b");
    expect(controller.unlink).toHaveBeenCalledExactlyOnceWith("c", "d");
  });
});

// React Flow honours `deletable` itself, on the Backspace it handles without
// asking the design. Marking the client is what closes that path.
describe("toFlowNodes deletability", () => {
  it("marks the client as the one component that cannot be deleted", () => {
    const design = addNode(emptyDesign(), "cache", { x: 0, y: 0 });
    const flow = toFlowNodes(design);
    expect(flow.find((node) => node.id === "client")?.deletable).toBe(false);
    expect(flow.find((node) => node.id === "cache")?.deletable).toBe(true);
  });
});

// An arrow between two boxes says the two are connected and nothing about what
// connects them, which is what made a design read as a picture rather than as
// a system.
describe("toFlowEdges labelling", () => {
  it("says what crosses each connection", () => {
    const labels = toFlowEdges(chain().topology).map((edge) => edge.label);
    expect(labels).toEqual(["every request", "every request"]);
  });

  // The one kind that forwards less than it receives, and the reason a cache
  // is worth drawing at all.
  it("says a cache passes on only what it could not answer", () => {
    let design = addNode(emptyDesign(), "service", SOMEWHERE);
    design = addNode(design, "cache", SOMEWHERE);
    design = addNode(design, "database", SOMEWHERE);
    design = connect(design, "client", "service");
    design = connect(design, "service", "cache");
    design = connect(design, "cache", "database");
    expect(design.topology.edges).toHaveLength(3);
    const carried = new Map(
      toFlowEdges(design.topology).map((edge) => [edge.id, edge.label]),
    );
    expect(carried.get(edgeId("cache", "database"))).toBe("misses, and every write");
    expect(carried.get(edgeId("service", "cache"))).toBe("every request");
  });
});
