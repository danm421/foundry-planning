import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { ltcCareExpenseId, ltcHomeSaleId } from "@/engine/ltc-event";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";
import { buildCashFlowYearDetail } from "../cashflow-year-detail";

const ID = "3f1c2d7e-8a1b-4c5d-9e0f-112233445566";
const tree = buildClientData({
  client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 95 },
  planSettings: { ...basePlanSettings, planEndYear: 2067 },
  ltcEvents: [{
    id: ID, name: "LTC", livingExpenseCutPct: null, homeSale: null, includePolicies: true,
    people: [{ person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129_575, costInflation: 0.05 }],
  }],
});

describe("year detail lists the LTC care row by name", () => {
  it("the care row appears under Other Expenses as 'Long-term care — John'", () => {
    const year = runProjection(tree).find((y) => y.year === 2055)!;
    const detail = buildCashFlowYearDetail(year, tree);
    const other = detail.outflows.find((c) => c.key === "other")!;
    expect(other.items).toContainEqual({
      id: ltcCareExpenseId(ID, "client"),
      label: "Long-term care — John",
      amount: expect.any(Number),
    });
  });

  it("the LTC home sale's proceeds appear under Other Inflows by name", () => {
    const withSale = {
      ...tree,
      ltcEvents: [{
        ...tree.ltcEvents![0],
        homeSale: { accountId: "acct-home", saleYear: 2055, price: { mode: "projected" as const }, sellingCostPct: 0.06 },
      }],
    };
    const year = runProjection(withSale).find((y) => y.year === 2055)!;
    const detail = buildCashFlowYearDetail(year, withSale);
    const otherInflows = detail.inflows.find((c) => c.key === "otherInflows")!;
    expect(otherInflows.items).toContainEqual({
      id: `technique-proceeds:${ltcHomeSaleId(ID)}`,
      label: "Net Proceeds: Home sale — long-term care",
      amount: expect.any(Number),
    });
  });
});
