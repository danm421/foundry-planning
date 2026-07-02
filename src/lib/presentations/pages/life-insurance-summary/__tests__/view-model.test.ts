// src/lib/presentations/pages/life-insurance-summary/__tests__/view-model.test.ts
import { describe, it, expect } from "vitest";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ClientData } from "@/engine/types";
import type { LifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";
import { buildLifeInsuranceSummaryData } from "../view-model";
import { LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT } from "../options-schema";
import type { LiSolved } from "../options-schema";

const inventory: LifeInsuranceInventory = {
  policies: [
    {
      accountId: "p1", name: "Term 20", policyType: "term", ownerLabel: "Cooper",
      insuredLabel: "Cooper", insuredPerson: "client", deathBenefit: 1_000_000,
      cashValue: 0, premiumAmount: 1_200, termExpiryYear: 2041, carrier: "NW",
      beneficiaries: [{ tier: "primary", name: "Dana", percentage: 100 }],
    },
    {
      accountId: "p2", name: "WL", policyType: "whole", ownerLabel: "Dana",
      insuredLabel: "Dana", insuredPerson: "spouse", deathBenefit: 500_000,
      cashValue: 180_000, premiumAmount: 4_000, termExpiryYear: null, carrier: "MM",
      beneficiaries: [],
    },
  ],
};

const solved: LiSolved = {
  curveRows: [
    { year: 2044, clientNeed: 1_800_000, spouseNeed: 1_100_000 },
    { year: 2048, clientNeed: 2_000_000, spouseNeed: 1_300_000 },
  ],
  mcClient: { status: "solved", faceValue: 2_000_000, achievedScore: 0.9 },
  mcSpouse: { status: "solved", faceValue: 1_300_000, achievedScore: 0.9 },
  estateTaxAddendClient: null,
  estateTaxAddendSpouse: null,
  assumptions: { deathYear: 2048, modelPortfolioLabel: "Balanced 60/40", mcTargetScore: 0.9 },
};

function ctx(over: Partial<BuildDataContext> = {}): BuildDataContext {
  const clientData = {
    client: { filingStatus: "married_joint", spouseDob: "1968-01-01" },
    planSettings: { planStartYear: 2025 },
  } as unknown as ClientData;
  return {
    clientData,
    clientName: "Cooper",
    spouseName: "Dana",
    scenarioLabel: "Base Plan",
    lifeInsurance: inventory,
    ...over,
  } as unknown as BuildDataContext;
}

describe("buildLifeInsuranceSummaryData", () => {
  it("builds inventory totals, per-decedent gaps, and chart from solved data", () => {
    const data = buildLifeInsuranceSummaryData(ctx(), {
      ...LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT, solved,
    });
    expect(data.isEmpty).toBe(false);
    expect(data.notSolved).toBe(false);
    // Total death benefit is the full inventory (term $1M + whole $500k).
    expect(data.totals.deathBenefit).toBe(1_500_000);
    expect(data.policies).toHaveLength(2);
    // The client's only policy is a term that expires in 2041; the solved death
    // year is 2048, so it's out of force → $0 in-force coverage, full-need shortfall.
    expect(data.clientGap?.have).toBe(0);
    expect(data.clientGap?.need).toBe(2_000_000);
    expect(data.clientGap?.gap).toEqual({ kind: "shortfall", amount: 2_000_000 });
    // The spouse holds a permanent (whole) policy → still in force at 2048.
    expect(data.spouseGap?.have).toBe(500_000);
    expect(data.spouseGap?.need).toBe(1_300_000);
    expect(data.chart.rows).toHaveLength(2);
    expect(data.married).toBe(true);
  });

  it("clips the need-over-time chart to the first→last year with a need", () => {
    const padded: LiSolved = {
      ...solved,
      curveRows: [
        { year: 2030, clientNeed: 0, spouseNeed: 0 },             // before need — dropped
        { year: 2031, clientNeed: 0, spouseNeed: 0 },             // before need — dropped
        { year: 2032, clientNeed: 500_000, spouseNeed: 0 },       // first need
        { year: 2033, clientNeed: 300_000, spouseNeed: 100_000 },
        { year: 2034, clientNeed: 0, spouseNeed: 200_000 },       // last need (spouse-only)
        { year: 2035, clientNeed: 0, spouseNeed: 0 },             // after need — dropped
        { year: 2036, clientNeed: 0, spouseNeed: 0 },             // after need — dropped
      ],
    };
    const data = buildLifeInsuranceSummaryData(ctx(), { ...LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT, solved: padded });
    expect(data.chart.rows.map((r) => r.year)).toEqual([2032, 2033, 2034]);
  });

  it("flags notSolved when no solved payload is present", () => {
    const data = buildLifeInsuranceSummaryData(ctx(), LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT);
    expect(data.notSolved).toBe(true);
    expect(data.clientGap).toBeNull();
    expect(data.policies).toHaveLength(2); // inventory still renders
  });

  it("is single when unmarried — no spouse gap or curve", () => {
    const single = ctx({
      clientData: { client: { filingStatus: "single" } } as unknown as ClientData,
      spouseName: null,
    });
    const soloSolved: LiSolved = { ...solved, mcSpouse: null };
    const data = buildLifeInsuranceSummaryData(single, { ...LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT, solved: soloSolved });
    expect(data.married).toBe(false);
    expect(data.spouseGap).toBeNull();
  });

  it("isEmpty when no policies and no solved data", () => {
    const data = buildLifeInsuranceSummaryData(
      ctx({ lifeInsurance: { policies: [] } }),
      LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT,
    );
    expect(data.isEmpty).toBe(true);
  });

  it("renders exceeds-cap MC need", () => {
    const capSolved: LiSolved = {
      ...solved,
      mcClient: { status: "exceeds-cap", faceValue: 20_000_000, achievedScore: 0.7 },
    };
    const data = buildLifeInsuranceSummaryData(ctx(), { ...LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT, solved: capSolved });
    expect(data.clientGap?.exceedsCap).toBe(true);
  });
});
