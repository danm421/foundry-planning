import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { ltcCareExpenseId, ltcHomeSaleId } from "@/engine/ltc-event";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";
import type { LtcPolicy } from "@/engine/types";
import { buildCashFlowYearDetail, buildNameMaps } from "../cashflow-year-detail";

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

const genworth: LtcPolicy = {
  id: "trad", name: "Genworth", insured: "client", carrier: null, kind: "standalone",
  lifePolicyAccountId: null, issueYear: 2020, benefitAmount: 6000, benefitUnit: "month",
  riderBenefitMode: null, riderMonthlyPct: null, benefitPeriodMode: "years", benefitPeriodYears: 3,
  riderMaxPct: null, extensionYears: 0, residualDeathBenefit: 0, eliminationDays: 90, homeCarePct: 1,
  inflationRider: "none", inflationRate: 0.03, benefitType: "reimbursement", sharedCare: false,
  annualPremium: 0, premiumPayMode: "paid_up", premiumPayToAge: null, premiumPayYears: null,
  partnership: false, notes: null,
};

describe("year detail names an LTC policy's benefit", () => {
  it("lists 'Genworth benefit' with the year's payment", () => {
    const insured = { ...tree, ltcPolicies: [genworth] };
    // 2056 is a full year of benefits: 12 x 6,000 = 72,000 (care costs far more).
    const year = runProjection(insured).find((y) => y.year === 2056)!;
    const items = buildCashFlowYearDetail(year, insured).inflows.flatMap((c) => c.items);
    expect(items).toContainEqual({ id: "ltc-benefit-trad", label: "Genworth benefit", amount: 72_000 });
    expect(buildNameMaps(insured).incomeTypeById["ltc-benefit-trad"]).toBe("other");
  });
});
