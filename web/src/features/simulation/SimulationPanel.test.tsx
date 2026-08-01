import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SimulationPanel } from "@/features/simulation/SimulationPanel";
import { WORKLOAD_FIELDS } from "@/features/simulation/fields";
import { addNode, connect, emptyDesign } from "@/lib/design";
import { defaultWorkload } from "@/lib/topology";

const BODY = {
  arrived: 1000,
  completed: 1000,
  dropped: 0,
  throughputRps: 200,
  latency: { meanMs: 5, p50Ms: 4, p95Ms: 12, p99Ms: 20, maxMs: 44 },
  nodes: {
    api: { served: 1000, dropped: 0, utilization: 0.6 },
    db: { served: 300, dropped: 0, utilization: 0.2 },
  },
  bottleneck: "api",
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

/** client -> service. The smallest design that can actually be run: a client
 *  wired to nothing has nowhere to send its requests, and the panel now says so
 *  and turns the button off rather than letting it be pressed. */
function runnable() {
  const design = addNode(emptyDesign(), "service", { x: 0, y: 0 });
  return connect(design, "client", "service").topology;
}

function panel() {
  return render(<SimulationPanel topology={runnable()} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SimulationPanel", () => {
  it("offers every part of the load the engine reads", () => {
    panel();
    // The numeric fields, and a share for each operation. The workload is no
    // longer all rows of numbers: what the traffic asks for is a list, and its
    // shares are the rest of the spinners on screen.
    const operations = defaultWorkload().operations.length;
    expect(operations).toBeGreaterThan(0);
    expect(screen.getAllByRole("spinbutton")).toHaveLength(WORKLOAD_FIELDS.length + operations);
  });

  it("shows nothing until a run has happened", () => {
    panel();
    expect(screen.queryByText("Throughput")).toBeNull();
  });

  it("reports what the run said", async () => {
    answers(200, BODY);
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Run simulation/ }));
    await waitFor(() => {
      expect(screen.getByText("200 req/s")).toBeDefined();
    });
    expect(screen.getByText("20 ms")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
    expect(screen.getByText("60%")).toBeDefined();
  });

  it("sends the load as it was edited, not as it started", async () => {
    answers(200, BODY);
    panel();
    fireEvent.change(screen.getByLabelText(/Arrival rate/), { target: { value: "750" } });
    fireEvent.click(screen.getByRole("button", { name: /Run simulation/ }));
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
    const body = vi.mocked(fetch).mock.calls[0]?.[1]?.body;
    const sent = JSON.parse(typeof body === "string" ? body : "") as {
      workload: { rateRps: number };
    };
    expect(sent.workload.rateRps).toBe(750);
  });

  // Every refusal the engine sends is a statement about the design or the
  // load, and its prose is the useful part. Swallowing it for "something went
  // wrong" would replace a message that already said what with one that does
  // not.
  it("shows the engine's own words when it refuses", async () => {
    answers(400, { error: "requests would flow in a circle" });
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Run simulation/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("requests would flow in a circle");
    });
    expect(screen.queryByText("Throughput")).toBeNull();
  });

  it("re-enables the button after a failure, so a fixed design can be run", async () => {
    answers(400, { error: "no" });
    panel();
    const button = screen.getByRole("button", { name: /Run simulation/ });
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("no");
    });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("names the busiest component rather than leaving it to be spotted", async () => {
    answers(200, BODY);
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Run simulation/ }));
    await waitFor(() => {
      expect(screen.getByText(/api is the busiest thing here/)).toBeDefined();
    });
  });

  // A design with nothing that can queue has no bottleneck. Saying so beats
  // showing an empty name and letting it read as a rendering bug.
  it("says why there is no bottleneck when the engine names none", async () => {
    answers(200, { ...BODY, bottleneck: "" });
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Run simulation/ }));
    await waitFor(() => {
      expect(screen.getByText(/Nothing in this design has a capacity/)).toBeDefined();
    });
  });

  it("calls out dropped requests rather than letting them read as a zero", async () => {
    answers(200, { ...BODY, dropped: 42 });
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Run simulation/ }));
    await waitFor(() => {
      expect(screen.getByText("42").getAttribute("data-bad")).toBe("true");
    });
  });
});

// The panel above this one edits one component. These numbers are the traffic
// offered to the whole design, and the two draw identical rows.
describe("SimulationPanel saying what it applies to", () => {
  it("says these settings are the whole design's, not a component's", () => {
    panel();
    expect(screen.getByText("Whole design")).toBeDefined();
    expect(screen.getByRole("region", { name: "Run settings" })).toBeDefined();
  });

  // Someone who has not met a seed cannot act on "the same seed gives the same
  // result": it explains the property and not the thing.
  it("explains what a seed is, not only what it does", () => {
    panel();
    const hint = screen.getByLabelText(/Seed/).getAttribute("aria-describedby");
    const text = hint === null ? "" : (document.getElementById(hint)?.textContent ?? "");
    expect(text).toMatch(/at random/);
    expect(text).toMatch(/luck/);
  });

  // The other half of making the client deletable: a design that cannot be run
  // says which, next to a button that cannot be pressed. A disabled control
  // that gives no reason is indistinguishable from a broken one.
  it("refuses to run a design with no client, and says so", () => {
    render(<SimulationPanel topology={{ nodes: [], edges: [] }} />);
    expect(screen.getByRole("button", { name: /Run simulation/ })).toHaveProperty("disabled", true);
    expect(screen.getByText(/This design has no client/)).toBeDefined();
  });

  it("runs once the design has one", () => {
    render(<SimulationPanel topology={runnable()} />);
    expect(screen.getByRole("button", { name: /Run simulation/ })).toHaveProperty("disabled", false);
  });
});
