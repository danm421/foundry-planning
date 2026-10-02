import { describe, it, expect } from "vitest";
import { homeSalePreview } from "../home-sale-preview";
import { runProjection } from "@/engine/projection";
import { buildClientData, sampleLiabilities } from "@/engine/__tests__/fixtures";

describe("homeSalePreview", () => {
  it("projected price, two linked loans, selling costs", () => {
    const tree = buildClientData({
      liabilities: [
        { ...sampleLiabilities[0], linkedPropertyId: "acct-home" },
        { ...sampleLiabilities[0], id: "liab-heloc", balance: 50_000, linkedPropertyId: "acct-home" },
      ],
    });
    const years = runProjection(tree);
    const y = years.find((p) => p.year === 2030)!;
    const p = homeSalePreview(years, tree, { accountId: "acct-home", saleYear: 2030, price: { mode: "projected" }, sellingCostPct: 0.06 });
    const loans = y.liabilityBalancesBoY["liab-mortgage"] + y.liabilityBalancesBoY["liab-heloc"];
    expect(p.projectedValue).toBeCloseTo(y.accountLedgers["acct-home"].beginningValue, 2);
    expect(p.mortgageLeft).toBeCloseTo(loans, 2);
    expect(p.cashToHousehold).toBeCloseTo(p.projectedValue! * 0.94 - loans, 2);
  });

  it("no mortgage: mortgage left is $0 and cash is price minus costs", () => {
    const tree = buildClientData({ liabilities: [] });
    const p = homeSalePreview(runProjection(tree), tree, {
      accountId: "acct-home", saleYear: 2030, price: { mode: "custom", amount: 1_000_000 }, sellingCostPct: 0.06,
    });
    expect(p.mortgageLeft).toBe(0);
    expect(p.cashToHousehold).toBe(940_000);
  });
});
