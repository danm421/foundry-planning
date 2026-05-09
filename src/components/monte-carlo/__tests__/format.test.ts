import { describe, it, expect } from "vitest";
import {
  formatShortCurrency,
  formatCurrency,
  formatPercent,
  formatPercent2,
  formatInteger,
} from "../lib/format";

describe("formatShortCurrency", () => {
  it("formats millions with one decimal", () => {
    expect(formatShortCurrency(2_400_000)).toBe("$2.4M");
    expect(formatShortCurrency(3_000_000)).toBe("$3.0M");
    expect(formatShortCurrency(950_000_000)).toBe("$950.0M");
  });
  it("formats thousands with no decimal", () => {
    expect(formatShortCurrency(95_000)).toBe("$95K");
    expect(formatShortCurrency(800_000)).toBe("$800K");
  });
  it("formats under a thousand with no decimal", () => {
    expect(formatShortCurrency(500)).toBe("$500");
    expect(formatShortCurrency(0)).toBe("$0");
  });
  it("handles negatives with a leading minus", () => {
    expect(formatShortCurrency(-2_400_000)).toBe("−$2.4M");
    expect(formatShortCurrency(-95_000)).toBe("−$95K");
  });
});

describe("formatCurrency", () => {
  it("formats with full thousands separators and no cents", () => {
    expect(formatCurrency(2_400_000)).toBe("$2,400,000");
    expect(formatCurrency(95_000)).toBe("$95,000");
    expect(formatCurrency(500)).toBe("$500");
    expect(formatCurrency(0)).toBe("$0");
  });
  it("rounds fractional values", () => {
    expect(formatCurrency(1234.49)).toBe("$1,234");
    expect(formatCurrency(1234.5)).toBe("$1,235");
  });
  it("handles negatives with a leading minus", () => {
    expect(formatCurrency(-2_400_000)).toBe("−$2,400,000");
  });
});

describe("formatPercent2", () => {
  it("formats a 0–1 fraction with two decimal places", () => {
    expect(formatPercent2(0.0525)).toBe("5.25%");
    expect(formatPercent2(0.125)).toBe("12.50%");
    expect(formatPercent2(1)).toBe("100.00%");
    expect(formatPercent2(0)).toBe("0.00%");
    expect(formatPercent2(-0.0123)).toBe("-1.23%");
  });
});

describe("formatPercent", () => {
  it("formats a 0–1 fraction as an integer percent", () => {
    expect(formatPercent(0.88)).toBe("88%");
    expect(formatPercent(0.125)).toBe("13%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("formatInteger", () => {
  it("comma-groups thousands", () => {
    expect(formatInteger(1000)).toBe("1,000");
    expect(formatInteger(5000)).toBe("5,000");
    expect(formatInteger(999)).toBe("999");
  });
});
