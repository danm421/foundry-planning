import { describe, it, expect } from "vitest";
import { deriveEffectiveLtcgRate } from "@/lib/investments/rebalance/tax-estimate";
import { calcCapGainsTax } from "../capGains";
import { calculateTaxYear } from "../calculate";
import { applyTaxRateStress } from "../rate-stress";
import type { CalcInput, CapGainsTier, TaxYearParameters } from "../types";
import { params2026 } from "./fixtures";

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

  it("falls back per FIELD, not per tier, when only one rate is overridden", () => {
    // Unreachable through the stressor today — `bumpCapGainsTier` always writes
    // both — but `midRate ?? STATUTORY` / `topRate ?? STATUTORY` is a per-field
    // claim, and nothing else tests it. A future partial override (a seeded row,
    // a narrower stressor) would land here first.
    const midOnly: CapGainsTier = { ...PLAIN, midRate: 0.18 };
    expect(calcCapGainsTax(50_000, 100_000, midOnly)).toBeCloseTo(9_000, 6);   // override used
    expect(calcCapGainsTax(100_000, 600_000, midOnly)).toBeCloseTo(20_000, 6); // statutory 20%
  });
});

describe("deriveEffectiveLtcgRate falls back to the statutory rate", () => {
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

  it("has an AMT-bound baseline on BOTH arms (guards every test below)", () => {
    expect(plainResult.flow.amtAdditional).toBeGreaterThan(0);    // ~279,653
    // The stressed arm too: if raising regular rates pushed it OFF AMT, the
    // "identical total" test below would fail with a misleading message about
    // the stressor reaching AMT, when the real cause was the crossover moving.
    expect(stressedResult.flow.amtAdditional).toBeGreaterThan(0); // ~267,119
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
