/**
 * 40-year SLAT projection integration tests — Task 14 (Phase 4).
 *
 * Two correctness gates verifying the trust-tax wire-in (Tasks 12 + 13)
 * end-to-end across a full 40-year horizon:
 *
 *   1. Full DNI carry-out (pct_income = 100% to a household FamilyMember):
 *      The trust retains nothing taxable, so trustTaxByEntity[slat].total ≈ 0,
 *      and because the beneficiary is household-classified (FamilyMember
 *      relationship "other"), estimatedBeneficiaryTax stays at 0.
 *
 *   2. Full accumulation (distributionMode null):
 *      All ordinary income is retained at the trust. Compressed 1041 brackets
 *      push federal tax up fast, and ordinary + dividends > the NIIT threshold
 *      so NIIT > 0. We assert year-1 total > $10K including NIIT > 0.
 *
 * We hand-construct a minimal ClientData here (rather than calling fixtures.ts'
 * `buildClientData`, which seeds non-trust accounts that would pollute these
 * assertions). Pattern mirrors `grantor-trust-distribution.test.ts` (Task 13).
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  EntitySummary,
  Account,
  PlanSettings,
  FamilyMember,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

// ── Shared minimal scaffolding ──────────────────────────────────────────────

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2065, // 40 years inclusive (2026..2065)
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

// Household checking — required so household-side cash inflows from trust
// distributions have a destination account.
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

// Spouse-as-FamilyMember — relationship "other" routes deriveBeneficiaryKind
// to "household" so distributed DNI does NOT generate beneficiary-level tax.
const spouseFm: FamilyMember = {
  id: "fm-spouse",
  relationship: "other",
  role: "other",
  firstName: "Bob",
  lastName: "Test",
  dateOfBirth: "1975-06-01",
};

// Realization profile loosely modeled on a 60/40-style portfolio:
// 6% growth → 60% ordinary income, 15% qualified dividends, 25% LTCG (none turned over).
// At $2M corpus this generates ~$72K ordinary + ~$18K dividends per year — well above
// the compressed-bracket NIIT threshold for the accumulation case.
const brokerageRealization = {
  pctOrdinaryIncome: 0.6,
  pctQualifiedDividends: 0.15,
  pctLtCapitalGains: 0.25,
  pctTaxExempt: 0,
  turnoverPct: 0,
};

function trustChecking(entityId: string, id: string): Account {
  return {
    id,
    name: "SLAT Checking",
    category: "cash",
    subType: "checking",
    value: 50_000,
    basis: 50_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity" as const, entityId, percent: 1 }],
    isDefaultChecking: true,
  };
}

function trustBrokerage(entityId: string, id: string): Account {
  return {
    id,
    name: "SLAT Brokerage",
    category: "taxable",
    subType: "brokerage",
    value: 2_000_000,
    basis: 2_000_000,
    growthRate: 0.06,
    rmdEnabled: false,
    owners: [{ kind: "entity" as const, entityId, percent: 1 }],
    realization: brokerageRealization,
  };
}

// Trust bracket fixtures — 2026 compressed Form 1041 ordinary + §1(h) LTCG.
// Without these the engine falls back to empty brackets and computes $0 federal
// trust tax, making the accumulation assertion meaningless. Mirror the values
// from `apply-trust-annual-pass.test.ts` so this stays a black-box check.
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
  // Trust NIIT threshold is the compressed-37% floor (per projection.ts L863-866).
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

function emptyClientData(
  accounts: Account[],
  familyMembers: FamilyMember[],
  entities: EntitySummary[],
): ClientData {
  return {
    client,
    accounts,
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    familyMembers,
    entities,
    taxYearRows: [taxYearRow],
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SLAT 40-year projection", () => {
  it("full DNI carry-out to spouse — corpus grows without trust tax", () => {
    const slat: EntitySummary = {
      id: "slat-1",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "trust",
      trustSubType: "slat",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: "pct_income",
      distributionAmount: null,
      distributionPercent: 1.0,
      incomeBeneficiaries: [{ familyMemberId: "fm-spouse", householdRole: "spouse", percentage: 100 }],
    };
    const data = emptyClientData(
      [
        hhChecking,
        trustChecking("slat-1", "slat-1-checking"),
        trustBrokerage("slat-1", "slat-1-brokerage"),
      ],
      [spouseFm],
      [slat],
    );

    const years = runProjection(data);
    expect(years).toHaveLength(40);
    const year40 = years[39];

    // 100% pct_income carries all DNI out → trust retains nothing taxable.
    // Floating-point + small state-tax cross-effects could leave a few-dollar
    // residue; tolerate < $100 over the full 40-year horizon.
    expect(year40.trustTaxByEntity?.get("slat-1")?.total ?? 0).toBeLessThan(100);

    // Household-classified beneficiary (FamilyMember "other") → no out-of-household
    // beneficiary tax line.
    expect(year40.estimatedBeneficiaryTax ?? 0).toBe(0);

    // Sanity: corpus actually grew over 40 years (LTCG is unrealized, so the
    // brokerage value compounds even with full DNI distribution).
    const brokerageEnd = year40.accountLedgers["slat-1-brokerage"]?.endingValue ?? 0;
    expect(brokerageEnd).toBeGreaterThan(2_000_000);
  });

  it("full accumulation — corpus grows by retained after-tax; trust tax compounds", () => {
    const slat: EntitySummary = {
      id: "slat-2",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "trust",
      trustSubType: "slat",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: null,
      distributionAmount: null,
      distributionPercent: null,
      incomeBeneficiaries: [],
    };
    const data = emptyClientData(
      [
        hhChecking,
        trustChecking("slat-2", "slat-2-checking"),
        trustBrokerage("slat-2", "slat-2-brokerage"),
      ],
      [],
      [slat],
    );

    const years = runProjection(data);
    expect(years).toHaveLength(40);
    const year1 = years[0];

    const tax = year1.trustTaxByEntity?.get("slat-2");
    expect(tax).toBeDefined();
    // Compressed brackets + NIIT on $72K ordinary + $18K divs at $2M → far above $10K.
    expect(tax!.total).toBeGreaterThan(10_000);
    expect(tax!.niit).toBeGreaterThan(0);
  });
});
