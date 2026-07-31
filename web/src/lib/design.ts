import {
  type DesignNode,
  type NodeKind,
  type Scenario,
  type Topology,
  newNode,
  whyNotCall,
} from "@/lib/topology";

export interface Position {
  x: number;
  y: number;
}

/**
 * A design as the browser holds it.
 *
 * Positions sit beside the topology rather than inside it, because the engine
 * simulates a graph and has no opinion about where it was drawn — putting
 * coordinates in the contract would mean every scenario file, every request
 * body and every future transport carried layout the simulation ignores. It
 * also means a scenario arriving from the engine has none, so one is computed:
 * see `layoutOf`.
 *
 * A Map rather than an object because the keys are component ids the user
 * chose, and an object indexed by user input is the shape prototype pollution
 * takes.
 */
export interface Design {
  topology: Topology;
  positions: Map<string, Position>;
  selected: string | null;
}

/** Horizontal gap between layers and vertical gap between siblings. */
const LAYER_X = 240;
const ROW_Y = 110;
const ORIGIN: Position = { x: 60, y: 60 };

/** Which cell of the layout grid a position is standing on. Rounded rather
 *  than floored, so a component dragged a little off a cell still counts as
 *  occupying it — the question this answers is "would something land on top of
 *  this", and near enough is on top. */
function cellOf(at: Position): string {
  const column = Math.round((at.x - ORIGIN.x) / LAYER_X);
  const row = Math.round((at.y - ORIGIN.y) / ROW_Y);
  return [column, row].join(",");
}

/**
 * Where a component added without a place of its own goes.
 *
 * Clicking a palette entry used to drop every component on one fixed point, so
 * the second landed exactly on top of the first and the third on top of both:
 * three components, one visible box, and nothing on screen saying the others
 * were there. This walks the same grid `layoutOf` uses and returns the first
 * cell nothing is standing on, scanning each row left to right so a design
 * grows the way its traffic flows.
 *
 * The scan is bounded and cannot fall through: it covers (n+1)² cells for n
 * components, so a free one always exists inside it.
 */
export function freeSpot(design: Design): Position {
  const taken = new Set([...design.positions.values()].map(cellOf));
  const span = design.positions.size;
  for (let row = 0; row <= span; row++) {
    for (let column = 0; column <= span; column++) {
      const at = { x: ORIGIN.x + column * LAYER_X, y: ORIGIN.y + row * ROW_Y };
      if (!taken.has(cellOf(at))) {
        return at;
      }
    }
  }
  return ORIGIN;
}

/**
 * Which components a design has, as one string.
 *
 * The canvas brings the view back to the design when this changes, rather than
 * when the design does. A design changes on every pixel of a drag, and
 * re-fitting the view mid-drag would fight the hand doing the dragging. What
 * has to bring it back is a component arriving or leaving — which is exactly
 * when something can end up outside the window, and the whole design with it.
 */
export function componentSignature(topology: Topology): string {
  return topology.nodes.map((node) => node.id).join("|");
}

/** A design needs exactly one client to be simulable, so a new one starts
 *  with it already placed rather than with an error nobody asked for. */
export function emptyDesign(): Design {
  const client = newNode("client", "client", "Client");
  return {
    topology: { nodes: [client], edges: [] },
    positions: new Map([[client.id, ORIGIN]]),
    selected: null,
  };
}

/** An id no component in the design is using, derived from the kind so the
 *  first database is `database` rather than `database-1`. */
export function uniqueId(topology: Topology, kind: NodeKind): string {
  const taken = new Set(topology.nodes.map((node) => node.id));
  if (!taken.has(kind)) {
    return kind;
  }
  for (let n = 2; ; n++) {
    const candidate = `${kind}-${String(n)}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

export function addNode(design: Design, kind: NodeKind, at: Position): Design {
  const node = newNode(kind, uniqueId(design.topology, kind));
  return {
    topology: { ...design.topology, nodes: [...design.topology.nodes, node] },
    positions: new Map(design.positions).set(node.id, at),
    selected: node.id,
  };
}

/**
 * Why this component cannot be removed, or null if it can.
 *
 * The mirror of `whyNotConnect`, and there for the same reason: a design the
 * engine will refuse is better prevented while it is being drawn than
 * explained after a run fails. The client is where load comes from and a
 * design has exactly one, so removing it leaves a design that cannot be
 * simulated and nothing to put back in its place.
 */
export function whyNotRemove(design: Design, id: string): string | null {
  const node = design.topology.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) {
    return "That component is not in this design.";
  }
  if (node.kind === "client") {
    return "Every design needs its client: it is where the load comes from.";
  }
  return null;
}

/** Removing a component takes its edges with it: an edge to a component that
 *  is not there is the one thing the engine cannot even report a design for. */
export function removeNode(design: Design, id: string): Design {
  if (whyNotRemove(design, id) !== null) {
    return design;
  }
  const positions = new Map(design.positions);
  positions.delete(id);
  return {
    topology: {
      nodes: design.topology.nodes.filter((node) => node.id !== id),
      edges: design.topology.edges.filter((edge) => edge.from !== id && edge.to !== id),
    },
    positions,
    selected: design.selected === id ? null : design.selected,
  };
}

export function moveNode(design: Design, id: string, to: Position): Design {
  if (!design.positions.has(id)) {
    return design;
  }
  return { ...design, positions: new Map(design.positions).set(id, to) };
}

export function selectNode(design: Design, id: string | null): Design {
  return { ...design, selected: id };
}

export function replaceNode(design: Design, node: DesignNode): Design {
  return {
    ...design,
    topology: {
      ...design.topology,
      nodes: design.topology.nodes.map((existing) => (existing.id === node.id ? node : existing)),
    },
  };
}

/**
 * Why this edge cannot be drawn, or null if it can.
 *
 * Every rule here is one the engine enforces too, and that is the point: an
 * edge the engine will reject is better refused while the pointer is still
 * down than accepted onto a canvas that then refuses to run. The reasons are
 * prose because they are shown to whoever drew it.
 */
export function whyNotConnect(design: Design, from: string, to: string): string | null {
  if (from === to) {
    return "A component cannot call itself.";
  }
  // Both ends, not just the far one. An edge from a component that is not
  // there is exactly as unsimulable as an edge to one, and the engine reports
  // it the same way — but only after the design has been drawn and run.
  const source = design.topology.nodes.find((node) => node.id === from);
  const target = design.topology.nodes.find((node) => node.id === to);
  if (source === undefined || target === undefined) {
    return "That component is not in this design.";
  }
  // Which kinds may talk to which, before the questions about this particular
  // pair of components: "a load balancer does not call a database" is a truer
  // thing to be told than "that connection is already there".
  const kinds = whyNotCall(source.kind, target.kind);
  if (kinds !== null) {
    return kinds;
  }
  if (design.topology.edges.some((edge) => edge.from === from && edge.to === to)) {
    return "That connection is already there.";
  }
  if (reaches(design.topology, to, from)) {
    return "Requests would flow in a circle.";
  }
  return null;
}

export function connect(design: Design, from: string, to: string): Design {
  if (whyNotConnect(design, from, to) !== null) {
    return design;
  }
  return {
    ...design,
    topology: { ...design.topology, edges: [...design.topology.edges, { from, to }] },
  };
}

export function disconnect(design: Design, from: string, to: string): Design {
  return {
    ...design,
    topology: {
      ...design.topology,
      edges: design.topology.edges.filter((edge) => !(edge.from === from && edge.to === to)),
    },
  };
}

/** Whether `target` is downstream of `start`, following edges forwards. */
function reaches(topology: Topology, start: string, target: string): boolean {
  const seen = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || seen.has(id)) {
      continue;
    }
    if (id === target) {
      return true;
    }
    seen.add(id);
    pending.push(...topology.edges.filter((edge) => edge.from === id).map((edge) => edge.to));
  }
  return false;
}

/**
 * Coordinates for a topology that arrived without any.
 *
 * A component sits one layer right of the furthest thing that calls it, which
 * for the request path these designs describe reads left to right in the order
 * a request meets them. Longest path rather than shortest, so a component
 * reached both directly and through a chain lands after the chain instead of
 * on top of it.
 *
 * Relaxed |nodes| times over the edge list rather than walked recursively: it
 * cannot recurse forever on a design that has a cycle, and a design being
 * edited is allowed to be wrong in ways a validated one is not.
 */
export function layoutOf(topology: Topology): Map<string, Position> {
  const depth = new Map(topology.nodes.map((node) => [node.id, 0]));
  // One pass per component is enough for the longest chain one can have.
  for (let remaining = topology.nodes.length; remaining > 0; remaining--) {
    for (const edge of topology.edges) {
      const before = depth.get(edge.from);
      const after = depth.get(edge.to);
      if (before === undefined || after === undefined || after > before) {
        continue;
      }
      depth.set(edge.to, before + 1);
    }
  }
  const filled = new Map<number, number>();
  const positions = new Map<string, Position>();
  for (const node of topology.nodes) {
    const layer = depth.get(node.id) ?? 0;
    const row = filled.get(layer) ?? 0;
    filled.set(layer, row + 1);
    positions.set(node.id, { x: ORIGIN.x + layer * LAYER_X, y: ORIGIN.y + row * ROW_Y });
  }
  return positions;
}

/** A scenario from the engine, ready to draw. */
export function designOf(scenario: Scenario): Design {
  return {
    topology: scenario.topology,
    positions: layoutOf(scenario.topology),
    selected: null,
  };
}
