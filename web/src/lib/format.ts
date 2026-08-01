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

/**
 * A share of traffic as a percentage, at a precision worth reading.
 *
 * One decimal covers anything the spinner produces. The shares are free text
 * though, so someone can type 33.3333333 into three rows and reach a total the
 * engine refuses and every short format rounds to a hundred — which would print
 * "the shares come to 100%, adjust them until they come to 100%", a refusal
 * naming the number it is asking for.
 *
 * So the precision grows until the figure can be told apart from a hundred, and
 * stops where the engine stops caring: it accepts a total within 1e-9 of one,
 * which is 1e-7 of a percent, so seven decimals can always show a discrepancy
 * that matters and never invents one that does not.
 */
export function formatShare(share: number): string {
  if (!Number.isFinite(share)) {
    throw new RangeError(`share must be a finite number, got ${String(share)}`);
  }
  const percent = share * 100;
  for (const places of [1, 3, 7]) {
    const rounded = Number(percent.toFixed(places));
    if (rounded !== 100 || percent === 100) {
      // Back through Number, which drops the zeroes the fixed form padded on:
      // 95.0 is written 95, and 100.2000000 is written 100.2.
      return String(rounded);
    }
  }
  return String(Number(percent.toFixed(7)));
}
