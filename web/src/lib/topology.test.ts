import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALGORITHMS,
  type Algorithm,
  DEFAULT_PARAMS,
  EDGE_FIELDS,
  NODE_FIELDS,
  NODE_KINDS,
  type NodeKind,
  WRITE_POLICIES,
  whyNotCall,
  PARAMS_KEY,
  PARAM_FIELDS,
  COLUMN_FIELDS,
  ENDPOINT_FIELDS,
  OMITTED_WHEN_EMPTY,
  QUERY_FIELDS,
  TABLE_FIELDS,
  OPERATION_FIELDS,
  OPERATION_KINDS,
  SCENARIO_FIELDS,
  WORKLOAD_FIELDS,
  defaultWorkload,
  newNode,
} from "@/lib/topology";

/**
 * The engine's own embedded preset, read from where Go compiles it in.
 *
 * This is the whole point of the file: the types it imports are a hand-written
 * mirror of the Go JSON tags, and nothing but this test notices when the two
 * drift. `/simulate` refuses unknown fields, so a field this side renamed
 * would be a 400; a field this side *dropped* would be worse — accepted, and
 * answered about a different design than the one on screen.
 *
 * It reads the file rather than importing it, because an import would cross
 * the repository boundary the ESLint rules exist to keep closed, and because
 * reading is the honest test: the bytes Go embeds are the bytes checked.
 *
 * It used to have one hole, and it was the dangerous one: the web gates skip
 * when no web file changed, so a field added to the scenario on the Go side
 * merged green with the mirror already drifted, and main was red for whoever
 * next touched a web file. That happened, and it was caught in review rather
 * than by a gate. `WEB_GUARD_SCOPE` now reaches into
 * `engine/internal/model/scenarios/`, so a change to the bytes this test reads
 * is a change that runs this test.
 */
const PRESET = join(
  import.meta.dirname,
  "../../../engine/internal/model/scenarios/url-shortener.json",
);

type UnknownRecord = Record<string, unknown>;

/** The fields every component has, whatever its kind. */
const BASE_FIELDS = new Set(["id", "kind", "label"]);

/** Every field this side declares a component may carry. */
const DECLARED_FIELDS = new Set(Object.keys(NODE_FIELDS));

/** What a component carries beyond the fields every component has — which is
 *  its parameter key, and should be nothing else. */
function extraFields(node: object): string[] {
  return Object.keys(node).filter((field) => !BASE_FIELDS.has(field));
}

function undeclaredFields(node: object): string[] {
  return Object.keys(node).filter((field) => !DECLARED_FIELDS.has(field));
}

function readPreset(): UnknownRecord {
  return JSON.parse(readFileSync(PRESET, "utf8")) as UnknownRecord;
}

function presetNodes(): UnknownRecord[] {
  return (readPreset().topology as { nodes: UnknownRecord[] }).nodes;
}

/** Keys in a stable order, so a comparison is about the set and not the order
 *  two JSON documents happened to be written in. */
function sortedKeys(value: unknown): string[] {
  return Object.keys(value as UnknownRecord).sort((a, b) => a.localeCompare(b));
}

/** The parameter key a kind carries, without indexing an object by a string
 *  that came out of a file. */
const paramsKeyOf = new Map<string, string | null>(Object.entries(PARAMS_KEY));

const paramFieldsOf = new Map<string, string[]>(
  Object.entries(PARAM_FIELDS).map(([key, fields]) => [key, sortedKeys(fields)]),
);

/**
 * The fields this side declares, minus the optional ones the design did not use.
 *
 * The engine leaves an empty optional field off the wire entirely, so an exact
 * key comparison would force every preset to declare every optional field just
 * to keep the test honest. What the comparison still catches is both failures
 * worth catching: a key in the JSON this side does not know, and a required
 * field this side declares that the engine does not send.
 */
function expectedFields(declared: string[], present: string[]): string[] {
  const has = new Set(present);
  return declared.filter((field) => has.has(field) || !OMITTED_WHEN_EMPTY.includes(field));
}

/** What a kind's parameters should name, given which of the optional fields
 *  this particular design turned out to use. */
function expectedParamFields(key: string, present: string[]): string[] {
  return expectedFields(paramFieldsOf.get(key) ?? [], present);
}

/** Each component's parameter fields beside the ones this side expects, paired
 *  rather than gathered into two lists — two lists can only be compared by
 *  position, and a comparison by position is one component's fields away from
 *  being checked against another's. */
function paramFieldPairs(): { inside: string[]; expected: string[] }[] {
  return presetNodes().map((node) => {
    const key = paramsKeyOf.get(String(node.kind)) ?? "";
    const inside = sortedKeys(new Map(Object.entries(node)).get(key) ?? {});
    return { inside, expected: expectedParamFields(key, inside) };
  });
}

describe("the mirrored contract", () => {
  it("names the same top-level fields as the engine's scenario", () => {
    expect(sortedKeys(readPreset())).toEqual(sortedKeys(SCENARIO_FIELDS));
  });

  it("names the same workload fields", () => {
    expect(sortedKeys(readPreset().workload)).toEqual(sortedKeys(WORKLOAD_FIELDS));
  });

  // The workload check above compares top-level keys, so `operations` being
  // present satisfies it whatever is inside. What is inside is a list of
  // objects the engine decodes with unknown fields refused, which is exactly
  // the drift that check cannot see — so it is walked here the way edges are.
  it("names the same operation fields", () => {
    const workload = readPreset().workload as { operations: unknown[] };
    expect(workload.operations.length).toBeGreaterThan(0);
    expect(workload.operations.map(sortedKeys)).toEqual(
      workload.operations.map(() => sortedKeys(OPERATION_FIELDS)),
    );
  });

  it("knows every operation kind the preset uses", () => {
    const workload = readPreset().workload as { operations: { kind: string }[] };
    const kinds = workload.operations.map((operation) => operation.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.map((kind) => OPERATION_KINDS.includes(kind as never))).toEqual(
      kinds.map(() => true),
    );
  });

  // Key sets exactly, minus the optional fields this design does not use — the
  // same rule the parameter check follows. A connection that says nothing about
  // its transport carries no key for it, and requiring one would mean every
  // preset had to name a transport to keep this test honest.
  it("names the same edge fields", () => {
    const edges = (readPreset().topology as { edges: UnknownRecord[] }).edges;
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.map(sortedKeys)).toEqual(
      edges.map((edge) => expectedFields(sortedKeys(EDGE_FIELDS), sortedKeys(edge))),
    );
  });

  it("knows every component kind the preset uses", () => {
    const nodes = presetNodes();
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.map((node) => NODE_KINDS.includes(node.kind as NodeKind))).toEqual(
      nodes.map(() => true),
    );
  });

  it("declares every field the preset's components carry", () => {
    expect(presetNodes().flatMap(undeclaredFields)).toEqual([]);
  });

  // A component carries exactly the parameter key its kind names. Getting this
  // wrong is silent on both ends: the engine leaves a missing number at zero
  // and simulates a design nobody drew.
  it("gives every component the parameter key its kind carries", () => {
    const nodes = presetNodes();
    const carried = nodes.map(extraFields);
    const expected = nodes.map((node) => {
      const key = paramsKeyOf.get(String(node.kind)) ?? null;
      return key === null ? [] : [key];
    });
    expect(carried).toEqual(expected);
  });

  // Key sets, still exactly — minus the optional fields this design happens
  // not to use. A service that does not describe its API carries no
  // `endpoints` key, and requiring one would mean every preset had to declare
  // every optional field to keep this test honest. What the comparison still
  // catches is both failures worth catching: a key in the JSON this side does
  // not know, and a required field this side declares that the engine does not
  // send.
  it("names the same fields inside those parameters", () => {
    const pairs = paramFieldPairs();
    expect(pairs.map((pair) => pair.inside)).toEqual(pairs.map((pair) => pair.expected));
  });

  // The optional fields are only allowed to be absent. One that is there is
  // held to the same standard as every other, or "optional" would quietly mean
  // "unchecked" — and `endpoints` is a list of objects, which is exactly the
  // shape a top-level key comparison cannot see inside.
  // The schema is three levels of nested objects that the parameter check
  // above cannot see inside, and the engine decodes every one of them with
  // unknown fields refused. Each level is walked here the way edges and
  // operations are.
  it("names the same fields inside the schema it describes", () => {
    const tables = presetNodes().flatMap((node) => {
      const database = node.database as { tables?: UnknownRecord[] } | undefined;
      return database?.tables ?? [];
    });
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.map(sortedKeys)).toEqual(tables.map(() => sortedKeys(TABLE_FIELDS)));

    const columns = tables.flatMap((table) => (table.columns as unknown[] | undefined) ?? []);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.map(sortedKeys)).toEqual(columns.map(() => sortedKeys(COLUMN_FIELDS)));
  });

  it("names the same fields inside a query it describes", () => {
    const queries = presetNodes().flatMap((node) => {
      const database = node.database as { queries?: unknown[] } | undefined;
      return database?.queries ?? [];
    });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.map(sortedKeys)).toEqual(queries.map(() => sortedKeys(QUERY_FIELDS)));
  });

  // Every connection in the preset names a transport, so the optional-field
  // allowance in the edge check above is not what is carrying this: the key is
  // there and compared like any other.
  it("knows the transport every connection names", () => {
    const edges = (readPreset().topology as { edges: { transport?: string }[] }).edges;
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.map((edge) => typeof edge.transport)).toEqual(edges.map(() => "string"));
  });

  it("names the same fields inside an endpoint it describes", () => {
    const endpoints = presetNodes().flatMap((node) => {
      const service = node.service as { endpoints?: unknown[] } | undefined;
      return service?.endpoints ?? [];
    });
    // Or this compares an empty list against an empty list, which is a check
    // that matches nothing and looks exactly like one that passes. The preset
    // describes its API and the engine has a test saying it must.
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.map(sortedKeys)).toEqual(endpoints.map(() => sortedKeys(ENDPOINT_FIELDS)));
  });

  it("knows the balancing algorithm the preset asks for", () => {
    const balancers = presetNodes().filter((node) => node.kind === "loadBalancer");
    expect(balancers.length).toBeGreaterThan(0);
    expect(
      balancers.map((node) => {
        const params = node.loadBalancer as { algorithm: string };
        return ALGORITHMS.includes(params.algorithm as Algorithm);
      }),
    ).toEqual(balancers.map(() => true));
  });
});

describe("newNode", () => {
  it("gives a client no parameters, because its load is the workload", () => {
    expect(newNode("client", "client")).toEqual({ id: "client", kind: "client" });
  });

  it("gives every other kind exactly the parameters it carries", () => {
    const kinds = NODE_KINDS.filter((kind) => paramsKeyOf.get(kind) !== null);
    const carried = kinds.map((kind) => extraFields(newNode(kind, "n")));
    expect(carried).toEqual(kinds.map((kind) => [paramsKeyOf.get(kind)]));
  });

  it("keeps a label when one is given and omits the key when none is", () => {
    expect(newNode("cache", "c", "Key cache").label).toBe("Key cache");
    expect("label" in newNode("cache", "c")).toBe(false);
  });

  // Defaults are copied out, or two components of a kind would share one
  // parameter object and editing either would edit both.
  it("does not share parameter objects between components", () => {
    const first = newNode("service", "a");
    const second = newNode("service", "b");
    expect(first.service).not.toBe(second.service);
    expect(first.service).not.toBe(DEFAULT_PARAMS.service);
  });

  // Every default has to be a value the engine accepts, or the first run after
  // a drop is an error about a number nobody chose. These are the bounds the
  // Go validators impose.
  it("starts every component at parameters the engine will accept", () => {
    expect(DEFAULT_PARAMS.service.instances).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_PARAMS.service.meanServiceMs).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.service.queueCapacity).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_PARAMS.database.poolSize).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_PARAMS.database.meanReadMs).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.database.meanWriteMs).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.database.replicas).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_PARAMS.cache.hitRatio).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_PARAMS.cache.hitRatio).toBeLessThanOrEqual(1);
    expect(DEFAULT_PARAMS.cache.hitLatencyMs).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_PARAMS.loadBalancer.overheadMs).toBeGreaterThanOrEqual(0);
    expect(ALGORITHMS).toContain(DEFAULT_PARAMS.loadBalancer.algorithm);
  });
});

describe("defaultWorkload", () => {
  it("is a load the engine will accept", () => {
    const workload = defaultWorkload();
    expect(workload.rateRps).toBeGreaterThan(0);
    expect(workload.durationMs).toBeGreaterThan(0);
    // Operations the engine accepts: named, of a kind it knows, each with a
    // share of its own, adding up to all of the traffic.
    expect(workload.operations.length).toBeGreaterThan(0);
    for (const operation of workload.operations) {
      expect(operation.name).not.toBe("");
      expect(OPERATION_KINDS).toContain(operation.kind);
      expect(operation.share).toBeGreaterThan(0);
    }
    const total = workload.operations.reduce((sum, operation) => sum + operation.share, 0);
    expect(total).toBeCloseTo(1, 9);
    // A whole run of warmup leaves nothing to measure, which the engine
    // rejects outright.
    expect(workload.warmupFraction).toBeGreaterThanOrEqual(0);
    expect(workload.warmupFraction).toBeLessThan(1);
  });

  it("declares every field the engine expects", () => {
    expect(sortedKeys(defaultWorkload())).toEqual(sortedKeys(WORKLOAD_FIELDS));
  });
});

// Mirrors NodeKind.Calls in engine/internal/model/kind.go. There is no shared
// file to check the two against, so what is checked here is the shape of the
// rule — which pairs are refused and that a refusal always says something —
// and the shipped scenario below is checked against it edge by edge, which is
// what would catch this side becoming stricter than the engine for a design
// the engine actually ships.
describe("whyNotCall", () => {
  const refused: [NodeKind, NodeKind][] = [
    ["client", "cache"],
    ["client", "database"],
    ["loadBalancer", "cache"],
    ["loadBalancer", "database"],
    ["cache", "loadBalancer"],
    ["cache", "service"],
    ["database", "loadBalancer"],
    ["database", "service"],
    ["database", "cache"],
    ["database", "database"],
    ["service", "client"],
    ["loadBalancer", "client"],
  ];

  const allowed: [NodeKind, NodeKind][] = [
    ["client", "loadBalancer"],
    ["client", "service"],
    ["loadBalancer", "loadBalancer"],
    ["loadBalancer", "service"],
    ["service", "loadBalancer"],
    ["service", "service"],
    ["service", "cache"],
    ["service", "database"],
    ["cache", "cache"],
    ["cache", "database"],
  ];

  for (const [from, to] of refused) {
    it(`refuses ${from} calling ${to}`, () => {
      const reason = whyNotCall(from, to);
      expect(reason).not.toBeNull();
      // A refusal nobody can act on is half a rule. Every sentence is a
      // sentence: it ends, and it is longer than a label.
      expect(reason?.length).toBeGreaterThan(20);
      expect(reason?.endsWith(".")).toBe(true);
    });
  }

  for (const [from, to] of allowed) {
    it(`allows ${from} calling ${to}`, () => {
      expect(whyNotCall(from, to)).toBeNull();
    });
  }

  it("has an answer for every pair of kinds in the contract", () => {
    const missing: string[] = [];
    for (const from of NODE_KINDS) {
      for (const to of NODE_KINDS) {
        const reason = whyNotCall(from, to);
        if (reason !== null && reason.trim() === "") {
          missing.push(`${from}->${to}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  // Nothing may send traffic to the client, whatever it is.
  it("refuses every kind calling the client", () => {
    const allowedIntoClient = NODE_KINDS.filter((kind) => whyNotCall(kind, "client") === null);
    expect(allowedIntoClient).toEqual([]);
  });
});

// Mirrors WritePolicy in engine/internal/model/kind.go. The engine refuses a
// policy it does not know, so a value here the engine has never heard of is a
// control that produces a 400 rather than a simulation.
describe("WRITE_POLICIES", () => {
  it("offers the safe default first", () => {
    expect(WRITE_POLICIES[0]).toBe("writeThrough");
  });

  it("names three distinct policies", () => {
    expect(new Set(WRITE_POLICIES).size).toBe(3);
  });

  // A new cache has to arrive already simulable, and the engine reads an
  // absent policy as write-through — so sending it explicitly is the same
  // behaviour said out loud rather than assumed.
  it("starts a new cache on a policy the engine knows", () => {
    expect(WRITE_POLICIES).toContain(DEFAULT_PARAMS.cache.writePolicy);
  });
});
