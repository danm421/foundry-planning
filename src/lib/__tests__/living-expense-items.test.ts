import { describe, it, expect } from "vitest";
import type { LivingExpenseItem } from "@/engine/types";
import {
  goalPrefillFromItem,
  hasLivingItems,
  isTotalOverridden,
  itemAnnualAmount,
  livingItemsAnnualTotal,
  livingItemsPatch,
  withLivingItemsTotal,
} from "../living-expense-items";

const item = (over: Partial<LivingExpenseItem> = {}): LivingExpenseItem => ({
  id: "i1",
  name: "Housing",
  amount: 3200,
  frequency: "monthly",
  ...over,
});
const TRAVEL = item({ id: "i2", name: "Travel", amount: 12000, frequency: "annual" });

describe("itemAnnualAmount", () => {
  it("counts a monthly item twelve times", () => {
    expect(itemAnnualAmount(item())).toBe(38400);
  });
  it("takes an annual item as-is", () => {
    expect(itemAnnualAmount(TRAVEL)).toBe(12000);
  });
  it("rounds to the cent", () => {
    expect(itemAnnualAmount(item({ amount: 33.333 }))).toBe(400);
  });
});

describe("livingItemsAnnualTotal", () => {
  it("sums monthly and annual items as yearly amounts", () => {
    expect(livingItemsAnnualTotal([item(), TRAVEL])).toBe(50400);
  });
  it("is 0 for an empty list", () => {
    expect(livingItemsAnnualTotal([])).toBe(0);
  });
  it("does not carry float drift into the total", () => {
    const tenDimes = Array.from({ length: 10 }, (_, i) =>
      item({ id: `d${i}`, amount: 0.1, frequency: "annual" }),
    );
    expect(livingItemsAnnualTotal(tenDimes)).toBe(1);
  });
});

describe("hasLivingItems", () => {
  it("is false for null, undefined and an empty list", () => {
    expect(hasLivingItems(null)).toBe(false);
    expect(hasLivingItems(undefined)).toBe(false);
    expect(hasLivingItems([])).toBe(false);
  });
  it("is true for a non-empty list", () => {
    expect(hasLivingItems([item()])).toBe(true);
  });
});

describe("isTotalOverridden", () => {
  it("is false when the row has no items", () => {
    expect(isTotalOverridden(90000, null)).toBe(false);
    expect(isTotalOverridden(90000, [])).toBe(false);
  });
  it("is false when the stored total matches, including a decimal string", () => {
    expect(isTotalOverridden("50400.00", [item(), TRAVEL])).toBe(false);
  });
  it("is false within half a cent", () => {
    expect(isTotalOverridden(50400.004, [item(), TRAVEL])).toBe(false);
  });
  it("is true when another screen set a different total", () => {
    expect(isTotalOverridden(90000, [item(), TRAVEL])).toBe(true);
  });
});

describe("livingItemsPatch", () => {
  it("sends the list and its total together", () => {
    expect(livingItemsPatch([item(), TRAVEL])).toEqual({
      livingItems: [item(), TRAVEL],
      annualAmount: "50400",
    });
  });
  it("un-itemizes the row at $0 when the last item goes", () => {
    expect(livingItemsPatch([])).toEqual({ livingItems: null, annualAmount: "0" });
  });
});

describe("withLivingItemsTotal", () => {
  it("returns a write without livingItems untouched", () => {
    const fields = { annualAmount: "75000", name: "x" };
    expect(withLivingItemsTotal(fields)).toBe(fields);
  });
  it("stores an empty list as null and keeps the caller's total", () => {
    expect(withLivingItemsTotal({ livingItems: [], annualAmount: "75000" })).toEqual({
      livingItems: null,
      annualAmount: "75000",
    });
  });
  it("overwrites a disagreeing total with the items' sum", () => {
    expect(withLivingItemsTotal({ livingItems: [item()], annualAmount: "1" })).toEqual({
      livingItems: [item()],
      annualAmount: "38400",
    });
  });
  it("adds the total when the caller sent none", () => {
    expect(withLivingItemsTotal({ livingItems: [TRAVEL] })).toEqual({
      livingItems: [TRAVEL],
      annualAmount: "12000",
    });
  });
});

describe("goalPrefillFromItem", () => {
  it("takes the item's name and yearly amount, and the row's years and growth", () => {
    const row = {
      startYear: 2026,
      endYear: 2041,
      startYearRef: "plan_start",
      endYearRef: "client_retirement",
      growthRate: "0.03",
      growthSource: "inflation",
      inflationStartYear: 2026,
    };
    expect(goalPrefillFromItem(item(), row)).toEqual({
      name: "Housing",
      annualAmount: 38400,
      startYear: 2026,
      endYear: 2041,
      startYearRef: "plan_start",
      endYearRef: "client_retirement",
      growthRate: "0.03",
      growthSource: "inflation",
      inflationStartYear: 2026,
    });
  });
  it("turns absent refs and growth source into null", () => {
    const p = goalPrefillFromItem(TRAVEL, { startYear: 2026, endYear: 2030, growthRate: "0.02" });
    expect(p.startYearRef).toBeNull();
    expect(p.endYearRef).toBeNull();
    expect(p.growthSource).toBeNull();
    expect(p.inflationStartYear).toBeNull();
  });
});
