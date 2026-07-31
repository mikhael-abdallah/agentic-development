import { type Design, layoutOf } from "@/lib/design";
import { NODE_KINDS, type NodeKind, type Topology } from "@/lib/topology";

/**
 * Designs someone saved, kept in the browser.
 *
 * localStorage rather than a server, because there is no account to hang a
 * design on and this simulator has nothing to say about who anyone is. It also
 * means a saved design survives a reload and nothing more — which is the honest
 * promise, and the one the UI makes.
 */
const KEY = "simulator.designs";

/** Fired after this tab writes, because the `storage` event is only delivered
 *  to the *other* tabs on the origin. Without it the list would update
 *  everywhere except where the save happened. */
const CHANGED = "simulator.designs.changed";

export interface SavedDesign {
  name: string;
  topology: Topology;
}

/**
 * What is stored is the topology and nothing else.
 *
 * Not the positions: where a component was drawn is not part of the design,
 * and coordinates saved from one window and reopened in another no longer mean
 * anything. `layoutOf` rebuilds them — the same thing a scenario arriving from
 * the engine gets.
 */
export function designOfSaved(saved: SavedDesign): Design {
  return { topology: saved.topology, positions: layoutOf(saved.topology), selected: null };
}

function isKind(value: unknown): value is NodeKind {
  return typeof value === "string" && NODE_KINDS.includes(value as NodeKind);
}

/**
 * Whether this came back looking like a design.
 *
 * localStorage is shared with everything else on the origin and outlives every
 * version of this app that has ever run in this browser, so what comes out of
 * it is untrusted in the same sense a request body is. The check is shallow on
 * purpose: it covers what the canvas would crash on. Whether the design can
 * actually be *simulated* is the engine's answer to give, and it gives a better
 * one than anything reimplemented here.
 */
function isTopology(value: unknown): value is Topology {
  const { nodes, edges } = (value ?? {}) as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return false;
  }
  const nodesLook = nodes.every((node: unknown) => {
    const { id, kind } = (node ?? {}) as { id?: unknown; kind?: unknown };
    return typeof id === "string" && isKind(kind);
  });
  const edgesLook = edges.every((edge: unknown) => {
    const { from, to } = (edge ?? {}) as { from?: unknown; to?: unknown };
    return typeof from === "string" && typeof to === "string";
  });
  return nodesLook && edgesLook;
}

function isSaved(value: unknown): value is SavedDesign {
  const { name, topology } = (value ?? {}) as { name?: unknown; topology?: unknown };
  return typeof name === "string" && name !== "" && isTopology(topology);
}

/**
 * Anything unreadable is dropped rather than reported. A corrupt entry is not
 * something the person in front of the screen did or can fix, and refusing to
 * open the list because one of them is wrong loses the others too.
 */
function parse(raw: string | null): SavedDesign[] {
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(isSaved) : [];
}

// useSyncExternalStore compares snapshots by identity, so parsing afresh on
// every call would hand it a new array each time and loop forever. The cache is
// keyed on the raw string, which is the only thing that can have changed.
let cachedRaw: string | null = null;
let cached: SavedDesign[] = [];

export function designsSnapshot(): SavedDesign[] {
  const raw = window.localStorage.getItem(KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse(raw);
  }
  return cached;
}

/** There is no storage while the page is being prerendered, and nothing saved
 *  in it. Returning a constant keeps hydration from seeing two answers. */
const NONE: SavedDesign[] = [];

export function noSavedDesigns(): SavedDesign[] {
  return NONE;
}

export function subscribeToDesigns(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function write(designs: SavedDesign[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(designs));
  window.dispatchEvent(new Event(CHANGED));
}

/** Saves under a name, replacing an earlier design of the same name. */
export function saveDesign(name: string, topology: Topology): void {
  write([...designsSnapshot().filter((saved) => saved.name !== name), { name, topology }]);
}

export function deleteDesign(name: string): void {
  write(designsSnapshot().filter((saved) => saved.name !== name));
}
