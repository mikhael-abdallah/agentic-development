import { afterEach, describe, expect, it } from "vitest";

import { designOfSaved, deleteDesign, designsSnapshot, noSavedDesigns, saveDesign, subscribeToDesigns } from "@/lib/designStore";
import { addNode, connect, emptyDesign } from "@/lib/design";
import type { Topology } from "@/lib/topology";

const KEY = "simulator.designs";

/** client -> service -> database. Routed through a service because a client
 *  does not call a database: `connect` refuses that edge, and a fixture built
 *  on a refused edge is a fixture with no edge in it. */
function chain(): Topology {
  let design = addNode(emptyDesign(), "service", { x: 0, y: 0 });
  design = addNode(design, "database", { x: 0, y: 0 });
  design = connect(design, "client", "service");
  return connect(design, "service", "database").topology;
}

afterEach(() => {
  window.localStorage.clear();
});

describe("saveDesign", () => {
  it("keeps a design across a reload", () => {
    saveDesign("mine", chain());
    expect(designsSnapshot().map((saved) => saved.name)).toEqual(["mine"]);
  });

  it("replaces an earlier design of the same name rather than doubling it", () => {
    saveDesign("mine", chain());
    saveDesign("mine", emptyDesign().topology);
    expect(designsSnapshot()).toHaveLength(1);
    expect(designsSnapshot()[0]?.topology.nodes).toHaveLength(1);
  });

  it("keeps designs under different names apart", () => {
    saveDesign("a", chain());
    saveDesign("b", emptyDesign().topology);
    expect(designsSnapshot().map((saved) => saved.name)).toEqual(["a", "b"]);
  });
});

describe("deleteDesign", () => {
  it("removes the one named and no other", () => {
    saveDesign("a", chain());
    saveDesign("b", chain());
    deleteDesign("a");
    expect(designsSnapshot().map((saved) => saved.name)).toEqual(["b"]);
  });
});

describe("designsSnapshot", () => {
  it("is empty before anything has been saved", () => {
    expect(designsSnapshot()).toEqual([]);
  });

  // useSyncExternalStore compares by identity. A snapshot rebuilt on every
  // call would hand it a new array each time and re-render forever.
  it("returns the same array until something changes", () => {
    saveDesign("a", chain());
    expect(designsSnapshot()).toBe(designsSnapshot());
    saveDesign("b", chain());
    expect(designsSnapshot()).not.toBe(designsSnapshot.length === 0 ? null : []);
    expect(designsSnapshot()).toHaveLength(2);
  });

  // localStorage is shared with everything else on the origin and outlives
  // every version of this app that ever ran in this browser. What comes out of
  // it is untrusted in the same sense a request body is.
  it.each([
    ["not JSON at all", "{["],
    ["not a list", '{"name":"a"}'],
    ["an entry with no name", '[{"topology":{"nodes":[],"edges":[]}}]'],
    ["an entry with no topology", '[{"name":"a"}]'],
    ["a component with an unknown kind", '[{"name":"a","topology":{"nodes":[{"id":"x","kind":"quantum"}],"edges":[]}}]'],
    ["a component with no id", '[{"name":"a","topology":{"nodes":[{"kind":"cache"}],"edges":[]}}]'],
    ["an edge that is not a pair of names", '[{"name":"a","topology":{"nodes":[],"edges":[{"from":1,"to":2}]}}]'],
  ])("drops %s rather than opening on it", (_name, stored) => {
    window.localStorage.setItem(KEY, stored);
    expect(designsSnapshot()).toEqual([]);
  });

  it("keeps the readable entries when one of them is not", () => {
    saveDesign("good", chain());
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown[];
    window.localStorage.setItem(KEY, JSON.stringify([...stored, { name: "bad" }]));
    expect(designsSnapshot().map((saved) => saved.name)).toEqual(["good"]);
  });
});

describe("subscribeToDesigns", () => {
  it("tells this tab about its own writes, which the storage event does not", () => {
    let told = 0;
    const stop = subscribeToDesigns(() => {
      told += 1;
    });
    saveDesign("a", chain());
    deleteDesign("a");
    stop();
    saveDesign("b", chain());
    expect(told).toBe(2);
  });
});

describe("designOfSaved", () => {
  // Coordinates saved in one window and reopened in another no longer mean
  // anything, so they are not stored and a layout is rebuilt instead.
  it("lays the design out again rather than restoring where it was drawn", () => {
    const design = designOfSaved({ name: "a", topology: chain() });
    expect(design.positions.size).toBe(design.topology.nodes.length);
    expect(design.selected).toBeNull();
  });
});

describe("noSavedDesigns", () => {
  // There is no storage while the page is prerendered. Returning a constant is
  // what keeps hydration from seeing two different answers.
  it("is the same empty list every time", () => {
    expect(noSavedDesigns()).toBe(noSavedDesigns());
  });
});
