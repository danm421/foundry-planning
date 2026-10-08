import { describe, it, expect, beforeEach, vi } from "vitest";
import { runProjection } from "@/engine";
import { ltcHomeSaleId } from "@/engine/ltc-event";
import type { LtcPolicy } from "@/engine/types";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";

const ID = "3f1c2d7e-8a1b-4c5d-9e0f-112233445566";
// John (born 1970) is in care 2055–2057 and dies in 2057, at 87. The home
// (acct-home) is sold in 2055.
const tree = buildClientData({
  client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 95 },
  planSettings: { ...basePlanSettings, planEndYear: 2067 },
  ltcEvents: [{
    id: ID, name: "LTC", livingExpenseCutPct: null, includePolicies: true,
    homeSale: { accountId: "acct-home", saleYear: 2055, price: { mode: "projected" }, sellingCostPct: 0.06 },
    people: [{ person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129_575, costInflation: 0.05 }],
  }],
});

async function fetchBase() {
  const { cashflowArtifact } = await import("../cashflow");
  const { data } = await cashflowArtifact.fetchData({
    clientId: "c1",
    firmId: "f1",
    opts: { scenarioId: null, yearStart: null, yearEnd: null },
  });
  return data.sections.base;
}

async function fetchSection(id: "income") {
  const { cashflowArtifact } = await import("../cashflow");
  const { data } = await cashflowArtifact.fetchData({
    clientId: "c1",
    firmId: "f1",
    opts: { scenarioId: null, yearStart: null, yearEnd: null },
  });
  return data.sections[id];
}

const genworth: LtcPolicy = {
  id: "trad", name: "Genworth", insured: "client", carrier: null, kind: "standalone",
  lifePolicyAccountId: null, issueYear: 2020, benefitAmount: 6000, benefitUnit: "month",
  riderBenefitMode: null, riderMonthlyPct: null, benefitPeriodMode: "years", benefitPeriodYears: 3,
  riderMaxPct: null, extensionYears: 0, residualDeathBenefit: 0, eliminationDays: 90, homeCarePct: 1,
  inflationRider: "none", inflationRate: 0.03, benefitType: "reimbursement", sharedCare: false,
  annualPremium: 0, premiumPayMode: "paid_up", premiumPayToAge: null, premiumPayYears: null,
  partnership: false, notes: null,
};

describe("cash-flow PDF follows an LTC scenario", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/scenario/loader", () => ({
      loadEffectiveTree: vi.fn().mockResolvedValue({ effectiveTree: tree, warnings: [] }),
    }));
  });

  it("the person in care shows an age through the care death year and '—' after it", async () => {
    const base = await fetchBase();
    expect(base.rows.find((r) => r.year === 2057)!.age).toBe("87 / 85");
    expect(base.rows.find((r) => r.year === 2058)!.age).toBe("— / 86");
  });

  it("Other Inflows counts the LTC home sale's proceeds", async () => {
    const base = await fetchBase();
    const proceeds = runProjection(tree).find((y) => y.year === 2055)!
      .income.bySource[`technique-proceeds:${ltcHomeSaleId(ID)}`];
    expect(proceeds).toBeGreaterThan(0);
    expect(base.rows.find((r) => r.year === 2055)!.cells.otherInflows).toBeCloseTo(proceeds, 2);
  });

  // Regression pin: the PDF's income section has fixed aggregate columns (no
  // per-source rows), so a policy's benefit shows up in the "other" column.
  it("the income section's Other column carries the policy benefit", async () => {
    const withPolicy = { ...tree, ltcPolicies: [genworth] };
    const control = {
      ...tree,
      ltcEvents: [{ ...tree.ltcEvents![0], includePolicies: false }],
      ltcPolicies: [genworth],
    };
    const other2056 = async (t: typeof tree) => {
      vi.resetModules();
      vi.doMock("@/lib/scenario/loader", () => ({
        loadEffectiveTree: vi.fn().mockResolvedValue({ effectiveTree: t, warnings: [] }),
      }));
      const section = await fetchSection("income");
      return section.rows.find((r) => r.year === 2056)!.cells.other;
    };
    const projected = runProjection(withPolicy).find((y) => y.year === 2056)!.income.other;
    const insured = await other2056(withPolicy);
    const uninsured = await other2056(control);
    expect(insured).toBeCloseTo(projected, 2);
    // 2056 is a full benefit year: 12 x 6,000 = 72,000 above the no-policy control.
    expect(insured - uninsured).toBeCloseTo(72_000, 2);
  });
});
