import { describe, it, expect } from "vitest";
import { fmtUsd, fmtPct } from "../format";

describe("fmtUsd", () => {
  it("formats positive amounts with commas", () => {
    expect(fmtUsd(124624)).toBe("$124,624");
  });
  it("formats negatives as -$6,141 (sign before the dollar)", () => {
    expect(fmtUsd(-6141)).toBe("-$6,141");
  });
  it("rounds to whole dollars", () => {
    expect(fmtUsd(1234.6)).toBe("$1,235");
  });
  it("treats values that round to zero as unsigned $0", () => {
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(-0.4)).toBe("$0");
  });
});

describe("fmtPct", () => {
  it("renders one decimal place from a fraction", () => {
    expect(fmtPct(0.477)).toBe("47.7%");
  });
  it("keeps the sign for negative fractions", () => {
    expect(fmtPct(-0.052)).toBe("-5.2%");
  });
});
