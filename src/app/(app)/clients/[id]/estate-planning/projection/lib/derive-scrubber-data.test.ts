/**
 * Tests for deriveComparisonData — pure transform that converts
 * (tree, leftResult, rightResult, scrubberYear) into a 3-cell
 * comparison-grid data structure (left / right / delta) consumed by
 * ComparisonGrid.
 *
 * Uses the same Cooper-Sample fixture pattern as
 * src/lib/estate/__tests__/plan-3a-integration.test.ts — real engine output
 * from runProjectionWithEvents, no stubs.
 */

import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine";
import { synthesizeNoPlanClientData } from "@/lib/estate/counterfactual";
import type { ClientData } from "@/engine/types";
import { deriveComparisonData } from "./derive-scrubber-data";

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

describe("deriveComparisonData", () => {
  const rightTree = cooperSampleScenario();
  const rightResult = runProjectionWithEvents(rightTree);
  const leftTree = synthesizeNoPlanClientData(rightTree);
  const leftResult = runProjectionWithEvents(leftTree);

  const ROW_LABELS = [
    "In-estate",
    "Out-of-estate",
    "Estate tax + admin",
    "Net to heirs",
  ] as const;

  function build(scrubberYear: number) {
    return deriveComparisonData({
      leftTree,
      leftResult,
      leftScenarioName: "Do nothing (no plan)",
      leftIsDoNothing: true,
      rightTree,
      rightResult,
      rightScenarioName: "Base Plan",
      rightIsDoNothing: false,
      scrubberYear,
    });
  }

  it("returns left/right/delta cells with the uniform 4-row schema", () => {
    const data = build(rightTree.planSettings.planEndYear);
    expect(data.left.rows.map((r) => r.label)).toEqual([...ROW_LABELS]);
    expect(data.right.rows.map((r) => r.label)).toEqual([...ROW_LABELS]);
    expect(data.delta.rows.map((r) => r.label)).toEqual([...ROW_LABELS]);
  });

  it("delta cell rows are signed (right − left) at post-death years", () => {
    const data = build(rightTree.planSettings.planEndYear);
    const valueAt = (
      rows: typeof data.left.rows,
      label: (typeof ROW_LABELS)[number],
    ) => rows.find((r) => r.label === label)!.signedValue;

    for (const label of ROW_LABELS) {
      const expected = valueAt(data.right.rows, label) - valueAt(data.left.rows, label);
      expect(valueAt(data.delta.rows, label)).toBeCloseTo(expected, 2);
    }
  });

  it("renders pre-death sentinels in tax+admin row when scrubber is before final death", () => {
    const data = build(rightTree.planSettings.planStartYear);
    expect(
      data.right.rows.find((r) => r.label === "Estate tax + admin")!.valueText,
    ).toBe("$0 (pre-death)");
    expect(
      data.delta.rows.find((r) => r.label === "Estate tax + admin")!.valueText,
    ).toBe("—");
  });

  it("hero metric is Net to heirs for plan cells, Net to heirs Δ for delta", () => {
    const data = build(rightTree.planSettings.planEndYear);
    expect(data.left.headlineLabel).toBe("Net to heirs");
    expect(data.right.headlineLabel).toBe("Net to heirs");
    expect(data.delta.headlineLabel).toBe("Net to heirs Δ");
    expect(data.delta.bigNumber).toBeCloseTo(
      data.right.bigNumber - data.left.bigNumber,
      2,
    );
  });

  it("an account that exists only in rightTree contributes only to the right cell", () => {
    // Regression test for the single-tree bug: previously deriveComparisonData
    // received only one tree (the right one) and used it to compute both cells,
    // so a right-only account leaked into the left cell at its initial value.
    // After the fix, leftTree is the source of truth for the left cell — an
    // account that only exists on the right must NOT show up in left totals.
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

    const data = deriveComparisonData({
      leftTree: baseTree,
      leftResult: baseResult,
      leftScenarioName: "Base case",
      leftIsDoNothing: false,
      rightTree: rightOnlyTree,
      rightResult: rightOnlyResult,
      rightScenarioName: "With scenario account",
      rightIsDoNothing: false,
      scrubberYear: baseTree.planSettings.planStartYear,
    });

    const leftIn = data.left.rows.find((r) => r.label === "In-estate")!.signedValue;
    const rightIn = data.right.rows.find((r) => r.label === "In-estate")!.signedValue;

    // In year 0, the new $600K account hasn't grown yet — so the right cell
    // should sit ~$600K above the left cell. Pre-fix, both cells included the
    // account at its initial value and the delta collapsed to ~$0.
    expect(rightIn - leftIn).toBeGreaterThan(NEW_ACCOUNT_VALUE * 0.95);
  });
});
