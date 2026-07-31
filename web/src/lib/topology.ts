/**
 * The design contract, mirrored from the Go engine.
 *
 * These types are the JSON tags in `engine/internal/model` written out in
 * TypeScript. There is no code generation for five types, so the mirror is
 * kept honest two ways: the `Fields` maps below fail to compile if a field is
 * renamed on this side, and `topology.test.ts` reads the engine's own embedded
 * scenario off disk and checks that every key in it is one of these.
 *
 * A drift here is not a type error at the boundary — it is a request the
 * engine accepts and answers about a different design, because `/simulate`
 * refuses unknown fields but says nothing about ones this side forgot to send.
 */

export const NODE_KINDS = ["client", "loadBalancer", "service", "cache", "database"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const ALGORITHMS = ["roundRobin", "leastConnections", "random"] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

export interface LoadBalancerParams {
  algorithm: Algorithm;
  overheadMs: number;
}

export interface ServiceParams {
  instances: number;
  meanServiceMs: number;
  /** Zero means unbounded: requests queue rather than being rejected. */
  queueCapacity: number;
}

export interface CacheParams {
  hitRatio: number;
  hitLatencyMs: number;
}

export interface DatabaseParams {
  replicas: number;
  meanReadMs: number;
  meanWriteMs: number;
  poolSize: number;
}

/**
 * One component in a design.
 *
 * The parameter fields are a union: exactly the one naming `kind` is set. The
 * engine rejects a cache carrying a connection pool rather than ignoring it,
 * so this side has to build the same shape rather than a flat bag of numbers.
 */
export interface DesignNode {
  id: string;
  kind: NodeKind;
  label?: string;
  loadBalancer?: LoadBalancerParams;
  service?: ServiceParams;
  cache?: CacheParams;
  database?: DatabaseParams;
}

export interface DesignEdge {
  from: string;
  to: string;
}

export interface Topology {
  nodes: DesignNode[];
  edges: DesignEdge[];
}

export interface Workload {
  rateRps: number;
  readFraction: number;
  durationMs: number;
  seed: number;
  warmupFraction: number;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  goal: string;
  topology: Topology;
  workload: Workload;
}

/**
 * Why a component of one kind cannot call another, or null if it can.
 *
 * The rule and its reason in one place, because they are the same fact: a
 * refusal a user cannot act on is only half a rule. Every sentence names the
 * fix rather than the mistake — someone drawing a client straight onto a
 * database is not confused about what they drew, they are missing the thing
 * that belongs between.
 *
 * Mirrors `NodeKind.Calls` in engine/internal/model/kind.go, and the two have
 * to move together. The engine is the authority: it refuses the same designs
 * with the same boundaries, and this exists so the refusal arrives while the
 * pointer is still down instead of after a run.
 *
 * A switch rather than a lookup, so adding a kind to the contract fails to
 * compile until someone has decided what it may talk to.
 */
function callsOf(kind: NodeKind): readonly NodeKind[] {
  switch (kind) {
    case "client":
      return ["loadBalancer", "service"];
    case "loadBalancer":
      return ["loadBalancer", "service"];
    case "service":
      return ["loadBalancer", "service", "cache", "database"];
    case "cache":
      return ["cache", "database"];
    case "database":
      return [];
  }
}

export function whyNotCall(from: NodeKind, to: NodeKind): string | null {
  if (callsOf(from).includes(to)) {
    return null;
  }
  if (to === "client") {
    return "The client is where load comes from. Nothing sends traffic back to it.";
  }
  if (from === "client") {
    return "A client does not reach into your storage. Put a service in front — what owns the data is what talks to it.";
  }
  if (from === "loadBalancer") {
    return "A load balancer spreads requests over servers, not over storage. Point it at a service, and let the service read.";
  }
  if (from === "cache") {
    return "A cache answers what it holds and falls through to what is behind it. Behind it is a store, not a caller.";
  }
  // Only a database reaches this line. A service may call everything except
  // the client, and the client was answered above — so there is no branch for
  // one here, and writing an unreachable one would be writing a sentence
  // nobody can ever be shown.
  return "A database answers queries; it does not call anything. Whatever needs the data asks for it.";
}

/** Which parameter key a kind carries. A client carries none: the load it
 *  offers is the workload, not a property of the component. */
export type ParamsKey = "loadBalancer" | "service" | "cache" | "database";

/**
 * Every field of T, exactly.
 *
 * An object literal typed as this must list each key once: a missing key is a
 * type error and an extra one is an excess property. That is what makes the
 * runtime key lists below trustworthy enough for the contract test to compare
 * against the engine's JSON.
 */
type Fields<T> = Record<keyof T, true>;

export const PARAMS_KEY = {
  client: null,
  loadBalancer: "loadBalancer",
  service: "service",
  cache: "cache",
  database: "database",
} as const satisfies Record<NodeKind, ParamsKey | null>;

export const PARAM_FIELDS = {
  loadBalancer: { algorithm: true, overheadMs: true },
  service: { instances: true, meanServiceMs: true, queueCapacity: true },
  cache: { hitRatio: true, hitLatencyMs: true },
  database: { replicas: true, meanReadMs: true, meanWriteMs: true, poolSize: true },
} satisfies {
  loadBalancer: Fields<LoadBalancerParams>;
  service: Fields<ServiceParams>;
  cache: Fields<CacheParams>;
  database: Fields<DatabaseParams>;
};

export const NODE_FIELDS = {
  id: true,
  kind: true,
  label: true,
  loadBalancer: true,
  service: true,
  cache: true,
  database: true,
} satisfies Fields<Required<DesignNode>>;

export const EDGE_FIELDS = { from: true, to: true } satisfies Fields<DesignEdge>;

export const WORKLOAD_FIELDS = {
  rateRps: true,
  readFraction: true,
  durationMs: true,
  seed: true,
  warmupFraction: true,
} satisfies Fields<Workload>;

export const SCENARIO_FIELDS = {
  id: true,
  title: true,
  description: true,
  goal: true,
  topology: true,
  workload: true,
} satisfies Fields<Scenario>;

/**
 * Parameters a new component starts with.
 *
 * They are deliberately not zeroes. Every field here is validated by the
 * engine, and half of them are rejected at zero — a service with no instances,
 * a database with an empty pool — so a component dropped onto the canvas has
 * to arrive already simulable or the first run after every drop is an error
 * message about a number the user never chose.
 */
export const DEFAULT_PARAMS = {
  loadBalancer: { algorithm: "leastConnections", overheadMs: 0.5 },
  service: { instances: 4, meanServiceMs: 8, queueCapacity: 500 },
  cache: { hitRatio: 0.85, hitLatencyMs: 0.5 },
  database: { replicas: 1, meanReadMs: 12, meanWriteMs: 30, poolSize: 2 },
} satisfies Record<ParamsKey, unknown> & {
  loadBalancer: LoadBalancerParams;
  service: ServiceParams;
  cache: CacheParams;
  database: DatabaseParams;
};

/**
 * A new component of the given kind, ready to simulate.
 *
 * Written as a switch rather than a lookup by `PARAMS_KEY[kind]` so that each
 * branch names its own field: the union is what the engine checks, and an
 * assignment through a computed key would type-check against any member of it.
 * The switch is also what the exhaustiveness rule can see, so adding a kind
 * fails the build here the way it fails `exhaustive` on the Go side.
 */
export function newNode(kind: NodeKind, id: string, label?: string): DesignNode {
  const base: DesignNode = label === undefined ? { id, kind } : { id, kind, label };
  switch (kind) {
    case "client":
      return base;
    case "loadBalancer":
      return { ...base, loadBalancer: { ...DEFAULT_PARAMS.loadBalancer } };
    case "service":
      return { ...base, service: { ...DEFAULT_PARAMS.service } };
    case "cache":
      return { ...base, cache: { ...DEFAULT_PARAMS.cache } };
    case "database":
      return { ...base, database: { ...DEFAULT_PARAMS.database } };
  }
}

/** The load a new design starts under: enough traffic to show a queue, short
 *  enough to answer while someone is still looking at the screen. */
export function defaultWorkload(): Workload {
  return { rateRps: 300, readFraction: 0.95, durationMs: 60_000, seed: 1, warmupFraction: 0.2 };
}
