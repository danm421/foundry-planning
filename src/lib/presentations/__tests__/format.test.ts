import { describe, it, expect } from "vitest";
import { compactCurrency, jointAge, dateLong, exactCurrency } from "../format";

describe("compactCurrency", () => {
  it("formats values >= $1M with M suffix", () => {
    expect(compactCurrency(1_000_000)).toBe("$1.0M");
    expect(compactCurrency(1_245_000)).toBe("$1.2M");
    expect(compactCurrency(17_316_139)).toBe("$17.3M");
  });

  it("formats values in [$1k, $1M) with k suffix", () => {
    expect(compactCurrency(1_000)).toBe("$1.0k");
    expect(compactCurrency(214_736)).toBe("$215k");
    expect(compactCurrency(999_500)).toBe("$1.0M");
  });

  it("formats values < $1k with full digits", () => {
    expect(compactCurrency(842)).toBe("$842");
    expect(compactCurrency(0)).toBe("$0");
    expect(compactCurrency(50)).toBe("$50");
  });

  it("formats negatives in parens", () => {
    expect(compactCurrency(-45_000)).toBe("($45k)");
    expect(compactCurrency(-1_500_000)).toBe("($1.5M)");
    expect(compactCurrency(-100)).toBe("($100)");
  });

  it("treats NaN and non-finite as $0", () => {
    expect(compactCurrency(NaN)).toBe("$0");
    expect(compactCurrency(Infinity)).toBe("$0");
    expect(compactCurrency(-Infinity)).toBe("$0");
  });
});

describe("jointAge", () => {
  it("formats a couple as client/spouse", () => {
    expect(jointAge(65, 61)).toBe("65/61");
  });

  it("formats a solo client as a bare number", () => {
    expect(jointAge(73, null)).toBe("73");
  });

  it("renders a dash for the deceased side", () => {
    expect(jointAge(null, 61)).toBe("—/61");
    expect(jointAge(65, null)).toBe("65");
  });

  it("handles both null", () => {
    expect(jointAge(null, null)).toBe("—");
  });
});

describe("dateLong", () => {
  it("formats a date as 'Month D, YYYY'", () => {
    expect(dateLong(new Date(2026, 4, 27))).toBe("May 27, 2026");
    expect(dateLong(new Date(2026, 0, 1))).toBe("January 1, 2026");
  });
});

describe("exactCurrency", () => {
  it("formats whole-dollar amounts with separators", () => {
    expect(exactCurrency(120000)).toBe("$120,000");
    expect(exactCurrency(32400)).toBe("$32,400");
    expect(exactCurrency(0)).toBe("$0");
  });
});
