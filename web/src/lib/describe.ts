import { formatLatency } from "@/lib/format";
import type { Algorithm, DesignNode, NodeKind, Topology } from "@/lib/topology";

/**
 * What a component is called and what it does, in the words the palette and
 * the canvas both use.
 *
 * These are switches rather than lookup tables so the exhaustiveness rule can
 * see them: adding a kind to the contract fails the build here, the way adding
 * one to the Go enum fails `exhaustive`. A kind that reached the palette
 * without a name would render as an empty button.
 */
export function kindLabel(kind: NodeKind): string {
  switch (kind) {
    case "client":
      return "Client";
    case "loadBalancer":
      return "Load balancer";
    case "service":
      return "Service";
    case "cache":
      return "Cache";
    case "database":
      return "Database";
  }
}

export function kindBlurb(kind: NodeKind): string {
  switch (kind) {
    case "client":
      return "Where the load comes from. A design has exactly one.";
    case "loadBalancer":
      return "Spreads requests over everything it fans out to.";
    case "service":
      return "A pool of identical instances with a queue in front.";
    case "cache":
      return "Answers a share of reads without going downstream.";
    case "database":
      return "A primary, optional read replicas, and a connection pool.";
  }
}

export function algorithmLabel(algorithm: Algorithm): string {
  switch (algorithm) {
    case "roundRobin":
      return "round robin";
    case "leastConnections":
      return "least connections";
    case "random":
      return "random";
  }
}

/**
 * The parameters that decide how a component behaves, in one line.
 *
 * Not every parameter — the ones whose value changes the shape of the answer.
 * A service is its concurrency and its service time; a cache is its hit ratio.
 * The rest are a click away in the inspector, and a node that listed them all
 * would be a form rather than a diagram.
 */
export function describeParams(node: DesignNode): string {
  switch (node.kind) {
    case "client":
      return "offers the workload";
    case "loadBalancer":
      return node.loadBalancer === undefined
        ? ""
        : algorithmLabel(node.loadBalancer.algorithm);
    case "service":
      return node.service === undefined
        ? ""
        : `${String(node.service.instances)} × ${formatLatency(node.service.meanServiceMs)}`;
    case "cache":
      return node.cache === undefined
        ? ""
        : `${(node.cache.hitRatio * 100).toFixed(0)}% hits`;
    case "database":
      return node.database === undefined
        ? ""
        : `${String(node.database.replicas)} replicas · ${formatLatency(node.database.meanReadMs)} read`;
  }
}

/**
 * What travels along a connection out of a component of this kind.
 *
 * An edge on the canvas said nothing about what crossed it, which made a
 * design a picture of boxes rather than of a system. The contract belongs to
 * the *source*: an edge carries whatever the component at its tail forwards,
 * and only a cache forwards less than it receives.
 *
 * Every line here is a claim about `sim.engine`, not a guess:
 *
 *   - A request is drawn read-or-write once, at arrival, and carries that flag
 *     the whole way. It cannot be a read at the cache and a write at the store.
 *   - Only a cache can answer a request itself; everything else forwards.
 *   - `answered() = hit && req.read`, so a write is never a hit.
 *
 * Which makes a cache's outgoing edge "misses, and every write" — under every
 * write policy but one. Measured against the shipped shortener at 0.95 reads
 * and a 0.85 hit ratio: the store saw 0.1882 of what the cache saw, against
 * 0.15 × 0.95 + 0.05 = 0.1925 predicted, agreement to within the noise of ten
 * thousand requests.
 *
 * Write-back is the exception and the reason this takes a component rather
 * than a kind. Under it the cache acknowledges the write and the store catches
 * up outside the request, so nothing crosses this edge but misses. A label
 * that read "and every write" there would be stating a contract the simulator
 * does not honour — which is worse than an unlabelled arrow, because it is an
 * unlabelled arrow someone believed.
 *
 * Derived from the kinds rather than from a finished run on purpose. Dividing
 * one component's served count by another's gives the share on the edge only
 * when the target has a single inbound edge, and is quietly wrong the moment a
 * design fans in. The per-component numbers a run does produce are in the
 * results panel, where they are not pretending to be per-edge.
 */
export function edgeContract(from: DesignNode): string {
  switch (from.kind) {
    case "client":
      return "every request";
    case "loadBalancer":
      return "its share of every request";
    case "service":
      return "every request";
    case "cache":
      return from.cache?.writePolicy === "writeBack"
        ? "misses only — writes stop at the cache"
        : "misses, and every write";
    case "database":
      // A database has no outgoing edge — `whyNotCall` refuses every one of
      // them — so this is here to keep the switch total rather than to be
      // read. It stays a sentence in case a later kind changes that.
      return "nothing: a database is the end of the line";
  }
}

/** One end of a connection, and what crosses it. */
export interface Contract {
  /** The id of the component at the other end. Carried alongside the name
   *  because names are not unique: two unnamed services both show as
   *  "Service", and both may feed the same target. */
  readonly id: string;
  /** What to call the component at the other end. */
  readonly other: string;
  readonly carries: string;
}

/**
 * What this component is handed, and what it passes on.
 *
 * Read off the design's own edges rather than from the kind. A database fed by
 * a cache receives what the cache could not answer; a database a service reads
 * directly receives everything that service handles. Answering from the kind
 * alone would have to pick one of those and be wrong about the other — and it
 * would be wrong quietly, in a sentence stating a contract.
 */
export function contractsOf(
  topology: Topology,
  id: string,
): { incoming: Contract[]; outgoing: Contract[] } {
  const nodeOf = new Map(topology.nodes.map((node) => [node.id, node]));
  const nameOf = (other: string) => {
    const node = nodeOf.get(other);
    return node === undefined ? other : (node.label ?? kindLabel(node.kind));
  };
  const carriedBy = (from: string) => {
    const node = nodeOf.get(from);
    return node === undefined ? "" : edgeContract(node);
  };
  const incoming = topology.edges
    .filter((edge) => edge.to === id)
    .map((edge) => ({
      id: edge.from,
      other: nameOf(edge.from),
      carries: carriedBy(edge.from),
    }));
  const outgoing = topology.edges
    .filter((edge) => edge.from === id)
    .map((edge) => ({
      id: edge.to,
      other: nameOf(edge.to),
      carries: carriedBy(id),
    }));
  return { incoming, outgoing };
}
