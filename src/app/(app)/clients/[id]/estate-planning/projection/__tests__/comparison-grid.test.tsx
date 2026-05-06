// @vitest-environment jsdom
/**
 * Tests for ComparisonGrid — the picker-driven 3-cell wrapper that mounts
 * three ComparisonCells (left / right / delta) using `deriveComparisonData`.
 *
 * Uses the same Cooper-Sample fixture pattern as
 * `lib/derive-scrubber-data.test.ts` — real engine output via
 * runProjectionWithEvents, no stubs of the derive transform itself.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { runProjectionWithEvents } from "@/engine";
import type { ClientData } from "@/engine/types";
import { ComparisonGrid } from "../comparison-grid";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));

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
  it("renders two pickers (left/right) and a delta column", () => {
    const tree = cooperSampleScenario();
    const result = runProjectionWithEvents(tree);

    render(
      <ComparisonGrid
        clientId="c1"
        tree={tree}
        leftResult={result}
        leftScenarioId="base"
        leftScenarioName="Base case"
        leftIsDoNothing={false}
        rightResult={result}
        rightScenarioId="base"
        rightScenarioName="Base case"
        rightIsDoNothing={false}
        scrubberYear={tree.planSettings.planEndYear}
        scenarios={[]}
        snapshots={[]}
      />,
    );

    const pickers = screen.getAllByRole("combobox");
    expect(pickers).toHaveLength(2);
    expect(screen.getByText(/Net to heirs Δ/)).toBeInTheDocument();
  });

  it("renders pre-death sentinel when scrubber is before final death", () => {
    const tree = cooperSampleScenario();
    const result = runProjectionWithEvents(tree);

    render(
      <ComparisonGrid
        clientId="c1"
        tree={tree}
        leftResult={result}
        leftScenarioId="base"
        leftScenarioName="Base case"
        leftIsDoNothing={false}
        rightResult={result}
        rightScenarioId="base"
        rightScenarioName="Base case"
        rightIsDoNothing={false}
        scrubberYear={tree.planSettings.planStartYear}
        scenarios={[]}
        snapshots={[]}
      />,
    );

    expect(screen.getAllByText("$0 (pre-death)").length).toBeGreaterThanOrEqual(1);
  });
});
