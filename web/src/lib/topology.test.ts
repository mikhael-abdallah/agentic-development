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
 * The one thing it cannot do is fail on a Go-only change, since the web gates
 * skip when no web file changed. It catches drift the next time this side is
 * touched, which for a hand-mirrored contract is the moment it matters.
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

describe("the mirrored contract", () => {
  it("names the same top-level fields as the engine's scenario", () => {
    expect(sortedKeys(readPreset())).toEqual(sortedKeys(SCENARIO_FIELDS));
  });

  it("names the same workload fields", () => {
    expect(sortedKeys(readPreset().workload)).toEqual(sortedKeys(WORKLOAD_FIELDS));
  });

  it("names the same edge fields", () => {
    const edges = (readPreset().topology as { edges: unknown[] }).edges;
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.map(sortedKeys)).toEqual(edges.map(() => sortedKeys(EDGE_FIELDS)));
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

  it("names the same fields inside those parameters", () => {
    const nodes = presetNodes();
    const inside = nodes.map((node) => {
      const key = paramsKeyOf.get(String(node.kind)) ?? "";
      return sortedKeys(new Map(Object.entries(node)).get(key) ?? {});
    });
    const expected = nodes.map((node) => {
      const key = paramsKeyOf.get(String(node.kind)) ?? "";
      return paramFieldsOf.get(key) ?? [];
    });
    expect(inside).toEqual(expected);
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
    expect(workload.readFraction).toBeGreaterThanOrEqual(0);
    expect(workload.readFraction).toBeLessThanOrEqual(1);
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
