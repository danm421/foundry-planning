/**
 * Asset-transaction sale inside a non-grantor trust — Task 16 (Phase 4).
 *
 * Sentinel for the cap-gain double-tax fix: when a trust-owned business
 * account is sold via an `assetTransactions` entry, the realized LTCG must
 * route to the trust-tax pass (not the household), and accumulate inside the
 * trust (since `distributionMode: null`) where compressed §1(h) brackets and
 * trust-level NIIT apply.
 *
 * Setup mirrors `slat-40-year.integration.test.ts` (Task 14): hand-built
 * minimal ClientData with one SLAT entity, one trust checking account, one
 * trust-owned business account at $5M value / $1M basis with growthRate 0
 * (so corpus stays put until the sale). One asset transaction at year 2030
 * sells the business in full.
 *
 * Expected math: $5M − $1M = $4M LTCG retained at the trust.
 *   - Compressed §1(h) trust LTCG: 0/15/20% with breakpoints <$17K → ~80% in
 *     20% bracket → federalCapGainsTax ≈ $800K
 *   - NIIT 3.8% × ($4M − $16,250) ≈ $151K
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  EntitySummary,
  Account,
  AssetTransaction,
  PlanSettings,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

// ── Shared minimal scaffolding (mirrors Task 14) ────────────────────────────

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2032, // covers the 2030 sale year + cushion
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

const trustChecking: Account = {
  id: "slat-3-checking",
  name: "SLAT Checking",
  category: "cash",
  subType: "checking",
  value: 50_000,
  basis: 50_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
    { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
  ],
  isDefaultChecking: true,
};

// Trust-owned business — held flat at $5M (growthRate 0) so the only gain
// in 2030 comes from the asset-transaction sale, not ambient growth.
const trustBusiness: Account = {
  id: "slat-business",
  name: "SLAT Business",
  category: "business",
  subType: "private",
  value: 5_000_000,
  basis: 1_000_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "entity", entityId: "slat-3", percent: 1 }],
};

// Full-position sale of the business in 2030.
const sale2030: AssetTransaction = {
  id: "tx-slat-business-sale",
  name: "Sell SLAT Business",
  type: "sell",
  year: 2030,
  accountId: "slat-business",
};

// 2026 compressed Form 1041 brackets (mirrors Task 14).
const TRUST_INCOME_2026 = [
  { from: 0,     to: 3300,  rate: 0.10 },
  { from: 3300,  to: 12000, rate: 0.24 },
  { from: 12000, to: 16250, rate: 0.35 },
  { from: 16250, to: null,  rate: 0.37 },
];
const TRUST_CAP_GAINS_2026 = [
  { from: 0,     to: 3350,  rate: 0    },
  { from: 3350,  to: 16300, rate: 0.15 },
  { from: 16300, to: null,  rate: 0.20 },
];

const taxYearRow: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint:    [{ from: 0, to: null, rate: 0.10 }],
    single:           [{ from: 0, to: null, rate: 0.10 }],
    head_of_household:[{ from: 0, to: null, rate: 0.10 }],
    married_separate: [{ from: 0, to: null, rate: 0.10 }],
  },
  capGainsBrackets: {
    married_joint:    { zeroPctTop: 94050, fifteenPctTop: 583750 },
    single:           { zeroPctTop: 47025, fifteenPctTop: 518900 },
    head_of_household:{ zeroPctTop: 63000, fifteenPctTop: 551350 },
    married_separate: { zeroPctTop: 47025, fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: TRUST_INCOME_2026,
  trustCapGainsBrackets: TRUST_CAP_GAINS_2026,
  stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 21900, married_separate: 15000 },
  amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
  amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
  amtPhaseoutStart: { mfj: 1237450, singleHoh: 618700, mfs: 618725 },
  ssTaxRate: 0.062,
  ssWageBase: 176100,
  medicareTaxRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  niitRate: 0.038,
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  qbi: {
    thresholdMfj: 383900,
    thresholdSingleHohMfs: 191950,
    phaseInRangeMfj: 100000,
    phaseInRangeOther: 50000,
  },
  contribLimits: {
    ira401kElective: 23500,
    ira401kCatchup50: 7500,
    ira401kCatchup6063: 11250,
    iraTradLimit: 7000,
    iraCatchup50: 1000,
    simpleLimitRegular: 17000,
    simpleCatchup50: 4000,
    hsaLimitSelf: 4400,
    hsaLimitFamily: 8750,
    hsaCatchup55: 1000,
  },
};

// ── Test ────────────────────────────────────────────────────────────────────

describe("Trust-owned business sale", () => {
  it("asset-transaction sale inside non-grantor trust — gain taxed at compressed LTCG", () => {
    const slat: EntitySummary = {
      id: "slat-3",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "trust",
      trustSubType: "slat",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: null, // accumulate so the gain hits the trust directly
      distributionAmount: null,
      distributionPercent: null,
      incomeBeneficiaries: [],
    };

    const data: ClientData = {
      client,
      accounts: [hhChecking, trustChecking, trustBusiness],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [],
      entities: [slat],
      assetTransactions: [sale2030],
      taxYearRows: [taxYearRow],
    };

    const years = runProjection(data);
    const year2030 = years.find((y) => y.year === 2030);
    expect(year2030).toBeDefined();

    const trustTax = year2030!.trustTaxByEntity?.get("slat-3");
    expect(trustTax).toBeDefined();
    expect(trustTax!.recognizedCapGains).toBeGreaterThan(3_900_000);
    expect(trustTax!.federalCapGainsTax).toBeGreaterThan(700_000);
    expect(trustTax!.niit).toBeGreaterThan(100_000);
  });
});
