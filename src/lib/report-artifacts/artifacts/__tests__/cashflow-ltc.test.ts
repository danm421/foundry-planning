import { describe, it, expect, beforeEach, vi } from "vitest";
import { runProjection } from "@/engine";
import { ltcHomeSaleId } from "@/engine/ltc-event";
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
});
