import { describe, expect, it, vi } from "vitest";

import {
  type ComponentNode,
  type Sizes,
  applyEdits,
  edgeId,
  editsFromEdgeChanges,
  editsFromNodeChanges,
  measuredIn,
  toFlowEdges,
  toFlowNodes,
} from "@/features/canvas/graph";
import {
  type Design,
  addNode,
  connect,
  emptyDesign,
  moveNode,
  selectNode,
} from "@/lib/design";

const SOMEWHERE = { x: 10, y: 20 };

/** Nodes for a design nothing has measured yet — the state everything is in
 *  for one frame after a component arrives, and all most of these tests need. */
function flow(design: Design): ComponentNode[] {
  return toFlowNodes(design, new Map());
}

/** Every component measured to the same box, which is what they come out as
 *  once the browser has laid one row of them out. */
function allMeasured(design: Design): Sizes {
  return new Map(design.topology.nodes.map((node) => [node.id, { width: 152, height: 64 }]));
}

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
    const nodes = flow(chain());
    expect(nodes.map((node) => node.id)).toEqual(["client", "service", "database"]);
    expect(nodes[2]?.position).toEqual(SOMEWHERE);
  });

  // A component with no position would otherwise be laid out by React Flow at
  // whatever `undefined` means to it, which is a crash in some versions and a
  // stack of nodes at the origin in others.
  it("gives a component with no position one anyway", () => {
    const design = chain();
    design.positions.delete("database");
    expect(flow(design)[2]?.position).toEqual({ x: 0, y: 0 });
  });

  it("carries the selection so the canvas does not keep its own", () => {
    const nodes = flow(selectNode(chain(), "database"));
    expect(nodes.map((node) => node.selected)).toEqual([false, false, true]);
  });

  it("shows a component's own label when it has one", () => {
    expect(flow(emptyDesign())[0]?.data.name).toBe("Client");
  });

  it("falls back to the name of the kind when it has none", () => {
    expect(flow(chain())[2]?.data.name).toBe("Database");
  });

  it("summarises the parameters that decide how it behaves", () => {
    expect(flow(chain())[2]?.data.summary).toContain("replicas");
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
    const nodes = flow(design);
    expect(nodes.find((node) => node.id === "client")?.deletable).toBe(false);
    expect(nodes.find((node) => node.id === "cache")?.deletable).toBe(true);
  });
});

// The canvas went blank on every frame of a drag because a node rebuilt from
// the design carries no size, and React Flow renders a node it cannot size with
// `visibility: hidden`. Both of these fail against a `toFlowNodes` that does
// not hand the size back, which is what the canvas did when the bug was filed.
describe("toFlowNodes keeps measured sizes", () => {
  it("hands every component the size it was measured at", () => {
    const design = chain();
    const nodes = toFlowNodes(design, allMeasured(design));
    expect(nodes.map((node) => node.measured)).toEqual([
      { width: 152, height: 64 },
      { width: 152, height: 64 },
      { width: 152, height: 64 },
    ]);
  });

  // The one that matters: the design changes on every pixel of a drag, and
  // every component has to come back out of it still knowing its size.
  it("still hands it back after the design has moved a component", () => {
    const design = chain();
    const sizes = allMeasured(design);
    const moved = toFlowNodes(moveNode(design, "database", { x: 400, y: 400 }), sizes);
    expect(moved.map((node) => node.measured?.width)).toEqual([152, 152, 152]);
    expect(moved[2]?.position).toEqual({ x: 400, y: 400 });
  });

  it("leaves a component nothing has measured without a size", () => {
    expect(flow(emptyDesign())[0]?.measured).toBeUndefined();
  });
});

// Measurements arrive mixed in with everything else React Flow reports, and
// they are the only part of it the canvas has to keep.
describe("measuredIn", () => {
  it("picks out what was measured and nothing else", () => {
    const sizes = measuredIn([
      { id: "client", type: "dimensions", dimensions: { width: 152, height: 64 } },
      { id: "cache", type: "position", position: { x: 1, y: 2 } },
      { id: "db", type: "select", selected: true },
    ]);
    expect([...sizes]).toEqual([["client", { width: 152, height: 64 }]]);
  });

  it("finds nothing in a batch that measured nothing", () => {
    expect(measuredIn([{ id: "db", type: "position", position: { x: 1, y: 2 } }]).size).toBe(0);
  });
});
