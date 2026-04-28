// @vitest-environment jsdom
/**
 * Tests for ComparisonGrid — 3-column wrapper that mounts three
 * ComparisonCells (without / with / impact) using `deriveScrubberData`.
 *
 * Uses the same Cooper-Sample fixture pattern as
 * `lib/derive-scrubber-data.test.ts` — real engine output via
 * runProjectionWithEvents, no stubs of deriveScrubberData itself.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { runProjectionWithEvents } from "@/engine";
import { synthesizeNoPlanClientData } from "@/lib/estate/counterfactual";
import type { ClientData } from "@/engine/types";
import { ComparisonGrid } from "../comparison-grid";

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

describe("ComparisonGrid", () => {
  const tree = cooperSampleScenario();
  const withResult = runProjectionWithEvents(tree);
  const withoutResult = runProjectionWithEvents(synthesizeNoPlanClientData(tree));
  const finalDeathYear =
    withResult.secondDeathEvent?.year ??
    withResult.firstDeathEvent?.year ??
    2058;

  it("renders three cells with the correct headlines", () => {
    render(
      <ComparisonGrid
        tree={tree}
        withResult={withResult}
        withoutResult={withoutResult}
        scrubberYear={finalDeathYear}
      />,
    );
    // "Net to heirs" appears in both the without-headline and with-headline
    // (and also as a row label in each cell), so getAllByText is required.
    const netHeadlines = screen.getAllByText("Net to heirs");
    expect(netHeadlines.length).toBeGreaterThanOrEqual(2);
    // Plan-impact headline ("Tax saved" appears both as headline AND as a
    // row label inside the impact cell — getAllByText picks up both).
    expect(screen.getAllByText("Tax saved").length).toBeGreaterThanOrEqual(1);
    // Column eyebrow labels confirm all three variants mount.
    expect(screen.getByText("Without plan")).toBeDefined();
    expect(screen.getByText("With current plan")).toBeDefined();
    expect(screen.getByText("Plan impact")).toBeDefined();
  });

  it("reflects scrubberYear changes via re-render", () => {
    const { rerender } = render(
      <ComparisonGrid
        tree={tree}
        withResult={withResult}
        withoutResult={withoutResult}
        scrubberYear={2026}
      />,
    );
    // Pre-death: the tax row in the without column shows "$0 (pre-death)".
    expect(screen.getAllByText("$0 (pre-death)").length).toBeGreaterThanOrEqual(1);

    rerender(
      <ComparisonGrid
        tree={tree}
        withResult={withResult}
        withoutResult={withoutResult}
        scrubberYear={finalDeathYear}
      />,
    );
    // Post-death: pre-death sentinel is gone (real numbers replace it).
    expect(screen.queryByText("$0 (pre-death)")).toBeNull();
  });
});
