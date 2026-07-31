import { afterEach, describe, expect, it, vi } from "vitest";

import { simulate } from "@/features/simulation/client";
import { emptyDesign } from "@/lib/design";
import { defaultWorkload } from "@/lib/topology";

const BODY = {
  arrived: 100,
  completed: 98,
  dropped: 2,
  throughputRps: 19.6,
  latency: { meanMs: 5, p50Ms: 4, p95Ms: 12, p99Ms: 20, maxMs: 44 },
  nodes: { api: { served: 98, dropped: 2, utilization: 0.6 } },
  bottleneck: "api",
};

function answers(status: number, body: unknown, text?: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(text ?? JSON.stringify(body)),
      }),
    ),
  );
}

function run() {
  return simulate(emptyDesign().topology, defaultWorkload());
}

/** The JSON body of the request that was sent, as a string. */
function sentBody(): string {
  const body = vi.mocked(fetch).mock.calls[0]?.[1]?.body;
  return typeof body === "string" ? body : "";
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("simulate", () => {
  it("posts the design and the load together", async () => {
    answers(200, BODY);
    await run();
    const fetched = vi.mocked(fetch).mock.calls[0];
    expect(fetched?.[0]).toBe("/simulate");
    expect(fetched?.[1]?.method).toBe("POST");
    const sent = JSON.parse(sentBody()) as Record<string, unknown>;
    expect(Object.keys(sent).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "topology",
      "workload",
    ]);
  });

  it("returns the numbers the engine reported", async () => {
    answers(200, BODY);
    const result = await run();
    expect(result.completed).toBe(98);
    expect(result.latency.p99Ms).toBe(20);
    expect(result.bottleneck).toBe("api");
  });

  // Node ids are whatever the user called their components, and an object
  // indexed by user input is the shape prototype pollution takes. Converting
  // once here keeps every reader downstream from having to think about it.
  it("hands back component statistics as a map", async () => {
    answers(200, BODY);
    const result = await run();
    expect(result.nodes.get("api")?.utilization).toBeCloseTo(0.6);
  });

  // A design with nothing that can queue has no bottleneck, and the engine
  // omits the field rather than inventing one.
  it("reads a missing bottleneck as no bottleneck", async () => {
    answers(200, { ...BODY, bottleneck: undefined });
    expect((await run()).bottleneck).toBe("");
  });

  // The engine's prose is the useful part of a refusal: "component cannot be
  // reached from the client" is a sentence someone can act on, where "400" is
  // not. Losing it is how a well-designed API becomes a blank stare.
  it("reports the reason the engine gave, not the status code", async () => {
    answers(400, { error: "component cannot be reached from the client" });
    await expect(run()).rejects.toThrow("component cannot be reached from the client");
  });

  it("falls back to the status when the refusal carried no reason", async () => {
    answers(500, {});
    await expect(run()).rejects.toThrow("500");
  });

  // A proxy, a captive portal or the wrong port answers with HTML. Parsing
  // that as a result would put NaN through the whole panel.
  it("says so when the answer is not JSON at all", async () => {
    answers(502, undefined, "<html>Bad Gateway</html>");
    await expect(run()).rejects.toThrow(/not JSON/);
  });

  // The browser deliberately says no more than "it failed", so this is the one
  // message that has to be written rather than passed through.
  it("says the engine could not be reached when the request never lands", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("connection refused"))));
    await expect(run()).rejects.toThrow("the engine could not be reached");
  });
});
