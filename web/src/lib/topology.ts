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

/**
 * Which way a write goes past a cache. Mirrors WritePolicy in
 * engine/internal/model/kind.go, safe default first.
 *
 * A read is what a cache exists for and the hit ratio settles it. A write
 * cannot be answered from a cache — the store has to record it — so the only
 * question left is what the cache does on the way, and these are the three
 * ordinary answers. They put different load on the store and give the caller
 * different answers about when a write is done.
 */
export const WRITE_POLICIES = ["writeThrough", "writeAround", "writeBack"] as const;
export type WritePolicy = (typeof WRITE_POLICIES)[number];

export interface LoadBalancerParams {
  algorithm: Algorithm;
  overheadMs: number;
}

/**
 * One thing a service can be asked to do, and what that costs it. Mirrors
 * Endpoint in engine/internal/model/params.go.
 *
 * A service is not equally fast at everything it serves. Looking a short code
 * up and writing a new one are the same pool of servers doing two jobs whose
 * costs are nothing like each other, and averaging them into one number puts
 * the same load on the pool whichever way the traffic goes — which is the
 * question anyone drawing this wants to ask.
 *
 * Two fields where one might do, and the separation is the point. `name` is
 * what a person calls it, `GET /{code}`, and is the API being designed.
 * `operation` is which of the workload's traffic arrives here. An API's shape
 * does not change when the traffic mix does.
 */
export interface Endpoint {
  name: string;
  /** An operation named in the workload. One this run does not offer is not
   *  an error — an API has more endpoints than any load exercises — it simply
   *  never fires. */
  operation: string;
  /** Replaces the service's own mean for this operation. */
  meanServiceMs: number;
}

export interface ServiceParams {
  instances: number;
  meanServiceMs: number;
  /** Zero means unbounded: requests queue rather than being rejected. */
  queueCapacity: number;
  /**
   * The API this service exposes, and what each call costs.
   *
   * Optional and sparse. A service without one behaves exactly as services did
   * before endpoints existed, and adding one can never make a component
   * invalid — there is always a mean to fall back to. The engine omits it from
   * the wire when empty, so `PARAM_FIELDS` cannot require it.
   */
  endpoints?: Endpoint[];
}

export interface CacheParams {
  hitRatio: number;
  hitLatencyMs: number;
  writePolicy: WritePolicy;
}

/**
 * One field of a table, and whether it can be looked up by. Mirrors Column in
 * engine/internal/model/params.go.
 *
 * Indexed is the whole of it, because indexed or not is the whole of what this
 * model can act on. A type or a width changes what a row costs to store and
 * nothing about what a query costs to answer, and a field that moved no number
 * would be decoration.
 */
export interface Column {
  name: string;
  indexed: boolean;
}

/**
 * What a database holds, and how much of it.
 *
 * `rows` is the load-bearing number. A query that can use an index reads the
 * rows it matches; one that cannot reads the table — so the size of the table
 * is what turns a missing index from a detail into an outage.
 */
export interface Table {
  name: string;
  rows: number;
  columns: Column[];
}

/**
 * What one operation asks of a table.
 *
 * The point of the whole schema in four fields: an operation, a table, the
 * column it looks rows up by, and how many rows it expects. Whether that column
 * carries an index is the difference between reading `rowsMatched` rows and
 * reading the table.
 */
export interface Query {
  /** An operation named in the workload, the same link an endpoint uses. */
  operation: string;
  table: string;
  /** The column rows are found by. Unindexed means a scan. */
  by: string;
  rowsMatched: number;
}

export interface DatabaseParams {
  replicas: number;
  /** What answering anything costs, before the rows a query reads are counted. */
  meanReadMs: number;
  meanWriteMs: number;
  poolSize: number;
  /** The schema, optional together. A database declaring neither costs its
   *  means for everything, which is what every database did before a schema
   *  could be written. */
  tables?: Table[];
  queries?: Query[];
  /** What reading a million rows costs. Required once there are tables, and
   *  deliberately without a default: converting rows into milliseconds needs a
   *  number, and any the engine chose would be invented. */
  scanPerMillionRowsMs?: number;
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
  /**
   * What carries requests along this connection — "HTTP/1.1", "gRPC", a queue.
   *
   * It has no effect on the simulation, and that is stated rather than hidden.
   * The alternative was a list of protocols with a latency for each, and there
   * is no honest source for those numbers: what gRPC costs against HTTP depends
   * on the payload, the language, the proxy in between and the machine, and a
   * built-in table of plausible figures would be an invention every result then
   * rested on. `perCallMs` is where a number that moves the answer goes, and it
   * is the user's number.
   *
   * `label` on a component has exactly this status.
   */
  transport?: string;
  /** What this connection adds to every request crossing it. Time in flight:
   *  it occupies neither component. */
  perCallMs?: number;
}

export interface Topology {
  nodes: DesignNode[];
  edges: DesignEdge[];
}

/**
 * What an operation does to the data behind a design. Mirrors OperationKind in
 * engine/internal/model/workload.go.
 *
 * Two, and not because systems only do two things. This is the distinction the
 * simulation can act on: a read may be answered by a cache or by a replica, and
 * a write may not. Anything finer is either invisible to the model or is
 * already the operation's own service time.
 */
export const OPERATION_KINDS = ["read", "write"] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/**
 * One thing a design is asked to do, and how much of the traffic asks for it.
 *
 * A URL shortener resolves short codes and shortens long ones, and those are
 * not the same request: one is answered from a cache almost every time and the
 * other has to reach the store. Saying so is the difference between a design
 * that reads as "browser, balancer, service, cache, database" and one that says
 * what is actually flowing through it.
 *
 * The name has no effect on the run. It is what the canvas shows and what
 * results are broken down by; the kind and the share are what the engine uses.
 */
export interface Operation {
  name: string;
  kind: OperationKind;
  share: number;
}

export interface Workload {
  rateRps: number;
  /** What the arrivals are asking for, and in what proportion. The shares add
   *  up to one, which the engine checks on every run. */
  operations: Operation[];
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

/**
 * Why one component cannot call another, given what each is set to be.
 *
 * `whyNotCall` above asks the same question of the kinds alone. This asks it of
 * the components, because one rule needs to see a parameter: a client may not
 * call a service that runs more than one instance.
 *
 * That rule is the twin of the one refusing fan-out. Fan-out is refused because
 * a component with two things behind it has no defined answer for where a
 * request goes. A pool is the same question inside one component — the
 * simulation runs `instances` requests at once through a single queue, which is
 * only what a real pool does if something is spreading requests evenly across
 * the instances. A load balancer is that something.
 *
 * Only from a client, and not because the arithmetic differs. A service calling
 * a pool may well be doing the spreading itself — a mesh sidecar, a resolver
 * handing out addresses — and nothing here can tell whether it does. Load
 * arriving from outside has no such story available: the client is the one
 * component in a design that nobody owns, so there is nothing there to do it.
 *
 * Mirrors `clientToPool` in engine/internal/model/validate.go.
 */
export function whyNotSend(from: DesignNode, to: DesignNode): string | null {
  const kinds = whyNotCall(from.kind, to.kind);
  if (kinds !== null) {
    return kinds;
  }
  const instances = to.service?.instances ?? 1;
  if (from.kind === "client" && instances > 1) {
    return `That service runs ${String(instances)} instances, and nothing here would choose between them. Put a load balancer in front: deciding which instance a request goes to is the whole of its job.`;
  }
  return null;
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
  service: { instances: true, meanServiceMs: true, queueCapacity: true, endpoints: true },
  cache: { hitRatio: true, hitLatencyMs: true, writePolicy: true },
  database: {
    replicas: true,
    meanReadMs: true,
    meanWriteMs: true,
    poolSize: true,
    tables: true,
    queries: true,
    scanPerMillionRowsMs: true,
  },
} satisfies {
  loadBalancer: Fields<LoadBalancerParams>;
  service: Fields<Required<ServiceParams>>;
  cache: Fields<CacheParams>;
  database: Fields<Required<DatabaseParams>>;
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

/**
 * Parameter fields the engine leaves off the wire when they are empty.
 *
 * Mirrors the `omitempty` tags in engine/internal/model/params.go, and exists
 * so the contract test can tell "this design does not describe its API" from
 * "this side invented a field". Without it, either every preset would have to
 * carry every optional key or the test would have to stop comparing key sets —
 * and the second is the check that catches a field dropped on this side, which
 * is the failure that gets accepted and answered about a different design.
 */
export const OMITTED_WHEN_EMPTY = [
  "endpoints",
  "transport",
  "perCallMs",
  "tables",
  "queries",
  "scanPerMillionRowsMs",
];

export const ENDPOINT_FIELDS = {
  name: true,
  operation: true,
  meanServiceMs: true,
} satisfies Fields<Endpoint>;

// There are deliberately no TABLE_FIELDS, COLUMN_FIELDS or QUERY_FIELDS here
// yet. The field maps exist so `topology.test.ts` can walk the engine's own
// embedded preset and compare key sets against it — and no preset declares a
// schema, so those maps would be exported for a test that compared an empty
// list against an empty list. They arrive with the preset that uses them.
//
// The decode path is not unguarded in the meantime: `clipboard.test.ts` holds a
// fixture carrying every field of every kind, schema included, and round-trips
// it.

export const EDGE_FIELDS = {
  from: true,
  to: true,
  transport: true,
  perCallMs: true,
} satisfies Fields<Required<DesignEdge>>;

export const WORKLOAD_FIELDS = {
  rateRps: true,
  operations: true,
  durationMs: true,
  seed: true,
  warmupFraction: true,
} satisfies Fields<Workload>;

export const OPERATION_FIELDS = {
  name: true,
  kind: true,
  share: true,
} satisfies Fields<Operation>;

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
  // One instance, and fast enough that the default load sits at about
  // three-fifths of what it can serve — the same comfortable starting point
  // four instances at 8 ms used to give.
  //
  // One rather than four because a client may not call a pool directly, and a
  // service that arrived as a pool would mean the first connection anyone drew
  // on a fresh design was refused. Starting at one server and being told to put
  // a balancer in front at the moment a second is added is the lesson in the
  // right order; being told it before there is anything to balance is a wall.
  service: { instances: 1, meanServiceMs: 2, queueCapacity: 500 },
  cache: { hitRatio: 0.85, hitLatencyMs: 0.5, writePolicy: "writeThrough" },
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

/**
 * The load a new design starts under: enough traffic to show a queue, short
 * enough to answer while someone is still looking at the screen.
 *
 * Two operations rather than one, because one would say nothing. A workload
 * that only reads never touches a write path, and a new design would show a
 * cache and a database behaving as though writes did not exist — which is the
 * shape of the question this whole model exists to make askable. The names are
 * deliberately generic: what a design's operations are called is the first
 * thing worth changing, and a suggestion is easier to edit than a blank.
 */
export function defaultWorkload(): Workload {
  return {
    rateRps: 300,
    operations: [
      { name: "read", kind: "read", share: 0.95 },
      { name: "write", kind: "write", share: 0.05 },
    ],
    durationMs: 60_000,
    seed: 1,
    warmupFraction: 0.2,
  };
}
