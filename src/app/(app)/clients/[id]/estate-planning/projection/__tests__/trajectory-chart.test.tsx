// @vitest-environment jsdom
/**
 * Tests for TrajectoryChart — hand-rolled SVG stacked bar chart with one bar
 * per projection year, death-year dashed verticals, and a scrubber line keyed
 * by `data-current-year`.
 *
 * Uses the Cooper-Sample fixture (matches comparison-grid.test.tsx and
 * derive-chart-series.test.ts) so both `firstDeathYear` and
 * `secondDeathYear` are populated.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { runProjectionWithEvents } from "@/engine";
import { synthesizeNoPlanClientData } from "@/lib/estate/counterfactual";
import type { ClientData } from "@/engine/types";
import { TrajectoryChart } from "../trajectory-chart";

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

describe("TrajectoryChart", () => {
  const rightTree = cooperSampleScenario();
  const rightResult = runProjectionWithEvents(rightTree);
  const leftTree = synthesizeNoPlanClientData(rightTree);
  const leftResult = runProjectionWithEvents(leftTree);

  it("renders one bar group per projection year with at least one rect", () => {
    const { container } = render(
      <TrajectoryChart
        leftTree={leftTree}
        leftResult={leftResult}
        rightTree={rightTree}
        rightResult={rightResult}
        scrubberYear={2030}
      />,
    );
    const bars = container.querySelectorAll("g[data-year]");
    expect(bars.length).toBe(rightResult.years.length);
    // Each bar must render at least one rect (floor and/or cap).
    for (const bar of bars) {
      expect(bar.querySelectorAll("rect").length).toBeGreaterThanOrEqual(1);
    }
    // At least one bar should show a green-cap "gain" (Plan 2 is the with-plan
    // scenario, beats the no-plan counterfactual once estate tax hits).
    expect(container.querySelectorAll('[data-cap="gain"]').length).toBeGreaterThan(0);
  });

  it("renders dashed vertical guides at firstDeathYear and secondDeathYear", () => {
    const { container } = render(
      <TrajectoryChart
        leftTree={leftTree}
        leftResult={leftResult}
        rightTree={rightTree}
        rightResult={rightResult}
        scrubberYear={2030}
      />,
    );
    const dashed = container.querySelectorAll("line[stroke-dasharray]");
    expect(dashed.length).toBe(2);
  });

  it("moves the current-year line when scrubberYear changes", () => {
    const { container, rerender } = render(
      <TrajectoryChart
        leftTree={leftTree}
        leftResult={leftResult}
        rightTree={rightTree}
        rightResult={rightResult}
        scrubberYear={2030}
      />,
    );
    const before = container
      .querySelector("[data-current-year]")
      ?.getAttribute("x1");
    expect(before).toBeDefined();

    rerender(
      <TrajectoryChart
        leftTree={leftTree}
        leftResult={leftResult}
        rightTree={rightTree}
        rightResult={rightResult}
        scrubberYear={2055}
      />,
    );
    const after = container
      .querySelector("[data-current-year]")
      ?.getAttribute("x1");
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });
});
