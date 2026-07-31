import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Library } from "@/features/simulation/Library";
import { addNode, emptyDesign } from "@/lib/design";
import { designsSnapshot, saveDesign } from "@/lib/designStore";
import type { Scenario } from "@/lib/topology";

// Typed as a Scenario rather than left to inference: this stands in for what
// the engine sends, and an inferred `kind: string` would let a fixture drift
// into a shape /simulate would refuse.
const SHORTENER: Scenario = {
  id: "url-shortener",
  title: "URL shortener",
  description: "The canonical read-heavy path.",
  goal: "Raise rateRps and watch p99 pull away from the mean.",
  topology: {
    nodes: [
      { id: "client", kind: "client" },
      {
        id: "db",
        kind: "database",
        database: { replicas: 1, meanReadMs: 12, meanWriteMs: 30, poolSize: 2 },
      },
    ],
    edges: [{ from: "client", to: "db" }],
  },
  workload: { rateRps: 300, readFraction: 0.95, durationMs: 60000, seed: 1, warmupFraction: 0.2 },
};

function answers(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
      }),
    ),
  );
}

function library(onLoad = vi.fn()) {
  render(<Library topology={emptyDesign().topology} onLoad={onLoad} />);
  return onLoad;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Library", () => {
  it("offers the presets the engine ships", async () => {
    answers(200, [SHORTENER]);
    library();
    await waitFor(() => {
      expect(screen.getByText("URL shortener")).toBeDefined();
    });
    expect(screen.getByText("The canonical read-heavy path.")).toBeDefined();
  });

  it("loads a preset as a design that is already laid out", async () => {
    answers(200, [SHORTENER]);
    const onLoad = library();
    await waitFor(() => {
      expect(screen.getByText("URL shortener")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /URL shortener/ }));
    const loaded = onLoad.mock.calls[0]?.[0] as {
      positions: Map<string, unknown>;
      topology: { nodes: unknown[] };
    };
    expect(loaded.topology.nodes).toHaveLength(2);
    expect(loaded.positions.size).toBe(2);
  });

  // The goal is the reason a preset exists rather than a fixture. Showing it on
  // load is the difference between a design and a thing to try.
  it("says what to try with a preset once it is loaded", async () => {
    answers(200, [SHORTENER]);
    library();
    await waitFor(() => {
      expect(screen.getByText("URL shortener")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /URL shortener/ }));
    expect(screen.getByRole("status").textContent).toBe(SHORTENER.goal);
  });

  // The presets are a convenience. The Run button already says the engine is
  // unreachable in words, and an empty list with no explanation reads as a bug.
  it("says why there are no presets when the engine cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("nope"))));
    library();
    await waitFor(() => {
      expect(screen.getByText(/could not be reached/)).toBeDefined();
    });
  });

  // An empty list before the request has answered looks exactly like one after
  // it failed. Saying the engine is unreachable on the first paint of every
  // load is a claim that has not been earned yet, and it retracts itself a
  // moment later.
  it("does not call the engine unreachable before the request has answered", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    library();
    expect(screen.queryByText(/could not be reached/)).toBeNull();
  });

  it("saves the design under the name that was typed", async () => {
    answers(200, []);
    const drawn = addNode(emptyDesign(), "cache", { x: 0, y: 0 }).topology;
    render(<Library topology={drawn} onLoad={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Design name"), { target: { value: "  mine  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Saved as mine.");
    });
    // Trimmed, so "mine" and "mine " are not two designs.
    expect(designsSnapshot().map((saved) => saved.name)).toEqual(["mine"]);
    expect(designsSnapshot()[0]?.topology.nodes).toHaveLength(2);
  });

  it("refuses to save a design with no name rather than saving an unnamed one", () => {
    answers(200, []);
    library();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("status").textContent).toBe("Give it a name first.");
    expect(designsSnapshot()).toEqual([]);
  });

  it("lists what has already been saved and loads it back", () => {
    answers(200, []);
    saveDesign("earlier", SHORTENER.topology);
    const onLoad = library();
    fireEvent.click(screen.getByRole("button", { name: "earlier" }));
    const loaded = onLoad.mock.calls[0]?.[0] as { topology: { nodes: unknown[] } };
    expect(loaded.topology.nodes).toHaveLength(2);
  });

  it("deletes a saved design and stops listing it", () => {
    answers(200, []);
    saveDesign("earlier", SHORTENER.topology);
    library();
    fireEvent.click(screen.getByRole("button", { name: "Delete earlier" }));
    expect(screen.queryByRole("button", { name: /earlier/ })).toBeNull();
    expect(designsSnapshot()).toEqual([]);
  });
});
