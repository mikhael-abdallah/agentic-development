import type { Edge, EdgeChange, Node, NodeChange } from "@xyflow/react";

import type { DesignController } from "@/features/canvas/useDesign";
import type { Design, Position } from "@/lib/design";
import { describeParams, edgeContract, kindLabel } from "@/lib/describe";
import type { NodeKind, Topology } from "@/lib/topology";

/**
 * What a canvas node needs to draw itself.
 *
 * The design's own `DesignNode` is deliberately not passed through: the canvas
 * draws a name, a kind and a summary, and handing it the parameter union as
 * well would let a rendering change start depending on simulation semantics.
 */
interface ComponentData extends Record<string, unknown> {
  kind: NodeKind;
  name: string;
  summary: string;
}

export type ComponentNode = Node<ComponentData, "component">;

/** The id an edge carries on the canvas. Edges have no identity in the
 *  contract — their endpoints are their identity — so one is derived. */
export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

/**
 * What React Flow has measured each component to be.
 *
 * Kept beside the design rather than in it. How wide a box comes out is a fact
 * about the font and the window, not about the system being designed, and a
 * design that carried it would save it to the library and post it to the
 * engine, neither of which has any use for a pixel.
 */
export type Sizes = Map<string, { width: number; height: number }>;

/** What React Flow measured in a batch of changes, if anything. */
export function measuredIn(changes: NodeChange<ComponentNode>[]): Sizes {
  const sizes: Sizes = new Map();
  for (const change of changes) {
    if (change.type === "dimensions" && change.dimensions !== undefined) {
      sizes.set(change.id, { ...change.dimensions });
    }
  }
  return sizes;
}

/**
 * The design's components, as React Flow draws them.
 *
 * Handing each one back the size it was measured at is the whole reason this
 * takes a second argument. React Flow will not paint a component it has no
 * size for — until a measurement lands the node is rendered with
 * `visibility: hidden` — and it throws the measurement away whenever it is
 * handed a node object it does not recognise, which is every object here every
 * time the design changes. The design changes on every pixel of a drag, so
 * dragging one component blanked every component on the canvas over and over:
 * 143 disappearances across all five components of the preset during a single
 * drag of one of them.
 *
 * A component nothing has measured yet gets no size, which is right: it has
 * none until it has been laid out once, and React Flow holds it back for that
 * one frame rather than painting it at nothing.
 */
export function toFlowNodes(design: Design, sizes: Sizes): ComponentNode[] {
  return design.topology.nodes.map((node) => ({
    id: node.id,
    type: "component",
    position: design.positions.get(node.id) ?? { x: 0, y: 0 },
    selected: design.selected === node.id,
    // React Flow deletes on a keypress of its own, without asking the design.
    // Saying so here is what stops Backspace from taking the client with it
    // and leaving a design nothing can put load through.
    deletable: node.kind !== "client",
    measured: sizes.get(node.id),
    data: {
      kind: node.kind,
      name: node.label ?? kindLabel(node.kind),
      summary: describeParams(node),
    },
  }));
}

/**
 * Edges, each labelled with what crosses it.
 *
 * An unlabelled arrow says two components are connected and nothing about what
 * connects them, which is what makes a design read as a picture of boxes. The
 * label is the source's contract: an edge carries whatever the component at its
 * tail forwards, and a cache is the only kind that forwards less than it
 * receives.
 */
export function toFlowEdges(topology: Topology): Edge[] {
  const nodeOf = new Map(topology.nodes.map((node) => [node.id, node]));
  return topology.edges.map((edge) => {
    const source = nodeOf.get(edge.from);
    return {
      id: edgeId(edge.from, edge.to),
      source: edge.from,
      target: edge.to,
      label: source === undefined ? undefined : edgeContract(source),
      labelShowBg: true,
    };
  });
}

/**
 * One thing a batch of canvas changes does to the design.
 *
 * React Flow reports everything it does — a node was selected, measured,
 * moved, removed — and only some of that is an edit to the design. Deciding
 * which is a decision, and a decision inside an event handler is one nothing
 * can test: the handler only ever runs behind pointer events over measured
 * geometry, which is exactly what a headless DOM does not have.
 */
export type DesignEdit =
  | { type: "move"; id: string; to: Position }
  | { type: "remove"; id: string }
  | { type: "unlink"; from: string; to: string };

export function editsFromNodeChanges(changes: NodeChange<ComponentNode>[]): DesignEdit[] {
  const edits: DesignEdit[] = [];
  for (const change of changes) {
    if (change.type === "position" && change.position !== undefined) {
      edits.push({ type: "move", id: change.id, to: change.position });
    }
    if (change.type === "remove") {
      edits.push({ type: "remove", id: change.id });
    }
  }
  return edits;
}

/**
 * A removed edge's endpoints, looked up rather than parsed out of its id.
 *
 * The id is `from->to`, and splitting it back apart works right until a
 * component is called something with an arrow in it — at which point the wrong
 * connection is removed, or none is, and the canvas keeps drawing one the
 * design no longer has. Finding it through the same function that built the id
 * cannot come apart that way.
 */
export function editsFromEdgeChanges(
  changes: EdgeChange<Edge>[],
  topology: Topology,
): DesignEdit[] {
  const edits: DesignEdit[] = [];
  for (const change of changes) {
    if (change.type !== "remove") {
      continue;
    }
    const edge = topology.edges.find(
      (candidate) => edgeId(candidate.from, candidate.to) === change.id,
    );
    if (edge !== undefined) {
      edits.push({ type: "unlink", from: edge.from, to: edge.to });
    }
  }
  return edits;
}

export function applyEdits(
  edits: DesignEdit[],
  controller: Pick<DesignController, "move" | "drop" | "unlink">,
): void {
  for (const edit of edits) {
    switch (edit.type) {
      case "move":
        controller.move(edit.id, edit.to);
        break;
      case "remove":
        controller.drop(edit.id);
        break;
      case "unlink":
        controller.unlink(edit.from, edit.to);
        break;
    }
  }
}
