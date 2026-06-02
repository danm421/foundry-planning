import { describe, it, expect } from "vitest";
import {
  liquidPortfolioTotal,
  resolveBalanceSheetYear,
} from "../view-model";

describe("liquidPortfolioTotal", () => {
  it("sums cash + taxable + retirement only", () => {
    const categories = [
      { key: "cash", total: 100 },
      { key: "taxable", total: 200 },
      { key: "retirement", total: 300 },
      { key: "realEstate", total: 1000 },
      { key: "business", total: 5000 },
      { key: "lifeInsurance", total: 50 },
    ];
    expect(liquidPortfolioTotal(categories)).toBe(600);
  });

  it("returns 0 when no liquid categories are present", () => {
    expect(liquidPortfolioTotal([{ key: "realEstate", total: 1000 }])).toBe(0);
  });
});

describe("resolveBalanceSheetYear", () => {
  const years = [{ year: 2026 }, { year: 2027 }, { year: 2028 }];

  it("uses the first projection year in 'today' mode", () => {
    expect(resolveBalanceSheetYear(years, { asOf: "today", year: 2099 })).toBe(2026);
  });

  it("uses the selected year in 'eoy' mode when in range", () => {
    expect(resolveBalanceSheetYear(years, { asOf: "eoy", year: 2027 })).toBe(2027);
  });

  it("clamps the selected year to the projection range in 'eoy' mode", () => {
    expect(resolveBalanceSheetYear(years, { asOf: "eoy", year: 2099 })).toBe(2028);
    expect(resolveBalanceSheetYear(years, { asOf: "eoy", year: 2000 })).toBe(2026);
  });

  it("falls back to the option year when there are no projection years", () => {
    expect(resolveBalanceSheetYear([], { asOf: "eoy", year: 2030 })).toBe(2030);
  });
});
