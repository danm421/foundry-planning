import { describe, it, expect } from "vitest";
import { resolveExpenseFromRaw } from "@/lib/projection/resolve-entity";

const ctx = { resolvedInflationRate: 0.03 } as Parameters<typeof resolveExpenseFromRaw>[1];

const raw = {
  id: "e1",
  type: "living",
  name: "Current Living Expenses",
  annualAmount: "0",
  startYear: 2026,
  endYear: 2040,
  growthSource: "inflation",
  growthRate: "0.03",
};

describe("resolveExpenseFromRaw — absorbsRemainingCashFlow", () => {
  it("carries a true flag through to the engine expense", () => {
    const e = resolveExpenseFromRaw({ ...raw, absorbsRemainingCashFlow: true }, ctx);
    expect(e.absorbsRemainingCashFlow).toBe(true);
  });

  it("defaults a null column to false rather than undefined", () => {
    const e = resolveExpenseFromRaw({ ...raw, absorbsRemainingCashFlow: null }, ctx);
    expect(e.absorbsRemainingCashFlow).toBe(false);
  });

  it("defaults an absent column to false", () => {
    const e = resolveExpenseFromRaw(raw, ctx);
    expect(e.absorbsRemainingCashFlow).toBe(false);
  });
});
