import type { Edge, EdgeChange, Node, NodeChange } from "@xyflow/react";

import type { DesignController } from "@/features/canvas/useDesign";
import type { Design, Position } from "@/lib/design";
import { describeParams, kindLabel } from "@/lib/describe";
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

export function toFlowNodes(design: Design): ComponentNode[] {
  return design.topology.nodes.map((node) => ({
    id: node.id,
    type: "component",
    position: design.positions.get(node.id) ?? { x: 0, y: 0 },
    selected: design.selected === node.id,
    data: {
      kind: node.kind,
      name: node.label ?? kindLabel(node.kind),
      summary: describeParams(node),
    },
  }));
}

export function toFlowEdges(topology: Topology): Edge[] {
  return topology.edges.map((edge) => ({
    id: edgeId(edge.from, edge.to),
    source: edge.from,
    target: edge.to,
  }));
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
