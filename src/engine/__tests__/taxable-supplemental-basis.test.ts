// src/engine/__tests__/taxable-supplemental-basis.test.ts
//
// Regression: pro-rata LTCG on household supplemental draws from a taxable
// brokerage. Two related invariants:
//
// 1. The gain ratio uses the *live* account balance, not the immutable
//    Account.value snapshot from the start of the projection.
// 2. After a draw, basisMap is reduced pro-rata so subsequent years recognize
//    the correct gain ratio (basis_new = basis_old * (1 - amount / preBalance)).
//
// Without (2), basis stays inflated relative to a now-smaller balance and the
// engine under-recognizes capital gains in every later year.

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";

describe("taxable supplemental withdrawal — pro-rata basis reduction", () => {
  it("reduces basis pro-rata after a household draw and uses the live balance for the gain ratio", () => {
    // Setup: client-only household, no income, $40k/yr expense, brokerage as
    // the only source. Brokerage starts at $100k value, $40k basis, 0% growth.
    // Flat federal+state set to 0 so the convergence loop doesn't add gross-up
    // and the supplemental draw equals the bare shortfall ($40k each year).
    //
    // Year 1: balance 100k, basis 40k. Draw 40k → cap gain = 40k × (1 − 40/100) = 24k.
    //         Post-draw: balance 60k, basis 40k × (1 − 40/100) = 24k. Same 60% ratio.
    // Year 2: balance 60k, basis 24k. Draw 40k → cap gain = 40k × (1 − 24/60) = 24k. ✓
    //
    // Pre-fix bug: basis stayed 40k after Year 1, so Year 2's gain ratio
    // collapsed to 1 − 40/60 = ~33%, recognizing only ~13.3k instead of 24k.

    const data = buildClientData({
      client: {
        firstName: "Solo",
        lastName: "Client",
        dateOfBirth: "1955-01-01", // age 71 in 2026 — well past 59.5
        retirementAge: 65,
        planEndAge: 90,
        filingStatus: "single",
      },
      familyMembers: [
        {
          id: LEGACY_FM_CLIENT,
          role: "client",
          relationship: "other",
          firstName: "Solo",
          lastName: "Client",
          dateOfBirth: "1955-01-01",
        },
      ],
      accounts: [
        {
          id: "acct-checking",
          name: "Checking",
          category: "cash",
          subType: "checking",
          value: 0,
          basis: 0,
          growthRate: 0,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
          isDefaultChecking: true,
        },
        {
          id: "acct-brokerage",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 100_000,
          basis: 40_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
        },
      ],
      incomes: [],
      expenses: [
        {
          id: "exp-living",
          type: "living",
          name: "Living",
          annualAmount: 40_000,
          startYear: 2026,
          endYear: 2027,
          growthRate: 0,
        },
      ],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [
        { accountId: "acct-brokerage", priorityOrder: 1, startYear: 2026, endYear: 2027 },
      ],
      planSettings: {
        ...basePlanSettings,
        flatFederalRate: 0,
        flatStateRate: 0,
        planStartYear: 2026,
        planEndYear: 2027,
      },
    });

    const result = runProjection(data);
    const year2026 = result[0];
    const year2027 = result[1];

    // Year 1: drew $40k of $100k → 60% gain ratio → $24k recognized cap gain.
    expect(year2026.taxDetail!.capitalGains).toBeCloseTo(24_000, 0);
    // Basis dropped from 40k to 40k × (1 − 40/100) = 24k.
    expect(year2026.accountLedgers["acct-brokerage"].basisEoY).toBeCloseTo(24_000, 0);

    // Year 2: balance 60k, basis 24k → still 60% gain ratio → $24k recognized.
    // Pre-fix this would be ~$13.3k because basis stayed at 40k.
    expect(year2027.taxDetail!.capitalGains).toBeCloseTo(24_000, 0);
    // Basis after Year 2: 24k × (1 − 40/60) = 8k.
    expect(year2027.accountLedgers["acct-brokerage"].basisEoY).toBeCloseTo(8_000, 0);
  });
});
