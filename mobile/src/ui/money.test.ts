import { describe, it, expect } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("rounds to whole dollars by default", () => {
    expect(formatMoney(12345.67)).toBe("$12,346");
  });
  it("shows cents when asked", () => {
    expect(formatMoney(12345.67, { cents: true })).toBe("$12,345.67");
  });
  it("handles negatives", () => {
    expect(formatMoney(-500)).toBe("-$500");
  });
  it("handles zero", () => {
    expect(formatMoney(0)).toBe("$0");
  });
});
