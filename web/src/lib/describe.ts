import { formatLatency } from "@/lib/format";
import type { Algorithm, DesignNode, NodeKind } from "@/lib/topology";

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
