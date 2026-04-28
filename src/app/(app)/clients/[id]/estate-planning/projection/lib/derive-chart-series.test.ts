/**
 * Tests for deriveChartSeries — pure transform that converts
 * (tree, withResult, withoutResult) into chart series for the trajectory chart
 * consumed by Task 28's TrajectoryChart component.
 *
 * Uses the same Cooper-Sample fixture pattern as
 * src/lib/estate/__tests__/plan-3a-integration.test.ts and
 * derive-scrubber-data.test.ts — real engine output from
 * runProjectionWithEvents, no stubs.
 */

import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine";
import { synthesizeNoPlanClientData } from "@/lib/estate/counterfactual";
import type { ClientData } from "@/engine/types";
import { deriveChartSeries } from "./derive-chart-series";

const FM_CLIENT = "fm-client";
const FM_SPOUSE = "fm-spouse";
const ILIT = "trust-ilit";
const SLAT = "trust-slat";
const STANFORD = "ext-stanford";

function cooperSampleScenario(): ClientData {
  return {
    client: {
      firstName: "Tom",
      lastName: "Cooper",
      dateOfBirth: "1968-01-01",
      retirementAge: 65,
      planEndAge: 88,
      lifeExpectancy: 88,
      filingStatus: "married_joint",
      spouseDob: "1970-01-01",
      spouseLifeExpectancy: 88,
    },
    accounts: [
      {
        id: "joint-broker",
        name: "Joint brokerage",
        category: "taxable",
        subType: "individual",
        value: 12_000_000,
        basis: 8_000_000,
        growthRate: 0.06,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
          { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.5 },
        ],
      },
      {
        id: "slat-acc",
        name: "SLAT brokerage",
        category: "taxable",
        subType: "individual",
        value: 2_400_000,
        basis: 2_400_000,
        growthRate: 0.06,
        rmdEnabled: false,
        owners: [{ kind: "entity", entityId: SLAT, percent: 1 }],
      },
      {
        id: "ilit-policy",
        name: "Term life policy",
        category: "life_insurance",
        subType: "term",
        value: 0,
        basis: 0,
        growthRate: 0,
        rmdEnabled: false,
        lifeInsurance: { faceValue: 5_000_000 },
        owners: [{ kind: "entity", entityId: ILIT, percent: 1 }],
      },
    ],
    incomes: [
      {
        id: "inc-1",
        type: "salary",
        name: "Salary",
        owner: "client",
        annualAmount: 1_200_000,
        growthRate: 0,
        startYear: 2026,
        endYear: 2032,
      },
    ],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0.4,
      flatStateRate: 0.06,
      inflationRate: 0.025,
      planStartYear: 2026,
      planEndYear: 2066,
      taxEngineMode: "flat",
      taxInflationRate: 0.025,
      flatStateEstateRate: 0.12,
      estateAdminExpenses: 50_000,
    },
    entities: [
      {
        id: ILIT,
        name: "Cooper ILIT",
        entityType: "trust",
        trustSubType: "ilit",
        isIrrevocable: true,
        isGrantor: false,
        includeInPortfolio: false,
        grantor: "client",
      },
      {
        id: SLAT,
        name: "Cooper SLAT",
        entityType: "trust",
        trustSubType: "slat",
        isIrrevocable: true,
        isGrantor: true,
        includeInPortfolio: false,
        grantor: "client",
      },
    ],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [
      {
        id: "g-slat",
        year: 2026,
        amount: 2_400_000,
        grantor: "client",
        recipientEntityId: SLAT,
        useCrummeyPowers: false,
      },
      {
        id: "g-charity",
        year: 2026,
        amount: 100_000,
        grantor: "client",
        recipientExternalBeneficiaryId: STANFORD,
        useCrummeyPowers: false,
      },
    ],
    giftEvents: [],
    wills: [],
    familyMembers: [
      {
        id: FM_CLIENT,
        firstName: "Tom",
        lastName: "Cooper",
        relationship: "other",
        role: "client",
        dateOfBirth: "1968-01-01",
      },
      {
        id: FM_SPOUSE,
        firstName: "Linda",
        lastName: "Cooper",
        relationship: "other",
        role: "spouse",
        dateOfBirth: "1970-01-01",
      },
    ],
    externalBeneficiaries: [
      { id: STANFORD, name: "Stanford", kind: "charity", charityType: "public" },
    ],
  } as unknown as ClientData;
}

describe("deriveChartSeries", () => {
  const tree = cooperSampleScenario();
  const withResult = runProjectionWithEvents(tree);
  const withoutResult = runProjectionWithEvents(synthesizeNoPlanClientData(tree));

  it("returns withSeries + withoutSeries arrays of [year, value] pairs", () => {
    const series = deriveChartSeries({ tree, withResult, withoutResult });
    expect(series.with.length).toBe(withResult.years.length);
    expect(series.without.length).toBe(withoutResult.years.length);
    expect(series.with[0]).toMatchObject([
      tree.planSettings.planStartYear,
      expect.any(Number),
    ]);
    expect(series.without[0]).toMatchObject([
      tree.planSettings.planStartYear,
      expect.any(Number),
    ]);
  });

  it("returns death-year markers from withResult", () => {
    const series = deriveChartSeries({ tree, withResult, withoutResult });
    expect(series.firstDeathYear).toBe(withResult.firstDeathEvent?.year);
    expect(series.secondDeathYear).toBe(withResult.secondDeathEvent?.year);
  });

  it("yMin is 0 and yMax is positive (5% headroom over max series value)", () => {
    const series = deriveChartSeries({ tree, withResult, withoutResult });
    expect(series.yMin).toBe(0);
    expect(series.yMax).toBeGreaterThan(0);
    const maxVal = Math.max(
      ...series.with.map((p) => p[1]),
      ...series.without.map((p) => p[1]),
    );
    expect(series.yMax).toBeCloseTo(maxVal * 1.05, 1);
  });

  it("with-plan ending value (post-final-death) is >= without-plan ending value", () => {
    // Sanity check that the strategy actually pays off — at the end of the
    // projection, after both deaths and tax drag is fully baked in, the
    // with-plan series should leave at least as much wealth on the table as
    // the no-plan counterfactual. (The Cooper fixture moves $2.4M into a SLAT
    // and adds $5M of ILIT-held term insurance, both of which sidestep estate
    // tax, so the inequality should be strict — but we assert >= to stay
    // robust to fixture tweaks.)
    const series = deriveChartSeries({ tree, withResult, withoutResult });
    const lastWith = series.with[series.with.length - 1][1];
    const lastWithout = series.without[series.without.length - 1][1];
    expect(lastWith).toBeGreaterThanOrEqual(lastWithout);
  });
});
