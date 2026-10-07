import { describe, it, expect } from "vitest";
import { resolveExpenseFromRaw } from "@/lib/projection/resolve-entity";

const ctx = { resolvedInflationRate: 0.03 } as Parameters<typeof resolveExpenseFromRaw>[1];
const raw = {
  id: "e1",
  type: "living",
  name: "Current Living Expenses",
  annualAmount: "50400",
  startYear: 2026,
  endYear: 2040,
  growthSource: "inflation",
  growthRate: "0.03",
};
const items = [{ id: "i1", name: "Housing", amount: 3200, frequency: "monthly" as const }];

describe("resolveExpenseFromRaw — livingItems", () => {
  it("carries the list through to the engine expense", () => {
    expect(resolveExpenseFromRaw({ ...raw, livingItems: items }, ctx).livingItems).toEqual(items);
  });
  it("turns a null or absent column into null", () => {
    expect(resolveExpenseFromRaw({ ...raw, livingItems: null }, ctx).livingItems).toBeNull();
    expect(resolveExpenseFromRaw(raw, ctx).livingItems).toBeNull();
  });
});
