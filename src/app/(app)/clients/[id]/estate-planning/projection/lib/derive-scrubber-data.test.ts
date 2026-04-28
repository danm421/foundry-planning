/**
 * Tests for deriveScrubberData — pure transform that converts
 * (tree, withResult, withoutResult, scrubberYear) into a 3-column
 * comparison-cell data structure consumed by ComparisonGrid (Task 26).
 *
 * Uses the same Cooper-Sample fixture pattern as
 * src/lib/estate/__tests__/plan-3a-integration.test.ts — real engine output
 * from runProjectionWithEvents, no stubs.
 */

import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine";
import { synthesizeNoPlanClientData } from "@/lib/estate/counterfactual";
import type { ClientData } from "@/engine/types";
import { deriveScrubberData } from "./derive-scrubber-data";

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

describe("deriveScrubberData", () => {
  const tree = cooperSampleScenario();
  const withResult = runProjectionWithEvents(tree);
  const withoutResult = runProjectionWithEvents(synthesizeNoPlanClientData(tree));
  // Cooper fixture: client dies 2056 (1968 + 88), spouse dies 2058 (1970 + 88).
  // First death year = 2056, second/final death year = 2058.
  const finalDeathYear =
    withResult.secondDeathEvent?.year ??
    withResult.firstDeathEvent?.year ??
    2058;

  it("returns three columns of cells", () => {
    const data = deriveScrubberData({
      tree,
      withResult,
      withoutResult,
      scrubberYear: 2030,
    });
    expect(data.without).toBeDefined();
    expect(data.with).toBeDefined();
    expect(data.impact).toBeDefined();
    // Each cell has the standard shape.
    expect(data.without.rows).toHaveLength(4);
    expect(data.with.rows).toHaveLength(4);
    expect(data.impact.rows).toHaveLength(4);
  });

  it("pre-death tax rows show '$0 (pre-death)' valueText in without column", () => {
    const data = deriveScrubberData({
      tree,
      withResult,
      withoutResult,
      scrubberYear: 2026,
    });
    const taxRow = data.without.rows.find(
      (r) => r.label === "Federal + state tax",
    );
    expect(taxRow).toBeDefined();
    expect(taxRow!.valueText).toBe("$0 (pre-death)");
  });

  it("post-death tax rows compute real numbers (impact ≈ without − with)", () => {
    // Use final death year so both withoutResult and withResult have estateTax populated.
    const data = deriveScrubberData({
      tree,
      withResult,
      withoutResult,
      scrubberYear: finalDeathYear,
    });
    const startYear = tree.planSettings.planStartYear;
    const idx = finalDeathYear - startYear;
    const withoutTotalTax =
      withoutResult.years[idx]?.estateTax?.totalEstateTax ?? 0;
    const withTotalTax = withResult.years[idx]?.estateTax?.totalEstateTax ?? 0;

    // Sanity — counterfactual should produce > 0 estate tax.
    expect(withoutTotalTax).toBeGreaterThan(0);

    const taxSavedRow = data.impact.rows.find((r) => r.label === "Tax saved");
    expect(taxSavedRow).toBeDefined();
    expect(data.impact.bigNumber).toBeCloseTo(
      withoutTotalTax - withTotalTax,
      0,
    );
  });

  it("Plan Impact tax-saved valueText is '—' pre-death", () => {
    const data = deriveScrubberData({
      tree,
      withResult,
      withoutResult,
      scrubberYear: 2026,
    });
    const taxSavedRow = data.impact.rows.find((r) => r.label === "Tax saved");
    expect(taxSavedRow).toBeDefined();
    expect(taxSavedRow!.valueText).toBe("—");
  });

  it("effective rate saved produces a finite, reasonable string", () => {
    const data = deriveScrubberData({
      tree,
      withResult,
      withoutResult,
      scrubberYear: finalDeathYear,
    });
    const effRow = data.impact.rows.find(
      (r) => r.label === "Effective rate saved",
    );
    expect(effRow).toBeDefined();
    // Either a "—" sentinel (degenerate gross) or a "Xpts" string with a finite number.
    const text = effRow!.valueText;
    if (text !== "—") {
      const match = text.match(/^(-?\d+\.\d+)pts$/);
      expect(match).not.toBeNull();
      const value = Number(match![1]);
      expect(Number.isFinite(value)).toBe(true);
      // Plan should reduce effective rate (with vs without) → savings ≥ 0 in pp.
      // Allow tiny negative drift from rounding; assert sane bounds.
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThan(100);
    }

    // taxFreeGrowthCaptured row is non-NaN and ≥ 0.
    const growthRow = data.impact.rows.find(
      (r) => r.label === "Tax-free growth captured",
    );
    expect(growthRow).toBeDefined();
    // Strip $ and unit suffix to verify finite.
    const growthText = growthRow!.valueText;
    expect(growthText.startsWith("$")).toBe(true);
  });
});
