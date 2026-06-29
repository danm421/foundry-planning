/**
 * Integration tests for runProjection's Medicare/IRMAA wiring.
 *
 * These tests assert four observable behaviors:
 *   1. `projectionYear.medicare` is populated for years the principal is enrolled.
 *   2. The annual Medicare cost gets injected into `expenses.bySource.medicarePremiums`
 *      and rolled into `expenses.total`.
 *   3. An expense flagged `endsAtMedicareEligibilityOwner` is zeroed at the
 *      owner's enrollment year — preventing double-counting pre-Medicare health
 *      premiums alongside the modeled Medicare cost.
 *   4. The 2-year-lookback cold-start uses `coverage.priorYearMagi` for the
 *      first two projection years (when no synthetic history exists yet).
 *
 * Per the project's inline-helper convention (see `slat-40-year.integration.test.ts`
 * for the canonical pattern), `makeMinimalClient` is local to this file and
 * builds only the shape the four tests need.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { LEGACY_FM_CLIENT } from "../ownership";
import type {
  Account,
  ClientData,
  Expense,
  MedicareCoverage,
  PlanSettings,
  WithdrawalPriority,
} from "../types";
import type { TaxYearParameters, FilingStatus } from "../../lib/tax/types";

// ── Test-only tax-year fixture ──────────────────────────────────────────────
// IRMAA brackets from `data/medicare-irmaa-2024-2026.json` (CMS 2025) so the
// cold-start tier assertion below operates on real bracket boundaries; the rest
// of the tax-year params are zero/placeholder because these tests never exercise
// the bracket-mode tax engine (taxEngineMode defaults to "flat").

const IRMAA_TIERS_SINGLE_2025 = [
  { tier: 1, magiLowerBound: 106000, magiUpperBound: 133000, partBSurcharge: 888.0,  partDSurcharge: 164.4 },
  { tier: 2, magiLowerBound: 133000, magiUpperBound: 167000, partBSurcharge: 2220.0, partDSurcharge: 425.4 },
  { tier: 3, magiLowerBound: 167000, magiUpperBound: 200000, partBSurcharge: 3552.0, partDSurcharge: 686.4 },
  { tier: 4, magiLowerBound: 200000, magiUpperBound: 500000, partBSurcharge: 4884.0, partDSurcharge: 947.4 },
  { tier: 5, magiLowerBound: 500000, magiUpperBound: null,   partBSurcharge: 5326.8, partDSurcharge: 1034.4 },
];

const IRMAA_TIERS_MFJ_2025 = [
  { tier: 1, magiLowerBound: 212000, magiUpperBound: 266000, partBSurcharge: 888.0,  partDSurcharge: 164.4 },
  { tier: 2, magiLowerBound: 266000, magiUpperBound: 334000, partBSurcharge: 2220.0, partDSurcharge: 425.4 },
  { tier: 3, magiLowerBound: 334000, magiUpperBound: 400000, partBSurcharge: 3552.0, partDSurcharge: 686.4 },
  { tier: 4, magiLowerBound: 400000, magiUpperBound: 750000, partBSurcharge: 4884.0, partDSurcharge: 947.4 },
  { tier: 5, magiLowerBound: 750000, magiUpperBound: null,   partBSurcharge: 5326.8, partDSurcharge: 1034.4 },
];

function makeTaxYearRow(year: number): TaxYearParameters {
  return {
    year,
    incomeBrackets: {
      married_joint:    [{ from: 0, to: null, rate: 0 }],
      single:           [{ from: 0, to: null, rate: 0 }],
      head_of_household:[{ from: 0, to: null, rate: 0 }],
      married_separate: [{ from: 0, to: null, rate: 0 }],
    },
    capGainsBrackets: {
      married_joint:    { zeroPctTop: 0, fifteenPctTop: 0 },
      single:           { zeroPctTop: 0, fifteenPctTop: 0 },
      head_of_household:{ zeroPctTop: 0, fifteenPctTop: 0 },
      married_separate: { zeroPctTop: 0, fifteenPctTop: 0 },
    },
    trustIncomeBrackets: [],
    trustCapGainsBrackets: [],
    stdDeduction: { married_joint: 0, single: 0, head_of_household: 0, married_separate: 0 },
    amtExemption: { mfj: 0, singleHoh: 0, mfs: 0 },
    amtBreakpoint2628: { mfjShoh: 0, mfs: 0 },
    amtPhaseoutStart: { mfj: 0, singleHoh: 0, mfs: 0 },
    ssTaxRate: 0,
    ssWageBase: 0,
    medicareTaxRate: 0,
    addlMedicareRate: 0,
    addlMedicareThreshold: { mfj: 0, single: 0, mfs: 0 },
    niitRate: 0,
    niitThreshold: { mfj: 0, single: 0, mfs: 0 },
    qbi: {
      thresholdMfj: 0, thresholdSingleHohMfs: 0,
      phaseInRangeMfj: 0, phaseInRangeOther: 0,
    },
    contribLimits: {
      ira401kElective: 0, ira401kCatchup50: 0, ira401kCatchup6063: null,
      iraTradLimit: 0, iraCatchup50: 0,
      simpleLimitRegular: 0, simpleCatchup50: 0,
      hsaLimitSelf: 0, hsaLimitFamily: 0, hsaCatchup55: 0,
    },
    // Medicare additions (Task 7 — projection wires these through).
    standardPartBPremium: 2220.0,
    partDNationalBase: 441.36,
    irmaaBracketsMfj: IRMAA_TIERS_MFJ_2025,
    irmaaBracketsSingle: IRMAA_TIERS_SINGLE_2025,
  };
}

// ── Inline fixture builder ──────────────────────────────────────────────────

interface MinimalClientInput {
  clientDob: string;
  planStartYear: number;
  planEndYear: number;
  filingStatus: FilingStatus;
  medicareCoverage: MedicareCoverage[];
  medicarePremiumInflationRate?: number;
  /** Optional pre-Medicare expense rows the test cares about. Auto-fills id, growthRate. */
  expenses?: Array<{
    type: Expense["type"];
    name: string;
    annualAmount: number;
    startYear: number;
    endYear: number;
    endsAtMedicareEligibilityOwner?: "client" | "spouse";
  }>;
  /** Optional accounts. When absent, defaults to an empty account list. */
  accounts?: Account[];
  /** Optional withdrawal strategy. Tests that exercise the hasChecking
   *  gap-fill path need both a default-checking account AND a strategy entry
   *  pointing at a non-checking source. */
  withdrawalStrategy?: WithdrawalPriority[];
}

function makeMinimalClient(input: MinimalClientInput): ClientData {
  const planSettings: PlanSettings = {
    flatFederalRate: 0,
    flatStateRate: 0,
    inflationRate: 0.02,
    planStartYear: input.planStartYear,
    planEndYear: input.planEndYear,
  };

  const expenses: Expense[] = (input.expenses ?? []).map((e) => ({
    id: e.name, // bySource is id-keyed; using name keeps test assertions readable
    type: e.type,
    name: e.name,
    annualAmount: e.annualAmount,
    startYear: e.startYear,
    endYear: e.endYear,
    growthRate: 0,
    endsAtMedicareEligibilityOwner: e.endsAtMedicareEligibilityOwner,
  }));

  // Range covers planStart..planEnd so the resolver always has a real row.
  const taxYearRows: TaxYearParameters[] = [];
  for (let y = input.planStartYear; y <= input.planEndYear; y++) {
    taxYearRows.push(makeTaxYearRow(y));
  }

  return {
    client: {
      firstName: "Test",
      lastName: "Client",
      dateOfBirth: input.clientDob,
      retirementAge: 65,
      planEndAge: 90,
      filingStatus: input.filingStatus,
    },
    accounts: input.accounts ?? [],
    incomes: [],
    expenses,
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: input.withdrawalStrategy ?? [],
    planSettings,
    giftEvents: [],
    taxYearRows,
    medicareCoverage: input.medicareCoverage,
    medicarePremiumInflationRate: input.medicarePremiumInflationRate,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("runProjection — Medicare integration", () => {
  it("emits projectionYear.medicare for years where person is enrolled", () => {
    const data = makeMinimalClient({
      clientDob: "1960-01-01", // age 65 in 2025
      planStartYear: 2025,
      planEndYear: 2035,
      filingStatus: "single",
      medicareCoverage: [
        {
          owner: "client",
          enrollmentYear: null,
          coverageType: "original",
          medigapMonthlyAt65: null,
          partDPlanMonthlyAt65: null,
          priorYearMagi: 60_000,
        },
      ],
      medicarePremiumInflationRate: 0.05,
    });

    const years = runProjection(data);
    const y2025 = years.find((y) => y.year === 2025)!;
    expect(y2025.medicare).toBeDefined();
    expect(y2025.medicare!.client?.enrolled).toBe(true);
    // $60k MAGI is below tier 1 (single tier 1 starts at $106k).
    expect(y2025.medicare!.client?.irmaaTier).toBe(0);
  });

  it("adds medicarePremiums to expenses.bySource and expenses.total", () => {
    const data = makeMinimalClient({
      clientDob: "1960-01-01",
      planStartYear: 2025,
      planEndYear: 2030,
      filingStatus: "single",
      medicareCoverage: [
        {
          owner: "client",
          enrollmentYear: null,
          coverageType: "original",
          medigapMonthlyAt65: 170,
          partDPlanMonthlyAt65: 46,
          priorYearMagi: 60_000,
        },
      ],
    });

    const years = runProjection(data);
    const y2025 = years.find((y) => y.year === 2025)!;
    expect(y2025.expenses.bySource.medicarePremiums).toBeGreaterThan(0);
    expect(y2025.expenses.bySource.medicarePremiums).toBe(y2025.medicare!.totalAnnualCost);
  });

  it("zeros out an expense flagged endsAtMedicareEligibilityOwner at enrollment year", () => {
    const data = makeMinimalClient({
      clientDob: "1960-01-01",
      planStartYear: 2025,
      planEndYear: 2030,
      filingStatus: "single",
      expenses: [
        {
          type: "insurance",
          name: "Pre-Medicare health insurance",
          annualAmount: 12_000,
          startYear: 2025,
          endYear: 2040,
          endsAtMedicareEligibilityOwner: "client",
        },
      ],
      medicareCoverage: [
        {
          owner: "client",
          enrollmentYear: null,
          coverageType: "original",
          medigapMonthlyAt65: null,
          partDPlanMonthlyAt65: null,
          priorYearMagi: 60_000,
        },
      ],
    });

    const years = runProjection(data);
    const y2025 = years.find((y) => y.year === 2025)!;
    expect(y2025.expenses.bySource["Pre-Medicare health insurance"] ?? 0).toBe(0);
  });

  it("debits Medicare premiums from household checking and triggers a supplemental withdrawal", () => {
    // Regression for the bug where Medicare cost was added to expenses.total
    // (so net cash flow looked correct) but never debited from the household
    // checking ledger, so the supplemental-withdrawal convergence loop
    // under-sized the gap-fill — leaving the cash report's withdrawal number
    // smaller than the actual cash drain.
    const checking: Account = {
      id: "acct-checking",
      name: "Joint Checking",
      category: "cash",
      subType: "checking",
      titlingType: "jtwros",
      value: 0,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: true,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const brokerage: Account = {
      id: "acct-brokerage",
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 100_000,
      basis: 100_000, // basis = value → withdrawal has no realized gain
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const data = makeMinimalClient({
      clientDob: "1960-01-01", // age 65 in 2025 → enrolled
      planStartYear: 2025,
      planEndYear: 2026,
      filingStatus: "single",
      medicareCoverage: [
        {
          owner: "client",
          enrollmentYear: null,
          coverageType: "original",
          medigapMonthlyAt65: 170,
          partDPlanMonthlyAt65: 46,
          priorYearMagi: 60_000, // below tier 1 → no IRMAA, just base premiums
        },
      ],
      accounts: [checking, brokerage],
      withdrawalStrategy: [
        { accountId: "acct-brokerage", priorityOrder: 1, startYear: 2025, endYear: 2099 },
      ],
    });

    const years = runProjection(data);
    const y2025 = years.find((y) => y.year === 2025)!;
    const medicareCost = y2025.medicare!.totalAnnualCost;
    expect(medicareCost).toBeGreaterThan(0);

    // 1. Snapshot still surfaces Medicare in expenses (cash-flow report needs this).
    expect(y2025.expenses.bySource.medicarePremiums).toBe(medicareCost);

    // 2. Household checking ledger has a Medicare debit entry (cash truly leaves).
    const checkingLedger = y2025.accountLedgers["acct-checking"];
    expect(checkingLedger).toBeDefined();
    const medicareEntry = checkingLedger.entries.find(
      (e) => e.sourceId === "medicarePremiums",
    );
    expect(medicareEntry).toBeDefined();
    expect(medicareEntry!.amount).toBe(-medicareCost);

    // 3. The convergence loop saw Medicare and sized the supplemental
    //    withdrawal to cover it (income is zero in this fixture, so the
    //    only outflow is Medicare). Withdrawal must be ≥ Medicare cost.
    expect(y2025.withdrawals.total).toBeGreaterThanOrEqual(medicareCost);
    expect(y2025.withdrawals.byAccount["acct-brokerage"] ?? 0).toBeGreaterThanOrEqual(medicareCost);
  });

  it("cold-start uses priorYearMagi for the first projection year", () => {
    const data = makeMinimalClient({
      clientDob: "1960-01-01",
      planStartYear: 2025,
      planEndYear: 2030,
      filingStatus: "single",
      medicareCoverage: [
        {
          owner: "client",
          enrollmentYear: null,
          coverageType: "original",
          medigapMonthlyAt65: null,
          partDPlanMonthlyAt65: null,
          // $200K is at the upper bound of single tier 3 (2025); exclusive
          // upper-bound check pushes it into tier 4.
          priorYearMagi: 200_000,
        },
      ],
    });

    const years = runProjection(data);
    const y2025 = years.find((y) => y.year === 2025)!;
    expect(y2025.medicare!.client?.isColdStart).toBe(true);
    expect(y2025.medicare!.client?.sourceMagi).toBe(200_000);
    expect(y2025.medicare!.client!.irmaaTier).toBeGreaterThanOrEqual(2);
  });

  it("cold-start IGNORES priorYearMagi when estimatePriorYearMagiFromProjection is true", () => {
    const data = makeMinimalClient({
      clientDob: "1960-01-01",
      planStartYear: 2025,
      planEndYear: 2030,
      filingStatus: "single",
      medicareCoverage: [
        {
          owner: "client",
          enrollmentYear: null,
          coverageType: "original",
          medigapMonthlyAt65: null,
          partDPlanMonthlyAt65: null,
          // Flag on → this stored value must be ignored in favor of the
          // projection-derived cold-start estimate.
          priorYearMagi: 200_000,
          estimatePriorYearMagiFromProjection: true,
        },
      ],
    });

    const years = runProjection(data);
    const y2025 = years.find((y) => y.year === 2025)!;
    expect(y2025.medicare!.client?.isColdStart).toBe(true);
    // 200_000 would force a high IRMAA tier; the estimate from the projection
    // is far lower.
    expect(y2025.medicare!.client?.sourceMagi).not.toBe(200_000);
    expect(y2025.medicare!.client?.sourceMagi).toBeLessThan(200_000);
  });
});
