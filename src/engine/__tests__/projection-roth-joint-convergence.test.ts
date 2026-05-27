import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  EntitySummary,
  FamilyMember,
  RothConversion,
} from "../types";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";

const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const SPOUSE_FM_ID = "00000000-0000-0000-0000-000000000002";
const TRUST_ID     = "00000000-0000-0000-0000-000000000003";
const CHARITY_ID   = "00000000-0000-0000-0000-000000000004";

/**
 * Reproduces the advisor-reported bug:
 *   - Client born 1970 → RMDs start at age 75 (year 2045).
 *   - Big Trad-IRA targeting 22% fill_up_bracket from 2040.
 *   - Cash gifts to a trust ($50K/yr) — phase 10b leak.
 *   - Charitable cash gift ($20K/yr) — second giftEvent cash drain leak.
 *   - One income source routed to a brokerage instead of checking — phase 6 leak.
 *
 * Note: the plan also called for a "note credits to checking" leak, but the
 * notes-receivable machinery is heavy to wire up for a test fixture and the
 * three leak paths below already stack the supplemental-withdrawal estimate
 * well past the 22% ceiling — sufficient to expose the bug. The post-fix
 * implementation should naturally cover all four leak paths (and any others)
 * because the new design hooks the conversion sizing into phase 12's
 * supplemental-convergence loop directly rather than rebuilding a
 * `projectedCheckingPreTax` estimate by hand.
 *
 * Pre-fix expectation: incomeTaxBase overshoots the 22% ceiling materially
 *   in years 2045+ (first RMD years).
 * Post-fix expectation: every fill-bracket year lands within $100 of the
 *   ceiling.
 */
function jointConvergenceScenario(): ClientData {
  const conversion: RothConversion = {
    id: "rc-fill",
    name: "Fill 22%",
    destinationAccountId: "acc-roth",
    sourceAccountIds: ["acc-ira"],
    conversionType: "fill_up_bracket",
    fillUpBracket: 0.22,
    fixedAmount: 0,
    startYear: 2040,
    indexingRate: 0,
  };

  return {
    client: {
      firstName: "Cooper",
      lastName: "Test",
      dateOfBirth: "1970-01-01", // age 56 in 2026, RMDs at 75 (2045)
      spouseDob: "1975-01-01",
      filingStatus: "married_joint",
      retirementAge: 65,
      planEndAge: 85,
      spouseRetirementAge: 65,
    },
    accounts: [
      // Household default checking — large enough that early-year living
      // expenses are covered without immediate IRA draws.
      {
        id: "acc-checking",
        name: "Joint Checking",
        category: "cash",
        subType: "checking",
        titlingType: "jtwros",
        value: 100_000,
        basis: 100_000,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 0.5 },
          { kind: "family_member", familyMemberId: SPOUSE_FM_ID, percent: 0.5 },
        ],
      },
      // Big Trad IRA — conversion source. Large balance ensures fill_up_bracket
      // has plenty to convert in every targeted year.
      {
        id: "acc-ira",
        name: "Cooper Trad IRA",
        category: "retirement",
        subType: "traditional_ira",
        titlingType: "jtwros",
        value: 2_500_000,
        basis: 0,
        growthRate: 0.05,
        rmdEnabled: true,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
        ],
      },
      // Roth destination.
      {
        id: "acc-roth",
        name: "Cooper Roth IRA",
        category: "retirement",
        subType: "roth_ira",
        titlingType: "jtwros",
        value: 0,
        basis: 0,
        growthRate: 0.05,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
        ],
      },
      // Taxable brokerage — the routing target for one income (phase-6 leak).
      // Income counted in income.total but doesn't actually land in checking,
      // so the closure's projectedCheckingPreTax overstates available cash.
      {
        id: "acc-brokerage",
        name: "Joint Brokerage",
        category: "taxable",
        subType: "brokerage",
        titlingType: "jtwros",
        value: 200_000,
        basis: 200_000,
        growthRate: 0.03,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 0.5 },
          { kind: "family_member", familyMemberId: SPOUSE_FM_ID, percent: 0.5 },
        ],
      },
      // Trust-owned default checking — required so the cash giftEvents have
      // somewhere to land. Without an entity-owned default checking, the gift
      // gets soft-skipped and never drains household cash.
      {
        id: "acc-trust-checking",
        name: "ILIT Checking",
        category: "cash",
        subType: "checking",
        titlingType: "jtwros",
        value: 0,
        basis: 0,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true,
        owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
      },
      // Charity-owned default checking — destination for the charitable cash
      // gift event. Same mechanism: needs an entity-owned default-checking
      // account or the gift never fires.
      {
        id: "acc-charity-checking",
        name: "Foundation Checking",
        category: "cash",
        subType: "checking",
        titlingType: "jtwros",
        value: 0,
        basis: 0,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true,
        owners: [{ kind: "entity", entityId: CHARITY_ID, percent: 1 }],
      },
    ],
    incomes: [
      // Salary ending 2034 — normal household earned income, routes to checking.
      {
        id: "inc-salary",
        name: "Cooper salary",
        type: "salary",
        owner: "client",
        annualAmount: 120_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2034,
      },
      // Client SS starting 2037 (claiming age 67, born 1970).
      {
        id: "inc-cooper-ss",
        name: "Cooper SS",
        type: "social_security",
        owner: "client",
        annualAmount: 40_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2055,
        claimingAge: 67,
      },
      // Spouse SS starting 2042 (claiming age 67, born 1975).
      {
        id: "inc-spouse-ss",
        name: "Spouse SS",
        type: "social_security",
        owner: "spouse",
        annualAmount: 30_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2055,
        claimingAge: 67,
      },
      // Income routed to brokerage instead of checking — the phase-6 leak.
      // Counted in income.total (so the closure adds it to projectedCheckingPreTax)
      // but actually credits the brokerage account, never household checking.
      {
        id: "inc-brokerage-routed",
        name: "Royalty stream → brokerage",
        type: "other",
        owner: "client",
        annualAmount: 30_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2055,
        cashAccountId: "acc-brokerage",
        taxType: "ordinary_income",
      },
    ],
    expenses: [
      // Living expense large enough that SS + RMD inflows can't cover it once
      // the household is retired — phase 12 will fire supplemental IRA draws.
      {
        id: "exp-living",
        type: "living",
        name: "Living",
        annualAmount: 120_000,
        growthRate: 0.025,
        startYear: 2026,
        endYear: 2055,
      },
    ],
    liabilities: [],
    savingsRules: [],
    // IRA-first withdrawal strategy: any supplemental draw lands as ordinary
    // income and stacks on top of the Roth conversion, blowing past the 22%
    // ceiling whenever the closure under-estimates supplemental size.
    withdrawalStrategy: [
      { accountId: "acc-ira",      priorityOrder: 1, startYear: 2026, endYear: 2055 },
      { accountId: "acc-checking", priorityOrder: 2, startYear: 2026, endYear: 2055 },
    ],
    // Cash gifts to the trust each conversion year ($50K) and a charitable
    // gift to a public charity entity ($20K). Both drain household checking,
    // but neither is included in projectedCheckingPreTax — the closure under-
    // estimates the deficit and sizes the conversion as if the cash were still
    // available.
    giftEvents: [
      ...Array.from({ length: 10 }, (_, i) => ({
        kind: "cash" as const,
        year: 2040 + i,
        amount: 50_000,
        grantor: "client" as const,
        recipientEntityId: TRUST_ID,
        useCrummeyPowers: false,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        kind: "cash" as const,
        year: 2040 + i,
        amount: 20_000,
        grantor: "client" as const,
        recipientEntityId: CHARITY_ID,
        useCrummeyPowers: false,
      })),
    ],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2050,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    entities: [
      {
        id: TRUST_ID,
        name: "Cooper ILIT",
        includeInPortfolio: false,
        isGrantor: false,
        entityType: "trust",
        trustSubType: "ilit",
        isIrrevocable: true,
      } as EntitySummary,
      {
        id: CHARITY_ID,
        name: "Cooper Foundation",
        includeInPortfolio: false,
        isGrantor: false,
        entityType: "foundation",
      } as EntitySummary,
    ],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    wills: [],
    rothConversions: [conversion],
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Cooper",
        lastName: "Test",
        relationship: "other",
        role: "client",
        dateOfBirth: "1970-01-01",
      } as FamilyMember,
      {
        id: SPOUSE_FM_ID,
        firstName: "Partner",
        lastName: "Test",
        relationship: "other",
        role: "spouse",
        dateOfBirth: "1975-01-01",
      } as FamilyMember,
    ],
    externalBeneficiaries: [],
    taxYearRows: [TAX_YEAR_2026],
  } as ClientData;
}

describe("Roth fill_up_bracket — joint convergence with phase 12", () => {
  it("lands at the 22% ceiling every year, even with gifts/charity/non-checking income", () => {
    const years = runProjection(jointConvergenceScenario());

    // The bug shows up most strongly in the first RMD years (2045+). Check
    // every year that has a conversion to be defensive — any single overshoot
    // is a failure.
    for (const year of years) {
      const conv = (year.rothConversions ?? [])[0];
      if (!conv || conv.taxable <= 0) continue;

      const tier = year.taxResult!.diag.marginalBracketTier;
      const incomeTaxBase = year.taxResult!.flow.incomeTaxBase;
      // findMarginalTier puts a value exactly at tier.to into the next tier:
      // a perfect 22% fill can surface as rate=0.22 (base ≈ tier.to) or
      // rate=0.24 (base ≈ tier.from, which equals the 22% ceiling).
      const bracket22Top = tier.rate === 0.24 ? tier.from : tier.to ?? 0;

      expect(
        Math.abs(incomeTaxBase - bracket22Top),
        `year ${year.year}: incomeTaxBase ${incomeTaxBase} should land at 22% ceiling ${bracket22Top}`,
      ).toBeLessThan(100);
      expect(
        tier.rate,
        `year ${year.year} marginal rate must stay ≤ 24%`,
      ).toBeLessThanOrEqual(0.24);
    }
  });
});
