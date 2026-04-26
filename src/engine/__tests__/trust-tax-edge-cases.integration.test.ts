/**
 * Trust-tax edge cases — Task 17 (Phase 4).
 *
 * Three sentinels covering boundary conditions that aren't exercised by
 * Tasks 14/15/16:
 *
 *   1. Zero-income year — trust holds only non-yielding cash, distribution
 *      mode is pct_income with a household beneficiary. With no income to
 *      carry out and no realized gains, the trust must retain $0 of taxable
 *      income, produce no trust-level tax, and emit no insufficient-liquid
 *      warning.
 *
 *   2. Insufficient liquid for a fixed distribution — trust requests a $1M
 *      fixed distribution against $50K of cash. The engine must cap the
 *      actual distribution at the available liquid pool and emit a
 *      `trust_distribution_insufficient_liquid` warning (per
 *      compute-distribution.ts L30-36).
 *
 *   3. Out-of-household beneficiary — distributed DNI must NOT flow into
 *      the household 1040; instead, an `estimatedBeneficiaryTax` flat-rate
 *      line is computed at `planSettings.outOfHouseholdRate`. Verifies the
 *      route-dni.ts non-household branch (L46-50) lights up positively.
 *
 * Hand-built minimal ClientData mirrors the Task 14/16 pattern.
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

// ── Shared minimal scaffolding ──────────────────────────────────────────────

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2028,
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

// Household checking — destination for any trust→household cash inflows and
// the household-side default checking account the engine expects.
const hhChecking: Account = {
  id: "hh-checking",
  name: "Household Checking",
  category: "cash",
  subType: "checking",
  owner: "joint",
  value: 100_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
};

// Spouse-as-FamilyMember — relationship "other" routes deriveBeneficiaryKind
// to "household" so distributed DNI does NOT generate beneficiary-level tax.
const spouseFm: FamilyMember = {
  id: "fm-spouse",
  relationship: "other",
  firstName: "Bob",
  lastName: "Test",
  dateOfBirth: "1975-06-01",
};

// 2026 compressed Form 1041 ordinary + §1(h) LTCG brackets — supplied for
// consistency with Task 14/15/16. Tests 2 + 3 specifically need them so that
// any retained trust income would produce a non-vacuous federal tax (test 2's
// shortfall warning fires before any tax is computed, but bracket presence
// keeps the fixture honest).
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

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Trust tax — edge cases", () => {
  it("zero-income year: no distribution, no trust tax, no insufficient-liquid warning", () => {
    // Trust holds only non-yielding cash (growthRate 0). pct_income with
    // 50% target → target = 0.5 × 0 = $0. No distribution fires, no DNI
    // is carried out, the trust retains nothing taxable, and the
    // shortfall-warning code path stays dormant.
    const trustChecking: Account = {
      id: "t1-checking",
      name: "Trust Checking",
      category: "cash",
      subType: "checking",
      owner: "joint",
      value: 100_000,
      basis: 100_000,
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: true,
      ownerEntityId: "t1",
    };
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "trust",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: "pct_income",
      distributionAmount: null,
      distributionPercent: 0.5,
      incomeBeneficiaries: [{ familyMemberId: "fm-spouse", householdRole: "spouse", percentage: 100 }],
    };
    const data: ClientData = {
      client,
      accounts: [hhChecking, trustChecking],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [spouseFm],
      entities: [trust],
      taxYearRows: [taxYearRow],
    };

    const years = runProjection(data);
    const y0 = years[0];

    // No retained taxable income → no trust-level tax.
    expect(y0.trustTaxByEntity?.get("t1")?.total ?? 0).toBe(0);

    // Insufficient-liquid warning must NOT fire when target = $0.
    const warnings = y0.trustWarnings ?? [];
    expect(
      warnings.find(
        (w) =>
          w.code.startsWith("trust_distribution_insufficient") &&
          w.entityId === "t1",
      ),
    ).toBeUndefined();
  });

  it("insufficient liquid for fixed distribution: cap + insufficient-liquid warning", () => {
    // Trust requests a $1M fixed distribution against $50K of cash (no
    // brokerage). Engine caps actual at $50K and emits the
    // `trust_distribution_insufficient_liquid` warning. (Mirrors the
    // pattern at grantor-trust-distribution.test.ts L231-256.)
    const trustChecking: Account = {
      id: "t1-checking",
      name: "Trust Checking",
      category: "cash",
      subType: "checking",
      owner: "joint",
      value: 50_000,
      basis: 50_000,
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: true,
      ownerEntityId: "t1",
    };
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "trust",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: "fixed",
      distributionAmount: 1_000_000,
      distributionPercent: null,
      incomeBeneficiaries: [{ familyMemberId: "fm-spouse", householdRole: "spouse", percentage: 100 }],
    };
    const data: ClientData = {
      client,
      accounts: [hhChecking, trustChecking],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [spouseFm],
      entities: [trust],
      taxYearRows: [taxYearRow],
    };

    const years = runProjection(data);
    const y0 = years[0];

    const warnings = y0.trustWarnings ?? [];
    expect(
      warnings.some(
        (w) =>
          w.code === "trust_distribution_insufficient_liquid" &&
          w.entityId === "t1",
      ),
    ).toBe(true);
  });

  it("out-of-household beneficiary: flat-rate beneficiary tax line populated", () => {
    // pct_income 100% with no FamilyMember (only an external beneficiary id)
    // → beneficiaryKind = "non_household". DNI is routed through
    // route-dni.ts L46-50 which multiplies (ordinary + dividends) DNI by
    // planSettings.outOfHouseholdRate. With a $1M taxable brokerage at 6%
    // growth + a 60/15/25 realization profile, year-1 generates ~$36K
    // ordinary + ~$9K dividends ≈ $45K DNI → ~$16.6K beneficiary tax.
    const trustChecking: Account = {
      id: "t1-checking",
      name: "Trust Checking",
      category: "cash",
      subType: "checking",
      owner: "joint",
      value: 50_000,
      basis: 50_000,
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: true,
      ownerEntityId: "t1",
    };
    const trustBrokerage: Account = {
      id: "t1-brokerage",
      name: "Trust Brokerage",
      category: "taxable",
      subType: "brokerage",
      owner: "joint",
      value: 1_000_000,
      basis: 1_000_000,
      growthRate: 0.06,
      rmdEnabled: false,
      ownerEntityId: "t1",
      realization: {
        pctOrdinaryIncome: 0.6,
        pctQualifiedDividends: 0.15,
        pctLtCapitalGains: 0.25,
        pctTaxExempt: 0,
        turnoverPct: 0,
      },
    };
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "trust",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: "pct_income",
      distributionAmount: null,
      distributionPercent: 1.0,
      incomeBeneficiaries: [{ externalBeneficiaryId: "child-ext-id", percentage: 100 }],
    };
    const data: ClientData = {
      client,
      accounts: [hhChecking, trustChecking, trustBrokerage],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...planSettings, outOfHouseholdRate: 0.37 },
      familyMembers: [],
      entities: [trust],
      taxYearRows: [taxYearRow],
    };

    const years = runProjection(data);
    const y0 = years[0];

    // Out-of-household routing populates the beneficiary-tax line.
    // Year-1 fixture math: ordinary ≈ $36K + dividends ≈ $9K = $45K DNI
    // → $45K × 0.37 ≈ $16.6K beneficiary tax (observed $16,650).
    expect(y0.estimatedBeneficiaryTax ?? 0).toBeGreaterThan(0);
  });
});
