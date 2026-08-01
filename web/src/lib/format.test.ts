import { describe, expect, it } from "vitest";

import { formatLatency, formatRate, formatShare } from "./format";

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

describe("formatShare", () => {
  it("writes an ordinary share without decimals it does not need", () => {
    expect(formatShare(0.95)).toBe("95");
    expect(formatShare(0.05)).toBe("5");
    expect(formatShare(1)).toBe("100");
  });

  it("keeps a decimal that is there", () => {
    expect(formatShare(0.335)).toBe("33.5");
    expect(formatShare(1.002)).toBe("100.2");
  });

  // The reason this is not toFixed(1). Three rows of 33.3333333% come to a
  // total the engine refuses and every short format rounds to a hundred, so the
  // refusal would read "the shares come to 100%, adjust them until they come to
  // 100%" — a message naming the number it is asking for.
  it("never shows a hundred for a total that is not one", () => {
    for (const total of [1.0000002, 0.9999998, 3 * 0.3333333, 1 + 1e-7]) {
      expect(Math.abs(total - 1)).toBeGreaterThan(1e-9);
      expect(formatShare(total)).not.toBe("100");
    }
  });

  it("does show a hundred when the total is one", () => {
    expect(formatShare(0.95 + 0.05)).toBe("100");
    expect(formatShare(0.7 + 0.2 + 0.1)).toBe("100");
  });

  it("refuses a share that is not a number", () => {
    expect(() => formatShare(Number.NaN)).toThrow(RangeError);
  });
});
