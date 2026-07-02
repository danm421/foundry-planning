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
    // Re-based gap: need = rounded MC additional need + existing coverage.
    expect(data.clientGap?.need).toBe(2_000_000);   // 2M + $0 in force
    expect(data.clientGap?.gap).toEqual({ kind: "shortfall", amount: 2_000_000 });
    // The spouse holds a permanent (whole) policy → still in force at 2048.
    expect(data.spouseGap?.have).toBe(500_000);
    expect(data.spouseGap?.need).toBe(1_800_000);   // 1.3M + 500k WL in force
    expect(data.spouseGap?.gap).toEqual({ kind: "shortfall", amount: 1_300_000 });
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

describe("need ranges", () => {
  // Distinct bounds: curve (straight-line) 1.62M @2048 vs MC 2.0M.
  const rangeSolved: LiSolved = {
    ...solved,
    curveRows: [
      { year: 2044, clientNeed: 1_800_000, spouseNeed: 1_100_000 },
      { year: 2048, clientNeed: 1_620_000, spouseNeed: 1_050_000 },
    ],
  };

  it("builds per-decedent ranges: curve lower bound, MC upper, inventory breakdown", () => {
    const data = buildLifeInsuranceSummaryData(ctx(), {
      ...LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT, solved: rangeSolved,
    });
    // Straight-line rounds UP to $50k: 1.62M → 1.65M.
    expect(data.clientRange?.straightLine).toEqual({ need: 1_650_000, exceedsCap: false });
    expect(data.clientRange?.mc).toEqual({ need: 2_000_000, exceedsCap: false, achievedScorePct: 90 });
    // Client's term expired 2041 < deathYear 2048 → nothing in force.
    expect(data.clientRange?.existingPolicies).toEqual([]);
    expect(data.clientRange?.existingTotal).toBe(0);
    expect(data.clientRange?.totalRecommended).toEqual({ low: 1_650_000, high: 2_000_000 });
    // Spouse: WL permanent → in force; 1.05M is already a $50k boundary so the
    // straight-line bound rounds to itself (1.05M), not up a full step.
    expect(data.spouseRange?.existingPolicies).toEqual([{ name: "WL", faceValue: 500_000 }]);
    expect(data.spouseRange?.totalRecommended).toEqual({ low: 1_550_000, high: 1_800_000 });
    expect(data.spouseRange?.deathYear).toBe(2048);
  });

  it("omits the straight-line bound when the curve has no row at the death year", () => {
    const noRow: LiSolved = { ...solved, curveRows: [{ year: 2044, clientNeed: 1_800_000, spouseNeed: 1_100_000 }] };
    const data = buildLifeInsuranceSummaryData(ctx(), { ...LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT, solved: noRow });
    expect(data.clientRange?.straightLine).toBeNull();
    // MC-only range: low === high.
    expect(data.clientRange?.totalRecommended).toEqual({ low: 2_000_000, high: 2_000_000 });
  });

  it("passes estate-tax addends through per decedent", () => {
    const withAddend: LiSolved = { ...solved, estateTaxAddendClient: 350_000, estateTaxAddendSpouse: 120_000 };
    const data = buildLifeInsuranceSummaryData(ctx(), { ...LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT, solved: withAddend });
    expect(data.clientRange?.estateTaxAddend).toBe(350_000);
    expect(data.spouseRange?.estateTaxAddend).toBe(120_000);
  });

  it("suppresses totalRecommended and flags cap when the MC bound exceeds it", () => {
    const capSolved: LiSolved = {
      ...solved,
      mcClient: { status: "exceeds-cap", faceValue: 20_000_000, achievedScore: 0.7 },
    };
    const data = buildLifeInsuranceSummaryData(ctx(), { ...LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT, solved: capSolved });
    expect(data.clientRange?.mc.exceedsCap).toBe(true);
    expect(data.clientRange?.totalRecommended).toBeNull();
  });

  it("is null when not solved, and spouseRange is null when single", () => {
    const unsolved = buildLifeInsuranceSummaryData(ctx(), LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT);
    expect(unsolved.clientRange).toBeNull();
    const single = ctx({
      clientData: { client: { filingStatus: "single" } } as unknown as ClientData,
      spouseName: null,
    });
    const soloSolved: LiSolved = { ...solved, mcSpouse: null };
    const data = buildLifeInsuranceSummaryData(single, { ...LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT, solved: soloSolved });
    expect(data.clientRange).not.toBeNull();
    expect(data.spouseRange).toBeNull();
  });
});
