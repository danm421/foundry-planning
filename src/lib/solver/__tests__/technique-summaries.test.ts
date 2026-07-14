import { describe, it, expect } from "vitest";
import {
  summarizeRothConversion,
  summarizeAssetTransaction,
  summarizeReinvestment,
} from "../technique-summaries";

describe("technique summaries", () => {
  it("summarizes a fixed-amount roth conversion", () => {
    const s = summarizeRothConversion({
      id: "rc-1",
      name: "Conv",
      destinationAccountId: "a",
      sourceAccountIds: ["b"],
      conversionType: "fixed_amount",
      fixedAmount: 25000,
      startYear: 2030,
      endYear: 2035,
      indexingRate: 0,
    });
    expect(s).toContain("$25,000");
    expect(s).toContain("2030");
  });

  it("summarizes a buy asset transaction", () => {
    const s = summarizeAssetTransaction({
      id: "at-1",
      name: "Lake house",
      type: "buy",
      year: 2031,
    });
    expect(s).toContain("Buy");
    expect(s).toContain("2031");
  });

  it("summarizes a reinvestment", () => {
    const s = summarizeReinvestment({
      id: "ri-1",
      name: "Glide path",
      accountIds: ["a", "b"],
      year: 2040,
      newGrowthRate: 0.05,
      realizeTaxesOnSwitch: false,
      soldFractionByAccount: {},
    });
    expect(s).toContain("2040");
    expect(s).toContain("2 account");
  });

  it("resolves the rate from the target portfolio when newGrowthRate is unresolved (0)", () => {
    const s = summarizeReinvestment(
      {
        id: "ri-2",
        name: "Model switch",
        accountIds: ["a"],
        year: 2026,
        newGrowthRate: 0, // fresh reinvestment — server resolves the real rate
        realizeTaxesOnSwitch: false,
        soldFractionByAccount: {},
        targetType: "model_portfolio",
        modelPortfolioId: "mp-1",
      },
      new Map([["mp-1", 0.068]]),
    );
    expect(s).toContain("7%"); // 0.068 -> 7%
    expect(s).not.toContain("0%");
    expect(s).toContain("2026");
  });

  it("resolves a custom-rate reinvestment from customGrowthRate", () => {
    const s = summarizeReinvestment({
      id: "ri-3", name: "Custom", accountIds: ["a", "b"], year: 2030,
      newGrowthRate: 0, realizeTaxesOnSwitch: false, soldFractionByAccount: {},
      targetType: "custom", customGrowthRate: 0.04,
    });
    expect(s).toContain("4%");
  });
});
