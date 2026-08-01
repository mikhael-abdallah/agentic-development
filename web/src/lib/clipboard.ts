/**
 * A component as text, for the system clipboard.
 *
 * Copy and paste go through the browser's real clipboard rather than a
 * variable held in the page, and the difference is worth stating because the
 * variable is the easier build. A page-local buffer makes Ctrl+V paste a
 * component even when the last thing the user copied was a sentence from
 * somewhere else — the app would be answering a gesture that was not aimed at
 * it. Going through the clipboard means the browser decides what is on it, so
 * copying anything else replaces the component, which is what someone pressing
 * those keys already believes.
 *
 * The text is JSON under a tag. The tag is what makes pasting the rest of the
 * world into this app do nothing at all: without it, any JSON on the clipboard
 * that happened to have a `kind` field would become a component.
 *
 * Everything here treats the clipboard as untrusted, because it is — it holds
 * whatever the user last copied, from anywhere. A component only comes back if
 * every field is present and of the type the contract says, and `decodeNode`
 * returns null rather than repairing what it was given. A repaired component
 * is one carrying numbers nobody chose, which the simulation would then answer
 * questions about.
 */

import {
  ALGORITHMS,
  type CacheParams,
  type DatabaseParams,
  type DesignNode,
  type LoadBalancerParams,
  NODE_KINDS,
  type NodeKind,
  type ServiceParams,
  WRITE_POLICIES,
} from "@/lib/topology";

/**
 * What marks clipboard text as a component from this app.
 *
 * Versioned, so that a change to what a component carries can be recognised
 * rather than half-read: text written by a later build is refused by an
 * earlier one instead of decoding into a component missing whatever was added.
 */
const TAG = "system-design-simulator/component@1";

/** A component as clipboard text. Indented because it lands in whatever the
 *  user pastes into next, and that is sometimes an editor. */
export function encodeNode(node: DesignNode): string {
  return JSON.stringify({ tag: TAG, node }, null, 2);
}

/**
 * The fields of an object, or null if that is not what this is.
 *
 * A Map rather than the object itself: every lookup below uses a key that came
 * off the clipboard, and reading a user-supplied key out of an object is how
 * `__proto__` stops being an ordinary string.
 */
function fieldsOf(value: unknown): Map<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return new Map(Object.entries(value));
}

/** A finite number, or null. Rejecting NaN and infinities here rather than at
 *  the engine, which would report them as a failed run of a valid-looking
 *  design. */
function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One of the values the contract allows for a field, or null. */
function choice<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") {
    return null;
  }
  return allowed.find((option) => option === value) ?? null;
}

/** A non-empty string, or null. */
function nameOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

// One reader per kind of parameters, each naming every field it builds.
//
// That repetition is the point rather than a cost to be factored away. The
// return type is the contract's own interface, so adding a parameter to
// `ServiceParams` makes the matching reader below fail to compile with the
// field missing — which is exactly the drift this file would otherwise have:
// a decoder that quietly drops a parameter it was never taught about, and a
// pasted component that differs from the one copied in a way nothing reports.

function loadBalancerOf(value: unknown): LoadBalancerParams | null {
  const fields = fieldsOf(value);
  if (fields === null) {
    return null;
  }
  const algorithm = choice(fields.get("algorithm"), ALGORITHMS);
  const overheadMs = numberOf(fields.get("overheadMs"));
  if (algorithm === null || overheadMs === null) {
    return null;
  }
  return { algorithm, overheadMs };
}

function serviceOf(value: unknown): ServiceParams | null {
  const fields = fieldsOf(value);
  if (fields === null) {
    return null;
  }
  const instances = numberOf(fields.get("instances"));
  const meanServiceMs = numberOf(fields.get("meanServiceMs"));
  const queueCapacity = numberOf(fields.get("queueCapacity"));
  if (instances === null || meanServiceMs === null || queueCapacity === null) {
    return null;
  }
  return { instances, meanServiceMs, queueCapacity };
}

function cacheOf(value: unknown): CacheParams | null {
  const fields = fieldsOf(value);
  if (fields === null) {
    return null;
  }
  const hitRatio = numberOf(fields.get("hitRatio"));
  const hitLatencyMs = numberOf(fields.get("hitLatencyMs"));
  const writePolicy = choice(fields.get("writePolicy"), WRITE_POLICIES);
  if (hitRatio === null || hitLatencyMs === null || writePolicy === null) {
    return null;
  }
  return { hitRatio, hitLatencyMs, writePolicy };
}

function databaseOf(value: unknown): DatabaseParams | null {
  const fields = fieldsOf(value);
  if (fields === null) {
    return null;
  }
  const replicas = numberOf(fields.get("replicas"));
  const meanReadMs = numberOf(fields.get("meanReadMs"));
  const meanWriteMs = numberOf(fields.get("meanWriteMs"));
  const poolSize = numberOf(fields.get("poolSize"));
  if (replicas === null || meanReadMs === null || meanWriteMs === null || poolSize === null) {
    return null;
  }
  return { replicas, meanReadMs, meanWriteMs, poolSize };
}

/**
 * A component of the given kind, carrying the parameters that kind needs.
 *
 * A switch rather than a lookup by `PARAMS_KEY[kind]`, for the same reason
 * `newNode` is one: the parameter fields are a union and an assignment through
 * a computed key would type-check against any member of it. This way adding a
 * kind to the contract fails to compile until someone has decided what it
 * carries.
 */
function nodeOf(base: DesignNode, kind: NodeKind, fields: Map<string, unknown>): DesignNode | null {
  switch (kind) {
    case "client":
      return base;
    case "loadBalancer": {
      const loadBalancer = loadBalancerOf(fields.get("loadBalancer"));
      return loadBalancer === null ? null : { ...base, loadBalancer };
    }
    case "service": {
      const service = serviceOf(fields.get("service"));
      return service === null ? null : { ...base, service };
    }
    case "cache": {
      const cache = cacheOf(fields.get("cache"));
      return cache === null ? null : { ...base, cache };
    }
    case "database": {
      const database = databaseOf(fields.get("database"));
      return database === null ? null : { ...base, database };
    }
  }
}

/** JSON, or null — `JSON.parse` throws on anything that is not, and the
 *  clipboard usually holds something that is not. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The component in this clipboard text, or null if there is not one.
 *
 * Null covers every way this can fail — text that is not JSON, JSON without
 * the tag, a component of a kind this build does not have, a parameter of the
 * wrong type — and they are one answer on purpose. What the caller does with
 * any of them is the same thing: leave the paste to the browser, which is what
 * pressing Ctrl+V over a canvas should do when the clipboard holds a sentence.
 */
export function decodeNode(text: string): DesignNode | null {
  const envelope = fieldsOf(parsed(text));
  // Not an object, or an object without the tag, are the same answer: text
  // from somewhere else. Most of what a clipboard holds lands here.
  if (envelope?.get("tag") !== TAG) {
    return null;
  }
  const fields = fieldsOf(envelope.get("node"));
  if (fields === null) {
    return null;
  }
  const id = nameOf(fields.get("id"));
  const kind = choice(fields.get("kind"), NODE_KINDS);
  const label = fields.get("label");
  if (id === null || kind === null || (label !== undefined && typeof label !== "string")) {
    return null;
  }
  const base: DesignNode = label === undefined ? { id, kind } : { id, kind, label };
  return nodeOf(base, kind, fields);
}
