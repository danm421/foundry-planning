import { describe, it, expect } from "vitest";
import { deriveEffectiveLtcgRate } from "@/lib/investments/rebalance/tax-estimate";
import { calcCapGainsTax } from "../capGains";
import { calculateTaxYear } from "../calculate";
import { applyTaxRateStress } from "../rate-stress";
import type { CalcInput, CapGainsTier, TaxYearParameters } from "../types";

// Copied verbatim from `params2026()` in ./calculate.test.ts rather than
// imported: importing one test file from another re-registers its whole suite
// inside this run (see the comment at src/engine/__tests__/fixtures.ts:244).
function params2026(): TaxYearParameters {
  return {
    year: 2026,
    incomeBrackets: {
      married_joint: [
        { from: 0, to: 24800, rate: 0.10 },
        { from: 24800, to: 100800, rate: 0.12 },
        { from: 100800, to: 211950, rate: 0.22 },
        { from: 211950, to: 405000, rate: 0.24 },
        { from: 405000, to: 510400, rate: 0.32 },
        { from: 510400, to: 768700, rate: 0.35 },
        { from: 768700, to: null, rate: 0.37 },
      ],
      single: [
        { from: 0, to: 12400, rate: 0.10 },
        { from: 12400, to: 50400, rate: 0.12 },
        { from: 50400, to: 105700, rate: 0.22 },
        { from: 105700, to: 201775, rate: 0.24 },
        { from: 201775, to: 255350, rate: 0.32 },
        { from: 255350, to: 640600, rate: 0.35 },
        { from: 640600, to: null, rate: 0.37 },
      ],
      head_of_household: [
        { from: 0, to: 17700, rate: 0.10 },
        { from: 17700, to: 67450, rate: 0.12 },
        { from: 67450, to: 105700, rate: 0.22 },
        { from: 105700, to: 201750, rate: 0.24 },
        { from: 201750, to: 256200, rate: 0.32 },
        { from: 256200, to: 640600, rate: 0.35 },
        { from: 640600, to: null, rate: 0.37 },
      ],
      married_separate: [
        { from: 0, to: 12400, rate: 0.10 },
        { from: 12400, to: 50400, rate: 0.12 },
        { from: 50400, to: 105875, rate: 0.22 },
        { from: 105875, to: 201775, rate: 0.24 },
        { from: 201775, to: 255350, rate: 0.32 },
        { from: 255350, to: 384350, rate: 0.35 },
        { from: 384350, to: null, rate: 0.37 },
      ],
    },
    capGainsBrackets: {
      married_joint: { zeroPctTop: 99200, fifteenPctTop: 615900 },
      single: { zeroPctTop: 49600, fifteenPctTop: 547500 },
      head_of_household: { zeroPctTop: 66450, fifteenPctTop: 581550 },
      married_separate: { zeroPctTop: 49600, fifteenPctTop: 307950 },
    },
    trustIncomeBrackets: [],
    trustCapGainsBrackets: [],
    stdDeduction: { married_joint: 32200, single: 16100, head_of_household: 24150, married_separate: 16100 },
    amtExemption: { mfj: 140200, singleHoh: 90100, mfs: 70100 },
    amtBreakpoint2628: { mfjShoh: 244500, mfs: 122250 },
    amtPhaseoutStart: { mfj: 1000000, singleHoh: 500000, mfs: 500000 },
    ssTaxRate: 0.062,
    ssWageBase: 184500,
    medicareTaxRate: 0.0145,
    addlMedicareRate: 0.009,
    addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    niitRate: 0.038,
    niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    qbi: { thresholdMfj: 405000, thresholdSingleHohMfs: 201775, phaseInRangeMfj: 150000, phaseInRangeOther: 75000 },
    rothPhaseout: { startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    iraDeduct: { coveredStartMfj: null, coveredEndMfj: null, coveredStartSingle: null,
                 coveredEndSingle: null, spousalStartMfj: null, spousalEndMfj: null },
    studentLoan: { maxDeduction: null, startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    ctc: { perChild: null, refundableMax: null, odcPerDependent: null },
    saversCredit: { mfj: [], single: [], hoh: [] },
    contribLimits: {
      ira401kElective: 24500, ira401kCatchup50: 8000, ira401kCatchup6063: 11250,
      iraTradLimit: 7500, iraCatchup50: 1100,
      simpleLimitRegular: 17000, simpleCatchup50: 4000,
      hsaLimitSelf: 4400, hsaLimitFamily: 8750, hsaCatchup55: 1000,
    },
  };
}

const BASE_PARAMS: TaxYearParameters = params2026();

const PLAIN: CapGainsTier = { zeroPctTop: 100_000, fifteenPctTop: 600_000 };
const STRESSED: CapGainsTier = { ...PLAIN, midRate: 0.18, topRate: 0.23 };

/** A high-ISO-spread MFJ household whose AMT binds — the case where freezing
 *  AMT while raising regular rates is observable. */
function amtBoundInput(taxParams: TaxYearParameters): CalcInput {
  return {
    year: 2030,
    filingStatus: "married_joint",
    earnedIncome: 250_000,
    ordinaryIncome: 0,
    qualifiedDividends: 0,
    longTermCapitalGains: 200_000,
    shortTermCapitalGains: 0,
    qbiIncome: 0,
    taxExemptIncome: 0,
    socialSecurityGross: 0,
    aboveLineDeductions: 0,
    itemizedDeductions: 0,
    flatStateRate: 0,
    isoSpread: 900_000,
    taxParams,
    inflationFactor: 1.0,
  };
}

describe("calcCapGainsTax — preferential rates come off the tier", () => {
  it("uses statutory 15% when the tier carries no override", () => {
    // $50k of gain stacked on $100k of ordinary: all of it in the 15% band.
    expect(calcCapGainsTax(50_000, 100_000, PLAIN)).toBeCloseTo(7_500, 6);
  });

  it("uses the tier's midRate when present", () => {
    expect(calcCapGainsTax(50_000, 100_000, STRESSED)).toBeCloseTo(9_000, 6);
  });

  it("uses statutory 20% above the 15% ceiling when unstressed", () => {
    // $100k of gain stacked on $600k: all above fifteenPctTop.
    expect(calcCapGainsTax(100_000, 600_000, PLAIN)).toBeCloseTo(20_000, 6);
  });

  it("uses the tier's topRate when present", () => {
    expect(calcCapGainsTax(100_000, 600_000, STRESSED)).toBeCloseTo(23_000, 6);
  });

  it("still taxes nothing inside the zero band, stressed or not", () => {
    expect(calcCapGainsTax(50_000, 0, STRESSED)).toBe(0);
  });
});

describe("the investment-rebalance surface keeps statutory rates", () => {
  // deriveEffectiveLtcgRate is a REAL-TRADE estimate on the Investments screen,
  // not a projection. It must not inherit a hypothetical from the solver.
  //
  // Scope of this test, precisely: it pins the statutory fallback through the
  // rebalance entry point. It does NOT prove the screen can never be HANDED a
  // stressed tier — load-inputs.ts `loadTaxContext` builds its brackets from
  // `runProjection(data)`'s year-0 `diag.bracketsUsed`, so once the resolver
  // learns the stressor, a stress saved onto BASE plan settings with a
  // startYear at or before year 0 would reach here. Keeping that from
  // happening belongs to the resolver task, not to this function.
  it("derives 15% from an unstressed tier", () => {
    const rate = deriveEffectiveLtcgRate({
      existingLtcg: 0,
      ordinaryBase: 200_000,
      brackets: PLAIN,
      niit: { magi: 0, investmentIncome: 0, threshold: 250_000, rate: 0.038 },
      incrementalGain: 10_000,
    });
    // $210k stack sits entirely in the 15% band; MAGI is under the NIIT floor.
    expect(rate).toBeCloseTo(0.15, 6);
  });
});

describe("AMT is not stressed", () => {
  // Build the same params row twice: once plain, once through the stressor.
  const plain = structuredClone(BASE_PARAMS);
  const stressed = applyTaxRateStress(
    structuredClone(BASE_PARAMS), { points: 0.03, startYear: 2030 }, 2030);

  const plainResult = calculateTaxYear(amtBoundInput(plain));
  const stressedResult = calculateTaxYear(amtBoundInput(stressed));

  it("has an AMT-bound baseline (guards every test below from vacuity)", () => {
    expect(plainResult.flow.amtAdditional).toBeGreaterThan(0); // ~279,653
  });

  it("raises the regular capital-gains tax", () => {
    expect(stressedResult.flow.capitalGainsTax)          // 36,000 vs 30,000
      .toBeGreaterThan(plainResult.flow.capitalGainsTax);
  });

  it("raises the regular ordinary tax", () => {
    expect(stressedResult.flow.regularTaxCalc)           // 43,991 vs 37,457
      .toBeGreaterThan(plainResult.flow.regularTaxCalc);
  });

  it("leaves tentative AMT identical — the stressor never reaches it", () => {
    // calculate.ts — subpartA = regularTaxCalc + capitalGainsTax + amtAdditional
    // = max(regular + capGains, tentativeAmt). With AMT binding, that subtotal IS
    // tentative AMT, so this reconstructs it from the exposed fields.
    // Pre-fix: 353,110 vs 347,110. Post-fix: identical.
    const tentative = (r: typeof plainResult) =>
      r.flow.regularTaxCalc + r.flow.capitalGainsTax + r.flow.amtAdditional;
    expect(tentative(stressedResult)).toBeCloseTo(tentative(plainResult), 6);
  });

  it("leaves total federal tax IDENTICAL when AMT binds", () => {
    // max(regular, AMT). Regular rose; tentative AMT is frozen; AMT still binds.
    // This is the spec's damping taken to its limit — documented, not a bug.
    // Pre-fix this number is ~$6,000 higher.
    expect(stressedResult.flow.totalFederalTax)
      .toBeCloseTo(plainResult.flow.totalFederalTax, 6);
  });

  it("shrinks the AMT top-up rather than growing it", () => {
    // AMT = max(0, tentativeAMT - regularTax). Tentative AMT is frozen and
    // regular tax rose, so the top-up must fall. This is the damping the spec
    // describes: near the AMT crossover the stressor shows LESS than the full
    // dial. Documented behaviour, not a bug — this test is what keeps a future
    // reader from "fixing" it. Passes before AND after the fix; it documents
    // the damping, it is not the red.
    expect(stressedResult.flow.amtAdditional)            // 267,119 vs 279,653
      .toBeLessThan(plainResult.flow.amtAdditional);
  });
});
