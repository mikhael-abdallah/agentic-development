import type { Scenario, Topology, Workload } from "@/lib/topology";

/**
 * Where the engine is.
 *
 * Empty by default, which means "the origin this page came from". That is the
 * shape the container has — one Go binary serving both the exported page and
 * the JSON routes — so the default is the deployment, not a guess. The
 * override exists for running `next dev` against `engined` on another port.
 */
const ENGINE = process.env.NEXT_PUBLIC_ENGINE_URL ?? "";

interface Latency {
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

interface NodeStats {
  served: number;
  dropped: number;
  utilization: number;
}

/**
 * A finished simulation.
 *
 * `nodes` is a Map rather than the object the wire carries, because the keys
 * are component ids the user chose and an object indexed by user input is the
 * shape prototype pollution takes. Converting once, here, keeps every reader
 * downstream from having to think about it.
 */
export interface SimulationResult {
  arrived: number;
  completed: number;
  dropped: number;
  throughputRps: number;
  latency: Latency;
  nodes: Map<string, NodeStats>;
  /** The busiest component. Empty when nothing in the design has a capacity —
   *  a chain of caches has no queue to form anywhere. */
  bottleneck: string;
}

interface SimulationBody {
  arrived: number;
  completed: number;
  dropped: number;
  throughputRps: number;
  latency: Latency;
  nodes: Record<string, NodeStats>;
  bottleneck?: string;
}

/**
 * Asks the engine, and turns a refusal into something worth reading.
 *
 * The engine answers every failure with `{"error": "..."}` and a status, and
 * the prose in it is the useful part: "component cannot be reached from the
 * client" is a sentence someone can act on, where "400" is not. Losing it and
 * showing the status instead is how a well-designed API becomes a blank stare.
 */
async function ask(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${ENGINE}${path}`, init);
  } catch {
    // A network error, a refused connection, or the engine not running at all.
    // The browser deliberately says no more than that.
    throw new Error("the engine could not be reached");
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`the engine answered ${String(response.status)} with something that is not JSON`);
  }
  if (!response.ok) {
    const reason = (body as { error?: string }).error;
    throw new Error(reason ?? `the engine answered ${String(response.status)}`);
  }
  return body;
}

function resultOf(body: SimulationBody): SimulationResult {
  return {
    arrived: body.arrived,
    completed: body.completed,
    dropped: body.dropped,
    throughputRps: body.throughputRps,
    latency: body.latency,
    nodes: new Map(Object.entries(body.nodes)),
    bottleneck: body.bottleneck ?? "",
  };
}

export async function simulate(
  topology: Topology,
  workload: Workload,
  signal?: AbortSignal,
): Promise<SimulationResult> {
  const body = await ask("/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topology, workload }),
    signal,
  });
  return resultOf(body as SimulationBody);
}

/**
 * The designs the engine ships with.
 *
 * They come from the engine rather than from a copy in this bundle, because a
 * preset is only useful if it is the one the simulator will actually run — and
 * the engine refuses to start at all if any of them stopped validating. A copy
 * here would be a second answer to what the shortener is.
 */
export async function scenarios(signal?: AbortSignal): Promise<Scenario[]> {
  return (await ask("/scenarios", { signal })) as Scenario[];
}
