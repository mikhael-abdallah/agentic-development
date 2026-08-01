import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import Home from "./page";

/**
 * Load the design surface before any test waits for it.
 *
 * The page fetches it on demand, so whichever test needs it first pays for the
 * module being transformed and imported — the canvas and the whole of
 * `@xyflow/react`. On a cold CI runner that took longer than a default
 * `waitFor` allows, and the failure it produced said "expected null not to be
 * null", which reads as a broken page rather than as a slow import. Warming the
 * registry once puts that cost where it belongs.
 */
beforeAll(async () => {
  await import("@/features/canvas/Surface");
});

/** The canvas alone. Every kind names itself twice on this page — once in the
 *  palette and once on whatever was added — so a query that does not say which
 *  one it means finds both. */
function canvasOf(container: HTMLElement): HTMLElement {
  const canvas = container.querySelector<HTMLElement>(".canvas");
  if (canvas === null) {
    throw new Error("the page rendered without a canvas");
  }
  return canvas;
}

/** The page with its design surface actually on screen. The surface is fetched
 *  on demand — see DesignCanvas — so everything about what is drawn on it has
 *  to wait for it to arrive, and a test that did not wait would be asserting
 *  against the placeholder. */
async function pageWithCanvas(): Promise<HTMLElement> {
  const { container } = render(<Home />);
  // Generous, because what is being waited on is a module arriving, not an
  // animation: a slow machine should make this test slow, never flaky.
  await waitFor(
    () => {
      expect(container.querySelector(".react-flow__node")).not.toBeNull();
    },
    { timeout: 15_000 },
  );
  return container;
}

describe("Home", () => {
  it("renders the simulator heading", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1, name: "System Design Simulator" }),
    ).toBeDefined();
  });

  // What is deliberately not asserted here: that the canvas is absent on the
  // first frame. It is — the surface is fetched on demand — but only until
  // something has loaded the module, and this suite shuffles its tests, so any
  // assertion about the placeholder passes or fails depending on which test ran
  // first. The property that actually matters, that the surface stays out of
  // the first load, is held by the bundle budget: it is 190 kB with the split
  // and 244 kB without, against a gate of 244 kB.
  it("opens on a design with the one client every design needs", async () => {
    const container = await pageWithCanvas();
    expect(within(canvasOf(container)).getByText("Client")).toBeDefined();
  });

  // The page is the only thing that holds both the palette and the canvas, so
  // it is the only place the two can be shown to be wired together.
  it("puts a component on the canvas when the palette is used", async () => {
    const container = await pageWithCanvas();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Service/ }));
    await waitFor(
      () => {
        expect(container.querySelectorAll(".react-flow__node")).toHaveLength(2);
      },
      { timeout: 15_000 },
    );
    expect(within(canvasOf(container)).getByText("Service")).toBeDefined();
  });

  // What the settings are for: the component that was clicked, named in the
  // dialog, rather than a panel down the side that could be about anything.
  it("brings up the settings of a component that is clicked", async () => {
    const container = await pageWithCanvas();
    expect(container.querySelector("dialog")?.open).toBe(false);
    fireEvent.click(container.querySelectorAll(".react-flow__node")[0] ?? container);
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(screen.getByRole("heading", { name: "Client" })).toBeDefined();
  });

  // A new component arrives with ordinary settings already on it. The dialog
  // opens so they can be changed, not so they have to be: closing it without
  // touching anything leaves a component that runs.
  it("brings up the settings of a component as it is created, already filled in", async () => {
    const container = await pageWithCanvas();
    fireEvent.click(screen.getByRole("button", { name: /Service/ }));
    await waitFor(() => {
      expect(container.querySelector("dialog")?.open).toBe(true);
    });
    expect(screen.getByLabelText("Instances")).toHaveProperty("value", "1");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(container.querySelector("dialog")?.open).toBe(false);
  });

  // The library and the run settings are siblings, and the load is the one
  // thing they both speak about. Loading a preset has to reach the panel, or
  // the preset states the traffic it was written for and the run measures
  // something else — which is what happened while the workload was held inside
  // the panel and the library could not see it.
  it("takes the load a preset was written for through to the run settings", async () => {
    const preset = {
      id: "url-shortener",
      title: "URL shortener",
      description: "Two operations share one path.",
      goal: "Raise the rate.",
      topology: {
        nodes: [
          { id: "client", kind: "client" },
          { id: "api", kind: "service", service: { instances: 1, meanServiceMs: 8, queueCapacity: 500 } },
        ],
        edges: [{ from: "client", to: "api" }],
      },
      workload: {
        rateRps: 300,
        operations: [
          { name: "resolve", kind: "read", share: 0.95 },
          { name: "shorten", kind: "write", share: 0.05 },
        ],
        durationMs: 60_000,
        seed: 1,
        warmupFraction: 0.2,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify([preset])),
        }),
      ),
    );
    render(<Home />);
    await waitFor(() => {
      expect(screen.getByText("URL shortener")).toBeDefined();
    });
    // The default load offers `read` and `write`, so finding the preset's own
    // names is the whole assertion — and their absence beforehand is what says
    // the fixture is not simply agreeing with the default.
    expect(screen.queryByDisplayValue("resolve")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /URL shortener/ }));
    expect(screen.getByDisplayValue("resolve")).toBeDefined();
    expect(screen.getByDisplayValue("shorten")).toBeDefined();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
