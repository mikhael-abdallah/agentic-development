import { PLENTY_MS, type NumberField } from "@/lib/field";
import type { Workload } from "@/lib/topology";

/**
 * Where the spinners stop.
 *
 * Each bounds its own field and neither knows about the other. The engine
 * bounds the *product*: it refuses a request whose rate times duration comes to
 * more than two million arrivals, because a run it cannot interrupt is not
 * something an unauthenticated request gets to start. So these two maxima do
 * not compose — 20,000 rps for two minutes is 2.4 million arrivals, and comes
 * back as a 413 carrying a sentence that says so, which the panel shows.
 *
 * What they are chosen for is that either one alone, at the other's default,
 * stays inside that cap: 20,000 rps for the default minute is 1.2 million, and
 * two minutes at the default rate is thirty-six thousand.
 */
const LONGEST_RUN_MS = 120_000;
const FASTEST_RATE_RPS = 20_000;

export const WORKLOAD_FIELDS: NumberField<Workload>[] = [
  {
    label: "Arrival rate",
    hint: "Mean requests per second. Raise it until a component's utilization approaches 1 and watch p99 pull away from the mean.",
    unit: "rps",
    min: 1,
    max: FASTEST_RATE_RPS,
    step: 10,
    get: (workload) => workload.rateRps,
    set: (workload, value) => ({ ...workload, rateRps: value }),
  },
  {
    label: "Duration",
    hint: "How much simulated time to run for. Not wall clock: a busy hour costs the same seconds to simulate as a quiet one.",
    unit: "ms",
    min: PLENTY_MS / 10,
    max: LONGEST_RUN_MS,
    step: 1000,
    get: (workload) => workload.durationMs,
    set: (workload, value) => ({ ...workload, durationMs: value }),
  },
  {
    label: "Warmup",
    hint: "The share of the run to discard before measuring. A simulation starts with every queue empty, which no running system is — measuring from zero flatters the design in the direction nobody checks.",
    unit: "",
    min: 0,
    max: 0.9,
    step: 0.05,
    get: (workload) => workload.warmupFraction,
    set: (workload, value) => ({ ...workload, warmupFraction: value }),
  },
  {
    label: "Seed",
    // Two rewrites of this hint failed to make the seed make sense, which is
    // what "How much of that was luck" under the results is for: every run is
    // run at five consecutive seeds and the range is printed. This says what
    // the number is and points at the thing that shows it.
    hint: "Requests do not arrive on a metronome and no two take the same time to serve; the simulator draws both at random, and this picks which random numbers it draws. Same design, same load, same seed: exactly the same answer, every time. Every run also runs the four seeds after this one, and the range under the results is how much of the answer was luck.",
    unit: "",
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    step: 1,
    get: (workload) => workload.seed,
    set: (workload, value) => ({ ...workload, seed: value }),
  },
];
