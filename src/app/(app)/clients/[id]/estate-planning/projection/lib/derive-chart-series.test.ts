/**
 * Tests for deriveChartSeries — pure transform that converts
 * (tree, rightResult, leftResult) into chart series for the trajectory chart
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
import { deriveChartSeries, deriveDeltaBands } from "./derive-chart-series";

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
  const rightTree = cooperSampleScenario();
  const rightResult = runProjectionWithEvents(rightTree);
  const leftTree = synthesizeNoPlanClientData(rightTree);
  const leftResult = runProjectionWithEvents(leftTree);

  it("returns right + left arrays of [year, value] pairs", () => {
    const series = deriveChartSeries({ leftTree, rightTree, rightResult, leftResult });
    expect(series.right.length).toBe(rightResult.years.length);
    expect(series.left.length).toBe(leftResult.years.length);
    expect(series.right[0]).toMatchObject([
      rightTree.planSettings.planStartYear,
      expect.any(Number),
    ]);
    expect(series.left[0]).toMatchObject([
      rightTree.planSettings.planStartYear,
      expect.any(Number),
    ]);
  });

  it("returns death-year markers from rightResult", () => {
    const series = deriveChartSeries({ leftTree, rightTree, rightResult, leftResult });
    expect(series.firstDeathYear).toBe(rightResult.firstDeathEvent?.year);
    expect(series.secondDeathYear).toBe(rightResult.secondDeathEvent?.year);
  });

  it("yMin is 0 and yMax is positive (5% headroom over max series value)", () => {
    const series = deriveChartSeries({ leftTree, rightTree, rightResult, leftResult });
    expect(series.yMin).toBe(0);
    expect(series.yMax).toBeGreaterThan(0);
    const maxVal = Math.max(
      ...series.right.map((p) => p[1]),
      ...series.left.map((p) => p[1]),
    );
    expect(series.yMax).toBeCloseTo(maxVal * 1.05, 1);
  });

  it("right-side (with-plan) ending value is >= left-side (no-plan) ending value", () => {
    // Sanity check that the strategy actually pays off — at the end of the
    // projection, after both deaths and tax drag is fully baked in, the
    // right-side (with-plan) series should leave at least as much wealth on
    // the table as the left-side (no-plan) counterfactual.
    const series = deriveChartSeries({ leftTree, rightTree, rightResult, leftResult });
    const lastRight = series.right[series.right.length - 1][1];
    const lastLeft = series.left[series.left.length - 1][1];
    expect(lastRight).toBeGreaterThanOrEqual(lastLeft);
  });

  it("an account added only to rightTree shifts the right series up by ~its value", () => {
    // Regression test for the single-tree bug: previously deriveChartSeries
    // received one tree and used it for both series, so a right-only account
    // leaked into the left series at its initial value, hiding the wealth
    // shift the chart was supposed to visualize.
    const baseTree = cooperSampleScenario();
    const baseResult = runProjectionWithEvents(baseTree);

    const NEW_ACCOUNT_VALUE = 600_000;
    const rightOnlyTree: ClientData = {
      ...baseTree,
      accounts: [
        ...baseTree.accounts,
        {
          id: "scenario-only",
          name: "Scenario-only brokerage",
          category: "taxable",
          subType: "individual",
          value: NEW_ACCOUNT_VALUE,
          basis: NEW_ACCOUNT_VALUE,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 },
          ],
        },
      ],
    } as ClientData;
    const rightOnlyResult = runProjectionWithEvents(rightOnlyTree);

    const series = deriveChartSeries({
      leftTree: baseTree,
      leftResult: baseResult,
      rightTree: rightOnlyTree,
      rightResult: rightOnlyResult,
    });

    const startYearDelta = series.right[0][1] - series.left[0][1];
    expect(startYearDelta).toBeGreaterThan(NEW_ACCOUNT_VALUE * 0.95);
  });
});

describe("deriveDeltaBands", () => {
  it("emits a single positive quad when right ≥ left across the segment", () => {
    const left: [number, number][] = [
      [2026, 100],
      [2027, 110],
    ];
    const right: [number, number][] = [
      [2026, 120],
      [2027, 130],
    ];
    const bands = deriveDeltaBands(left, right);
    expect(bands.positive).toHaveLength(1);
    expect(bands.negative).toHaveLength(0);
    expect(bands.positive[0].points).toHaveLength(4);
  });

  it("emits a single negative quad when left > right across the segment", () => {
    const left: [number, number][] = [
      [2026, 200],
      [2027, 210],
    ];
    const right: [number, number][] = [
      [2026, 100],
      [2027, 110],
    ];
    const bands = deriveDeltaBands(left, right);
    expect(bands.positive).toHaveLength(0);
    expect(bands.negative).toHaveLength(1);
  });

  it("splits a sign-flipping segment at the linearly-interpolated zero crossing", () => {
    // left = right at the zero crossing. left[2026] = 100, left[2027] = 100.
    // right[2026] = 80 (negative delta), right[2027] = 120 (positive delta).
    // Crossing at t = 0.5 → year 2026.5, value 100.
    const left: [number, number][] = [
      [2026, 100],
      [2027, 100],
    ];
    const right: [number, number][] = [
      [2026, 80],
      [2027, 120],
    ];
    const bands = deriveDeltaBands(left, right);
    expect(bands.positive).toHaveLength(1);
    expect(bands.negative).toHaveLength(1);
    // Crossing point appears in both polygons.
    const crossingPos = bands.positive[0].points.find(
      ([y, v]) => Math.abs(y - 2026.5) < 0.01 && Math.abs(v - 100) < 0.01,
    );
    const crossingNeg = bands.negative[0].points.find(
      ([y, v]) => Math.abs(y - 2026.5) < 0.01 && Math.abs(v - 100) < 0.01,
    );
    expect(crossingPos).toBeDefined();
    expect(crossingNeg).toBeDefined();
  });
});
