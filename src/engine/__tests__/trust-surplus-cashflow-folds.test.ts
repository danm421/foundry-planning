import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildCrtLifecycleFixture } from "./_fixtures/crt";
import type {
  Account,
  ClientData,
  EntitySummary,
  FamilyMember,
  PlanSettings,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

// ── F8: received trust cash folds into totalIncome / netCashFlow ──────────────

describe("F8 — CRT payment folds into household totalIncome + netCashFlow", () => {
  it("a live CRUT payout appears in totalIncome and lifts netCashFlow positive", () => {
    // realizationCorpus adds a $1M CRT brokerage alongside the $1M CRT checking,
    // so BoY FMV = $2M and the 6% CRUT payout to the household = $120k in 2026.
    // The household has no other income, so after the fold totalIncome == $120k.
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      realizationCorpus: true,
    });
    const years = runProjection(data);
    const y2026 = years.find((y) => y.year === 2026)!;
    expect(y2026).toBeDefined();

    // The CRUT payment is the household's only income line → totalIncome == payment.
    expect(y2026.totalIncome).toBeCloseTo(120_000, 0);
    // Before the fix netCashFlow was NEGATIVE (payment taxed as ordinary income
    // with no matching income line); after the fold it is positive.
    expect(y2026.netCashFlow).toBeGreaterThan(0);
  });
});

describe("F8 — non-grantor trust distribution folds into totalIncome + netCashFlow", () => {
  it("a $50k distribution to a household beneficiary shows in totalIncome/netCashFlow and conserves net worth", () => {
    // Proven fixture (mirrors projection.trust-distribution-conservation.test.ts):
    // trust holds $5k cash + $195k basis==value brokerage, no growth → zero trust
    // income/tax. It distributes $50k fixed to a 100%-household (spouse) beneficiary
    // — pure corpus movement. Household receives $50k cash.
    const planSettings: PlanSettings = {
      flatFederalRate: 0.24,
      flatStateRate: 0.05,
      inflationRate: 0.03,
      planStartYear: 2026,
      planEndYear: 2026,
    };
    const client = {
      firstName: "Alice",
      lastName: "Test",
      dateOfBirth: "1975-01-01",
      retirementAge: 65,
      planEndAge: 90,
      filingStatus: "married_joint" as const,
      spouseName: "Bob Test",
      spouseDob: "1975-06-01",
      spouseRetirementAge: 65,
    };
    const hhChecking: Account = {
      id: "hh-checking",
      name: "Household Checking",
      category: "cash",
      subType: "checking",
      titlingType: "jtwros",
      value: 100_000,
      basis: 100_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
      ],
      isDefaultChecking: true,
    };
    const spouseFm: FamilyMember = {
      id: "fm-spouse",
      relationship: "other",
      role: "other",
      firstName: "Bob",
      lastName: "Test",
      dateOfBirth: "1975-06-01",
    };
    const trustChecking: Account = {
      id: "t1-checking",
      name: "Trust Checking",
      category: "cash",
      subType: "checking",
      titlingType: "jtwros",
      value: 5_000,
      basis: 5_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "t1", percent: 1 }],
      isDefaultChecking: true,
    };
    const trustBrokerage: Account = {
      id: "t1-brokerage",
      name: "Trust Brokerage",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 195_000,
      basis: 195_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "t1", percent: 1 }],
    };
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "trust",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: "fixed",
      distributionAmount: 50_000,
      distributionPercent: null,
      incomeBeneficiaries: [
        { familyMemberId: "fm-spouse", householdRole: "spouse", percentage: 100 },
      ],
    };
    const data: ClientData = {
      client,
      accounts: [hhChecking, trustChecking, trustBrokerage],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [spouseFm],
      entities: [trust],
      giftEvents: [],
    };

    const years = runProjection(data);
    const y0 = years[0];

    // F8: the $50k the household received shows up in Total Income + Net Cash Flow.
    expect(y0.totalIncome).toBeCloseTo(50_000, 0);
    expect(y0.netCashFlow).toBeCloseTo(50_000, 0);
    // Guard: the fold must NOT move cash — checking still ends at 100k + 50k = 150k
    // (surplusSpendPct defaults to 0 → no discretionary spend, surplus retained).
    expect(y0.accountLedgers["hh-checking"].endingValue).toBeCloseTo(150_000, 0);
  });
});
