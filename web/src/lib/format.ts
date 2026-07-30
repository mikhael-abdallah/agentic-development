/** Human-readable throughput, e.g. 5000 -> "5.0k req/s". */
export function formatRate(reqPerSec: number): string {
  if (!Number.isFinite(reqPerSec) || reqPerSec < 0) {
    throw new RangeError(`rate must be a non-negative finite number, got ${String(reqPerSec)}`);
  }
  if (reqPerSec >= 1_000_000) {
    return `${(reqPerSec / 1_000_000).toFixed(1)}M req/s`;
  }
  if (reqPerSec >= 1_000) {
    return `${(reqPerSec / 1_000).toFixed(1)}k req/s`;
  }
  return `${reqPerSec.toFixed(0)} req/s`;
}

/** Human-readable latency, e.g. 120 -> "120 ms", 2500 -> "2.50 s". */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`latency must be a non-negative finite number, got ${String(ms)}`);
  }
  if (ms >= 1_000) {
    return `${(ms / 1_000).toFixed(2)} s`;
  }
  if (ms >= 1) {
    return `${ms.toFixed(0)} ms`;
  }
  return `${(ms * 1_000).toFixed(0)} µs`;
}
