/**
 * Plan 3b Task 30 — Cooper-Sample integration test.
 *
 * Wires together the three load-bearing transforms used by the
 * /clients/[id]/estate-planning page:
 *
 *   - `runProjectionWithEvents` (with-plan + counterfactual)
 *   - `deriveSpineData`         (Phase 4: spine variant)
 *   - `deriveScrubberData`      (Phase 6: 3-column comparison cells)
 *   - `rankTrustsByContribution` + `computeTrustCardData` (Phase 8: trust cards)
 *
 * Uses the same inline Cooper-Sample fixture as
 * src/lib/estate/__tests__/plan-3a-integration.test.ts and
 * src/app/(app)/clients/[id]/estate-planning/projection/lib/derive-scrubber-data.test.ts.
 * Real engine output, no stubs.
 */

import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine";
import { synthesizeNoPlanClientData } from "@/lib/estate/counterfactual";
import {
  rankTrustsByContribution,
  computeTrustCardData,
} from "@/lib/estate/strategy-attribution";
import { deriveScrubberData } from "@/app/(app)/clients/[id]/estate-planning/projection/lib/derive-scrubber-data";
import { deriveSpineData } from "@/app/(app)/clients/[id]/estate-planning/spine/lib/derive-spine-data";
import type { ClientData } from "@/engine/types";

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

describe("estate-planning page integration (Cooper Sample)", () => {
  const tree = cooperSampleScenario();
  const withResult = runProjectionWithEvents(tree);
  const withoutResult = runProjectionWithEvents(synthesizeNoPlanClientData(tree));
  // Cooper fixture: client dies 2056 (1968 + 88), spouse dies 2058 (1970 + 88).
  const finalDeathYear =
    withResult.secondDeathEvent?.year ??
    withResult.firstDeathEvent?.year ??
    2058;

  it("with-plan net to heirs ≥ without-plan net to heirs at final death", () => {
    const data = deriveScrubberData({
      tree,
      withResult,
      withoutResult,
      scrubberYear: finalDeathYear,
    });
    expect(data.with.bigNumber).toBeGreaterThanOrEqual(data.without.bigNumber);
  });

  it("spine-data is 'two-grantor' for Cooper Sample", () => {
    const spine = deriveSpineData({ tree, withResult });
    expect(spine.kind).toBe("two-grantor");
  });

  it("scrubber data at planStartYear shows pre-death tax sentinels", () => {
    const data = deriveScrubberData({
      tree,
      withResult,
      withoutResult,
      scrubberYear: tree.planSettings.planStartYear,
    });
    const taxRow = data.without.rows.find(
      (r) => r.label === "Federal + state tax",
    );
    expect(taxRow?.valueText).toContain("pre-death");
    const taxSavedRow = data.impact.rows.find((r) => r.label === "Tax saved");
    expect(taxSavedRow?.valueText).toBe("—");
  });

  it("scrubber data at +10y shows a non-zero out-of-estate value", () => {
    const tenYears = tree.planSettings.planStartYear + 10;
    const data = deriveScrubberData({
      tree,
      withResult,
      withoutResult,
      scrubberYear: tenYears,
    });
    const outRow = data.with.rows.find((r) => r.label === "Out-of-estate");
    expect(outRow?.valueText).toMatch(/\$\d/);
  });

  it("ranked trusts include both irrevocable trusts in the fixture", () => {
    const ranked = rankTrustsByContribution(tree, withResult.years);
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    const ids = ranked.map((r) => r.trustId);
    expect(ids).toContain(ILIT);
    expect(ids).toContain(SLAT);
  });

  it("computeTrustCardData returns non-zero primaryAmount for each ranked trust", () => {
    const ranked = rankTrustsByContribution(tree, withResult.years);
    for (const t of ranked) {
      const card = computeTrustCardData({
        ranked: t,
        tree,
        withResult: withResult.years,
        finalDeathYear,
      });
      expect(card.primaryAmount).toBeGreaterThan(0);
    }
  });
});
