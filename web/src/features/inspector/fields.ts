import type {
  CacheParams,
  DatabaseParams,
  LoadBalancerParams,
  ServiceParams,
} from "@/lib/topology";

/**
 * One editable number on a component.
 *
 * A field carries a getter and a setter rather than the name of a parameter.
 * A name would have to be looked up on the parameter object at runtime, which
 * is both a field that can name something that does not exist and an object
 * indexed by a string — and the compiler cannot check either. This way a field
 * that does not belong to its parameter type will not compile.
 *
 * `min` and `max` restate the engine's own bounds. They are here so a slider
 * cannot be dragged to a number the simulation would refuse; they are not the
 * enforcement, which stays in Go where every caller meets it.
 */
export interface NumberField<P> {
  label: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  get: (params: P) => number;
  set: (params: P, value: number) => P;
}

/**
 * The smallest value the engine accepts for a duration it samples from.
 *
 * Service, read and write times are drawn from an exponential distribution
 * whose rate is 1/mean, so the engine refuses a mean of zero outright. A
 * spinner has to stop somewhere above it, and a tenth of a millisecond is
 * already faster than anything being modelled here.
 */
const SMALLEST_MEAN_MS = 0.1;

/** A ceiling for the spinners. Not the engine's limit — the engine's limit is
 *  the point where a duration stops fitting in a clock, which is nowhere near
 *  a number anyone would type on purpose. */
const PLENTY_MS = 10_000;

export const LOAD_BALANCER_FIELDS: NumberField<LoadBalancerParams>[] = [
  {
    label: "Overhead",
    hint: "What the balancer itself adds to every request. Zero is a fair answer.",
    unit: "ms",
    min: 0,
    max: PLENTY_MS,
    step: 0.1,
    get: (params) => params.overheadMs,
    set: (params, value) => ({ ...params, overheadMs: value }),
  },
];

export const SERVICE_FIELDS: NumberField<ServiceParams>[] = [
  {
    label: "Instances",
    hint: "How many requests the pool can serve at once.",
    unit: "",
    min: 1,
    max: 1000,
    step: 1,
    get: (params) => params.instances,
    set: (params, value) => ({ ...params, instances: value }),
  },
  {
    label: "Service time",
    hint: "Average time one instance spends on a request.",
    unit: "ms",
    min: SMALLEST_MEAN_MS,
    max: PLENTY_MS,
    step: 0.5,
    get: (params) => params.meanServiceMs,
    set: (params, value) => ({ ...params, meanServiceMs: value }),
  },
  {
    label: "Queue capacity",
    hint: "How many may wait for a free instance. Zero means no limit — the difference between a slow design and a lossy one.",
    unit: "",
    min: 0,
    max: 100_000,
    step: 10,
    get: (params) => params.queueCapacity,
    set: (params, value) => ({ ...params, queueCapacity: value }),
  },
];

export const CACHE_FIELDS: NumberField<CacheParams>[] = [
  {
    label: "Hit ratio",
    hint: "The share of reads answered without going downstream. The one number that decides how much load a cache actually removes.",
    unit: "",
    min: 0,
    max: 1,
    step: 0.01,
    get: (params) => params.hitRatio,
    set: (params, value) => ({ ...params, hitRatio: value }),
  },
  {
    label: "Hit latency",
    hint: "What a hit costs. A miss costs this plus whatever is downstream.",
    unit: "ms",
    min: 0,
    max: PLENTY_MS,
    step: 0.1,
    get: (params) => params.hitLatencyMs,
    set: (params, value) => ({ ...params, hitLatencyMs: value }),
  },
];

export const DATABASE_FIELDS: NumberField<DatabaseParams>[] = [
  {
    label: "Replicas",
    hint: "Servers that take reads alongside the primary. Zero means the primary serves everything.",
    unit: "",
    min: 0,
    max: 100,
    step: 1,
    get: (params) => params.replicas,
    set: (params, value) => ({ ...params, replicas: value }),
  },
  {
    label: "Read time",
    hint: "Average time a read takes.",
    unit: "ms",
    min: SMALLEST_MEAN_MS,
    max: PLENTY_MS,
    step: 0.5,
    get: (params) => params.meanReadMs,
    set: (params, value) => ({ ...params, meanReadMs: value }),
  },
  {
    label: "Write time",
    hint: "Average time a write takes. Separate from a read because it usually is: a write that fsyncs and replicates is not a read off a warm page.",
    unit: "ms",
    min: SMALLEST_MEAN_MS,
    max: PLENTY_MS,
    step: 0.5,
    get: (params) => params.meanWriteMs,
    set: (params, value) => ({ ...params, meanWriteMs: value }),
  },
  {
    label: "Pool size",
    hint: "Concurrent requests one server will handle. The cap that turns a fast database into a queue.",
    unit: "",
    min: 1,
    max: 10_000,
    step: 1,
    get: (params) => params.poolSize,
    set: (params, value) => ({ ...params, poolSize: value }),
  },
];
