/**
 * Integration tests: muni interest must reach BOTH money consumers of
 * `taxDetail.taxExemptInterest`, and plain `tax_exempt` must reach neither.
 *
 *   1. IRMAA MAGI — `magiHistory` records AGI + taxExemptInterest, and the
 *      Medicare block reads it back two years later (20 CFR 418.2115).
 *   2. The IRC §86 combined-income test — `calcTaxableSocialSecurity` adds
 *      tax-exempt INTEREST (Form 1040 line 2a) to AGI + 50% of the SS gross.
 *
 * Asserting that a bucket incremented would prove nothing about either, so
 * every assertion below is on a downstream dollar figure: the lookback MAGI,
 * the IRMAA tier it lands in, and the taxable share of Social Security.
 *
 * ⚠️ THE ROUTE MATTERS, NOT JUST THE TOTAL. Both consumers are driven by sums
 * that tax-exempt interest and ORDINARY income enter identically:
 *   IRMAA MAGI    = AGI + taxExemptInterest
 *   §86 combined  = otherIncome + 0.5 × ssGross + taxExemptInterest
 * So an implementation that simply booked muni interest as ordinary taxable
 * income would move both figures by exactly the amounts asserted here — and
 * would be badly wrong, because muni interest is not taxable. Every test below
 * therefore pins the UNCHANGED leg as well: AGI in the IRMAA tests, reported
 * ordinary income in the §86 tests. The pair "MAGI moved / AGI did not" is what
 * proves the dollars travelled as tax-exempt interest.
 *
 * Both describes run the BRACKET tax engine (`taxEngineMode: "bracket"`):
 *   - Flat mode hard-codes `taxableSocialSecurity: 0` (tax.ts), so the §86
 *     tests would pass vacuously against a constant zero.
 *   - Flat mode's taxable base is assembled from `income.salaries/business/
 *     deferred/capitalGains/trust` and omits `income.other`, so the
 *     `type: "other"` ordinary row that positions the household below an IRMAA
 *     boundary would never reach AGI.
 * The tax-year rows are the zeroed fixture below (0% brackets, $0 standard
 * deduction), so AGI is exactly gross income and every figure here is
 * hand-checkable.
 *
 * Per the project's inline-helper convention, `makeTaxYearRow` /
 * `IRMAA_TIERS_*` / `makeMinimalClient` are copied from
 * `projection.medicare.test.ts` and extended with the two fields these tests
 * need (`incomes`, `taxEngineMode`); that file hardcodes `incomes: []` and
 * leaves `taxEngineMode` unset.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  MedicareCoverage,
  PlanSettings,
} from "../types";
import type { TaxYearParameters, FilingStatus } from "../../lib/tax/types";

// ── Test-only tax-year fixture ──────────────────────────────────────────────
// IRMAA brackets from `data/medicare-irmaa-2024-2026.json` (CMS 2025) so the
// tier assertions below operate on real bracket boundaries; the rest of the
// tax-year params are zero/placeholder, which makes AGI == gross income under
// the bracket engine.

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
    rothPhaseout: { startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    iraDeduct: { coveredStartMfj: null, coveredEndMfj: null, coveredStartSingle: null,
                 coveredEndSingle: null, spousalStartMfj: null, spousalEndMfj: null },
    studentLoan: { maxDeduction: null, startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    ctc: { perChild: null, refundableMax: null, odcPerDependent: null },
    saversCredit: { mfj: [], single: [], hoh: [] },
    contribLimits: {
      ira401kElective: 0, ira401kCatchup50: 0, ira401kCatchup6063: null,
      iraTradLimit: 0, iraCatchup50: 0,
      simpleLimitRegular: 0, simpleCatchup50: 0,
      hsaLimitSelf: 0, hsaLimitFamily: 0, hsaCatchup55: 0,
    },
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
  /** Income rows under test. The copied fixture hardcodes an empty list. */
  incomes?: ClientData["incomes"];
  /** Unset (the copied fixture's behaviour) → flat mode. */
  taxEngineMode?: "flat" | "bracket";
}

function makeMinimalClient(input: MinimalClientInput): ClientData {
  const planSettings: PlanSettings = {
    flatFederalRate: 0,
    flatStateRate: 0,
    inflationRate: 0.02,
    planStartYear: input.planStartYear,
    planEndYear: input.planEndYear,
    taxEngineMode: input.taxEngineMode,
  };

  // Range covers planStart..planEnd so the resolver always has a real row —
  // which is also what makes `taxEngineMode: "bracket"` take effect. An
  // exact-match row also pins `resolved.sourceYear === year`, so the Medicare
  // block's `partBFactor` is (1 + rate)^0 = 1 and the IRMAA thresholds below
  // are used UNINFLATED. The hand-calibrated tier straddle depends on that.
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
    accounts: [],
    incomes: input.incomes ?? [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    giftEvents: [],
    taxYearRows,
    medicareCoverage: input.medicareCoverage,
  };
}

type ExemptTaxType = "muni_interest" | "tax_exempt";

/** A single tax-free income row, differing only in which tax type it claims. */
function exemptRow(taxType: ExemptTaxType, annualAmount: number): ClientData["incomes"][number] {
  return {
    id: "inc-exempt",
    type: "other",
    name: "Tax-free income",
    annualAmount,
    growthRate: 0,
    startYear: 2026,
    endYear: 2032,
    owner: "client",
    taxType,
    // `muni_interest` is not in `Income["taxType"]` yet — the union widens in a
    // later task. The cast is deliberate and must stay narrow (never `as any`).
  } as ClientData["incomes"][number];
}

// ── 1. IRMAA MAGI ───────────────────────────────────────────────────────────

describe("muni interest reaches IRMAA MAGI", () => {
  // Positions the household just under the MFJ tier-1 entry so the $50,000 of
  // tax-free income is what decides the tier. `type: "other"` keeps it out of
  // every payroll/QBI path; `taxType: "ordinary_income"` is what puts it in AGI.
  const ORDINARY = 180_000;
  const EXEMPT = 50_000;

  function build(taxType: ExemptTaxType | null): ClientData {
    return makeMinimalClient({
      clientDob: "1959-01-01",          // turns 65 in 2024, enrolled throughout
      planStartYear: 2026,
      planEndYear: 2032,
      filingStatus: "married_joint",
      taxEngineMode: "bracket",
      medicareCoverage: [{
        owner: "client",
        enrollmentYear: 2026,
        coverageType: "original",
        medigapMonthlyAt65: null,
        partDPlanMonthlyAt65: null,
        priorYearMagi: 150_000,
      }],
      incomes: [
        {
          id: "inc-ordinary",
          type: "other",
          name: "Ordinary income",
          annualAmount: ORDINARY,
          growthRate: 0,
          startYear: 2026,
          endYear: 2032,
          owner: "client",
          taxType: "ordinary_income",
        },
        ...(taxType ? [exemptRow(taxType, EXEMPT)] : []),
      ],
    });
  }

  // 2028 reads 2026 under the 2-year lookback, so 2028 is the first year whose
  // sourceMagi is a real projected figure rather than the cold-start override.
  const SOURCE_YEAR = 2026;
  const PREMIUM_YEAR = 2028;
  const sourceIndex = SOURCE_YEAR - 2026;   // the year whose AGI/exempt interest is banked
  const premiumIndex = PREMIUM_YEAR - 2026; // the year that is billed off it

  // Hand calibration for plan year 2026 (bracket engine, zeroed tax params, no
  // accounts and so no above-the-line deductions and no interest income):
  //   AGI              = ordinary 180,000  (SS gross is 0, so no §86 add-back)
  //   taxExemptInterest= 0 / 50,000 (muni) / 0 (tax_exempt)
  //   IRMAA MAGI       = AGI + taxExemptInterest   (projection.ts magiHistory)
  //     baseline   180,000
  //     muni       230,000   → delta exactly 50,000
  //     tax_exempt 180,000   → delta exactly 0
  // Tier, MFJ 2025 (`pickTier`: lower EXCLUSIVE, upper INCLUSIVE), uninflated
  // because the resolver exact-matches every plan year:
  //     180,000 is not > 212,000                     → tier 0
  //     230,000 is > 212,000 and <= 266,000          → tier 1
  const BASELINE_MAGI = 180_000;
  const TIER1_ENTRY = IRMAA_TIERS_MFJ_2025[0].magiLowerBound;   // 212,000
  const TIER1_TOP = IRMAA_TIERS_MFJ_2025[0].magiUpperBound!;    // 266,000

  it("a muni income row raises the lookback MAGI by exactly its amount", () => {
    const baseYears = runProjection(build(null));
    const muniYears = runProjection(build("muni_interest"));
    const base = baseYears[premiumIndex];
    const muni = muniYears[premiumIndex];

    expect(muni.medicare!.client!.sourceYearForIrmaa).toBe(SOURCE_YEAR);
    expect(muni.medicare!.client!.isColdStart).toBe(false);
    // Guard the calibration: if the baseline drifts, the delta below could be
    // right for the wrong reason (e.g. a clamp on both sides).
    expect(base.medicare!.client!.sourceMagi).toBeCloseTo(BASELINE_MAGI, 2);
    expect(muni.medicare!.client!.sourceMagi - base.medicare!.client!.sourceMagi)
      .toBeCloseTo(EXEMPT, 2);

    // ROUTE GUARD. MAGI = AGI + taxExemptInterest, so booking the muni row as
    // ordinary TAXABLE income would move MAGI by the same 50,000 and satisfy
    // every assertion above. Pinning the source year's AGI unchanged is what
    // proves the dollars arrived as tax-exempt interest instead.
    expect(muniYears[sourceIndex].taxResult!.flow.adjustedGrossIncome)
      .toBeCloseTo(baseYears[sourceIndex].taxResult!.flow.adjustedGrossIncome, 2);
    expect(muniYears[sourceIndex].taxResult!.flow.adjustedGrossIncome)
      .toBeCloseTo(ORDINARY, 2);
    // ...and that they are still TAX-FREE to the household.
    expect(muniYears[sourceIndex].taxResult!.income.nonTaxableIncome)
      .toBeCloseTo(EXEMPT, 2);
  });

  it("a tax_exempt income row leaves the lookback MAGI untouched", () => {
    const baseYears = runProjection(build(null));
    const exemptYears = runProjection(build("tax_exempt"));
    const base = baseYears[premiumIndex];
    const exempt = exemptYears[premiumIndex];

    expect(base.medicare!.client!.sourceMagi).toBeCloseTo(BASELINE_MAGI, 2);
    expect(exempt.medicare!.client!.sourceMagi)
      .toBeCloseTo(base.medicare!.client!.sourceMagi, 2);

    // The money must still exist — it is excluded from MAGI, not deleted. A
    // "fix" that dropped the row entirely would satisfy the assertion above.
    expect(exemptYears[sourceIndex].taxResult!.income.nonTaxableIncome)
      .toBeCloseTo(EXEMPT, 2);
    expect(exemptYears[sourceIndex].taxResult!.flow.adjustedGrossIncome)
      .toBeCloseTo(ORDINARY, 2);
  });

  it("enough muni interest pushes the household from tier 0 into IRMAA tier 1", () => {
    const base = runProjection(build(null))[premiumIndex];
    const muni = runProjection(build("muni_interest"))[premiumIndex];
    const exempt = runProjection(build("tax_exempt"))[premiumIndex];

    // Spell the straddle out against the tier table itself rather than trusting
    // the comment: the baseline must sit at or below the tier-1 entry and the
    // muni figure strictly inside tier 1, or the tier assertions below would be
    // testing a boundary that moved.
    expect(base.medicare!.client!.sourceMagi).toBeLessThanOrEqual(TIER1_ENTRY);
    expect(muni.medicare!.client!.sourceMagi).toBeGreaterThan(TIER1_ENTRY);
    expect(muni.medicare!.client!.sourceMagi).toBeLessThanOrEqual(TIER1_TOP);

    expect(base.medicare!.client!.irmaaTier).toBe(0);
    expect(muni.medicare!.client!.irmaaTier).toBe(1);
    // The same dollars booked as plain tax-free income buy no surcharge.
    expect(exempt.medicare!.client!.irmaaTier).toBe(0);
    expect(muni.medicare!.client!.partBIrmaaSurcharge).toBeGreaterThan(0);
    expect(base.medicare!.client!.partBIrmaaSurcharge).toBe(0);
  });
});

// ── 2. The IRC §86 Social Security taxability test ──────────────────────────

describe("muni interest reaches the Social Security taxability test", () => {
  const SS_GROSS = 60_000;
  const ORDINARY = 20_000;
  const EXEMPT = 20_000;

  function build(taxType: ExemptTaxType | null): ClientData {
    return makeMinimalClient({
      clientDob: "1959-01-01",
      planStartYear: 2026,
      planEndYear: 2032,
      filingStatus: "married_joint",
      taxEngineMode: "bracket",
      medicareCoverage: [],   // §86 only — no Medicare cost in this fixture
      incomes: [
        {
          id: "inc-ss",
          type: "social_security",
          name: "Social Security",
          annualAmount: SS_GROSS,
          growthRate: 0,
          startYear: 2026,
          endYear: 2032,
          owner: "client",
          // No `claimingAge`: the row keeps its flat annual figure and skips
          // both the orchestrator and the claim-year month proration, so
          // ssGross is exactly SS_GROSS in every plan year.
        },
        {
          id: "inc-ordinary",
          type: "other",
          name: "Ordinary income",
          annualAmount: ORDINARY,
          growthRate: 0,
          startYear: 2026,
          endYear: 2032,
          owner: "client",
          taxType: "ordinary_income",
        },
        ...(taxType ? [exemptRow(taxType, EXEMPT)] : []),
      ],
    });
  }

  // Hand calibration for plan year 2026, married_joint (IRC §86 / Pub 915, with
  // base1 = 32,000 and base2 = 44,000 from src/lib/tax/constants.ts):
  //   combined income = otherIncome + 0.5 x ssGross + taxExemptInterest
  //   otherIncome     = 20,000  (ordinary row; no above-the-line deductions)
  //   0.5 x ssGross   = 30,000
  //   tier1 cap       = min(0.5 x (44,000 - 32,000), 0.5 x 60,000) = 6,000
  //   85% clamp       = 0.85 x 60,000 = 51,000
  //
  //   baseline / tax_exempt: combined = 50,000
  //     taxable = 6,000 + 0.85 x (50,000 - 44,000) = 6,000 + 5,100 = 11,100
  //   muni:                  combined = 70,000
  //     taxable = 6,000 + 0.85 x (70,000 - 44,000) = 6,000 + 22,100 = 28,100
  //
  // Both sit strictly inside (0, 51,000), so the muni delta of
  // 0.85 x 20,000 = 17,000 is real movement and not a clamp releasing.
  const BASELINE_TAXABLE_SS = 11_100;
  const MUNI_TAXABLE_SS = 28_100;
  const CAP_85 = 0.85 * SS_GROSS;

  /** The brief's anti-vacuity guard: at either clamp the figure cannot move,
   *  and both tests below would pass no matter what the engine does. */
  function expectMeasurable(taxableSs: number) {
    expect(taxableSs).toBeGreaterThan(0);
    expect(taxableSs).toBeLessThan(CAP_85);
  }

  it("a muni income row increases the taxable share of Social Security", () => {
    const base = runProjection(build(null))[0];
    const muni = runProjection(build("muni_interest"))[0];

    expectMeasurable(base.taxResult!.income.taxableSocialSecurity);
    expectMeasurable(muni.taxResult!.income.taxableSocialSecurity);
    expect(base.taxResult!.income.taxableSocialSecurity).toBeCloseTo(BASELINE_TAXABLE_SS, 2);
    expect(muni.taxResult!.income.taxableSocialSecurity)
      .toBeGreaterThan(base.taxResult!.income.taxableSocialSecurity);
    expect(muni.taxResult!.income.taxableSocialSecurity).toBeCloseTo(MUNI_TAXABLE_SS, 2);

    // ROUTE GUARD. §86 combined income is otherIncome + 0.5 × ssGross +
    // taxExemptInterest, so booking the muni row as ordinary income would raise
    // the taxable share by exactly the same 17,000. Reported ordinary income
    // staying at 20,000 is what proves it entered as tax-exempt interest.
    expect(muni.taxResult!.income.ordinaryIncome).toBeCloseTo(ORDINARY, 2);
    expect(base.taxResult!.income.ordinaryIncome).toBeCloseTo(ORDINARY, 2);
  });

  it("a tax_exempt income row does not", () => {
    const base = runProjection(build(null))[0];
    const exempt = runProjection(build("tax_exempt"))[0];

    expectMeasurable(base.taxResult!.income.taxableSocialSecurity);
    expect(base.taxResult!.income.taxableSocialSecurity).toBeCloseTo(BASELINE_TAXABLE_SS, 2);
    expect(exempt.taxResult!.income.taxableSocialSecurity)
      .toBeCloseTo(base.taxResult!.income.taxableSocialSecurity, 2);

    // Excluded from the §86 test, but not taxed and not deleted either: it
    // stays out of ordinary income and shows up as non-taxable dollars.
    expect(exempt.taxResult!.income.ordinaryIncome).toBeCloseTo(ORDINARY, 2);
    expect(exempt.taxResult!.income.nonTaxableIncome)
      .toBeCloseTo(EXEMPT + (SS_GROSS - BASELINE_TAXABLE_SS), 2);
  });
});
