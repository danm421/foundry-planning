import { describe, it, expect } from "vitest";
import { getDefaultLayout } from "../default-layout";

describe("getDefaultLayout", () => {
  it("returns the 11 canonical kinds in canonical order", () => {
    const layout = getDefaultLayout();
    expect(layout.version).toBe(3);
    expect(layout.items.map((i) => i.kind)).toEqual([
      "kpi-strip",
      "portfolio",
      "monte-carlo",
      "longevity",
      "lifetime-tax",
      "liquidity",
      "estate-impact",
      "estate-tax",
      "income-expense",
      "withdrawal-source",
      "year-by-year",
    ]);
  });

  it("defaults yearRange to null", () => {
    expect(getDefaultLayout().yearRange).toBeNull();
  });

  it("each item has all-fresh instanceIds (UUIDs)", () => {
    const layout = getDefaultLayout();
    const ids = layout.items.map((i) => i.instanceId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });

  it("returns a new array on each call (fresh instanceIds)", () => {
    const a = getDefaultLayout();
    const b = getDefaultLayout();
    expect(a.items[0].instanceId).not.toBe(b.items[0].instanceId);
  });
});
