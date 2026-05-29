import { describe, it, expect } from "vitest";
import { LIQUID_CATEGORIES, isLiquid } from "../liquid-filter";

describe("isLiquid", () => {
  it("returns true for liquid categories", () => {
    expect(isLiquid("taxable")).toBe(true);
    expect(isLiquid("cash")).toBe(true);
    expect(isLiquid("retirement")).toBe(true);
  });

  it("returns false for illiquid categories", () => {
    expect(isLiquid("real_estate")).toBe(false);
    expect(isLiquid("business")).toBe(false);
    expect(isLiquid("life_insurance")).toBe(false);
    expect(isLiquid("notes_receivable")).toBe(false);
  });

  it("LIQUID_CATEGORIES contains exactly the three liquid categories", () => {
    expect([...LIQUID_CATEGORIES].sort()).toEqual(["cash", "retirement", "taxable"]);
  });
});
