import { describe, expect, it } from "vitest";

import { formatLatency, formatRate } from "./format";

describe("formatRate", () => {
  it("formats sub-thousand rates without a suffix", () => {
    expect(formatRate(0)).toBe("0 req/s");
    expect(formatRate(950)).toBe("950 req/s");
  });

  it("formats thousands with the k suffix", () => {
    expect(formatRate(1_000)).toBe("1.0k req/s");
    expect(formatRate(5_000)).toBe("5.0k req/s");
    expect(formatRate(999_499)).toBe("999.5k req/s");
  });

  it("formats millions with the M suffix", () => {
    expect(formatRate(1_000_000)).toBe("1.0M req/s");
    expect(formatRate(2_500_000)).toBe("2.5M req/s");
  });

  it("rejects negative and non-finite input", () => {
    expect(() => formatRate(-1)).toThrow(RangeError);
    expect(() => formatRate(Number.NaN)).toThrow(RangeError);
    expect(() => formatRate(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("formatLatency", () => {
  it("formats sub-millisecond values in microseconds", () => {
    expect(formatLatency(0.25)).toBe("250 µs");
    expect(formatLatency(0)).toBe("0 µs");
  });

  it("formats milliseconds", () => {
    expect(formatLatency(1)).toBe("1 ms");
    expect(formatLatency(120)).toBe("120 ms");
    expect(formatLatency(999)).toBe("999 ms");
  });

  it("formats seconds above one thousand milliseconds", () => {
    expect(formatLatency(1_000)).toBe("1.00 s");
    expect(formatLatency(2_500)).toBe("2.50 s");
  });

  it("rejects negative and non-finite input", () => {
    expect(() => formatLatency(-0.1)).toThrow(RangeError);
    expect(() => formatLatency(Number.NaN)).toThrow(RangeError);
    expect(() => formatLatency(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
