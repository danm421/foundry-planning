import { describe, it, expect } from "vitest";
import { homeSalePreview } from "../home-sale-preview";
import { runProjection } from "@/engine/projection";
import { ltcHomeSaleId } from "@/engine/ltc-event";
import { buildClientData, baseClient, basePlanSettings, sampleLiabilities } from "@/engine/__tests__/fixtures";
import type { LtcEvent, LtcHomeSale } from "@/engine/types";

const EVENT_ID = "3f1c2d7e-8a1b-4c5d-9e0f-112233445566";
/** John in care 2055–2057, the home (one linked mortgage) sold per `sale`. */
function soldIn(sale: LtcHomeSale) {
  const event: LtcEvent = {
    id: EVENT_ID, name: "LTC", livingExpenseCutPct: null, homeSale: sale, includePolicies: true,
    people: [{ person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129_575, costInflation: 0.05 }],
  };
  return buildClientData({
    client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 95 },
    planSettings: { ...basePlanSettings, planEndYear: 2067 },
    liabilities: [{ ...sampleLiabilities[0], linkedPropertyId: "acct-home" }],
    ltcEvents: [event],
  });
}

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

  it("a sale year outside the projection: mortgage and cash are unknown, not $0", () => {
    const tree = buildClientData({ liabilities: [] });
    const years = runProjection(tree);
    const past = years[years.length - 1].year + 1;
    const p = homeSalePreview(years, tree, {
      accountId: "acct-home", saleYear: past, price: { mode: "custom", amount: 1_000_000 }, sellingCostPct: 0.06,
    });
    expect(p.mortgageLeft).toBeNull();
    expect(p.cashToHousehold).toBeNull();
    // A custom price is known whatever the year, and so are its costs.
    expect(p.sellingCosts).toBe(60_000);
  });

  it("a projection that already sold the home: mortgage and cash are unknown, even with a custom price", () => {
    // The Changes-tab dialog previews against the plan as saved — here a sale in
    // 2030 — so a later draft sale year finds neither the home nor its loan.
    const tree = soldIn({ accountId: "acct-home", saleYear: 2030, price: { mode: "projected" }, sellingCostPct: 0.06 });
    const p = homeSalePreview(runProjection(tree), tree, {
      accountId: "acct-home", saleYear: 2035, price: { mode: "custom", amount: 1_000_000 }, sellingCostPct: 0.06,
    });
    expect(p.projectedValue).toBeNull();
    expect(p.mortgageLeft).toBeNull();
    expect(p.sellingCosts).toBe(60_000);
    expect(p.cashToHousehold).toBeNull();
  });

  it("a projected price that is unknown has unknown selling costs", () => {
    const tree = soldIn({ accountId: "acct-home", saleYear: 2030, price: { mode: "projected" }, sellingCostPct: 0.06 });
    const p = homeSalePreview(runProjection(tree), tree, {
      accountId: "acct-home", saleYear: 2035, price: { mode: "projected" }, sellingCostPct: 0.06,
    });
    expect(p.sellingCosts).toBeNull();
  });

  // The preview must print what the engine books for the LTC sale, to the cent.
  it.each([2030, 2040])("equals the sale the engine books in %i — value, payoff, costs, cash", (saleYear) => {
    const sale = { accountId: "acct-home", saleYear, price: { mode: "projected" as const }, sellingCostPct: 0.06 };
    const tree = soldIn(sale);
    const years = runProjection(tree);
    const booked = years
      .find((y) => y.year === saleYear)!
      .techniqueBreakdown!.sales.find((s) => s.transactionId === ltcHomeSaleId(EVENT_ID))!;
    expect(booked.mortgagePaidOff).toBeGreaterThan(0); // the loan is still open — a real payoff
    const p = homeSalePreview(years, tree, sale);
    expect(p.projectedValue).toBeCloseTo(booked.saleValue, 2);
    expect(p.mortgageLeft).toBeCloseTo(booked.mortgagePaidOff, 2);
    expect(p.sellingCosts).toBeCloseTo(booked.transactionCosts, 2);
    expect(p.cashToHousehold).toBeCloseTo(booked.netProceeds, 2);
  });
});
