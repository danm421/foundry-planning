import { describe, expect, it } from "vitest";
import { mergeAum } from "../kpis";

describe("mergeAum", () => {
  it("sums planning households from planning sums only", () => {
    expect(
      mergeAum(
        new Set(["h1"]),
        new Map([["h1", 500_000]]),
        new Map([["h1", 100]]), // stale CRM copy must NOT double-count
      ),
    ).toBe(500_000);
  });

  it("falls back to CRM sums for non-planning households", () => {
    expect(
      mergeAum(new Set(["h1"]), new Map([["h1", 500_000]]), new Map([["h2", 250_000]])),
    ).toBe(750_000);
  });

  it("planning household with zero accounts contributes 0, not its CRM balance", () => {
    expect(mergeAum(new Set(["h1"]), new Map(), new Map([["h1", 250_000]]))).toBe(0);
  });

  it("empty book totals 0", () => {
    expect(mergeAum(new Set(), new Map(), new Map())).toBe(0);
  });
});
