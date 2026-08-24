// End-to-end proof for the "tax rates rise" stressor.
//
// Tasks 1-3 pin the transform, the preferential-rate lookup and the resolver in
// isolation. This file asks the only question those cannot: does a plan setting
// actually reach a projection's tax numbers, does the solver's Thresholds panel
// see the same brackets the engine used, and did anything that must NOT move
// (thresholds, flat mode, the trust NIIT floor) move anyway.
//
// START is 2030 on purpose. FIXTURE_TAX_PARAMS holds a SINGLE 2026 row, so 2030
// is resolved through `inflateParams` — the path that rebuilds capGainsBrackets
// field-by-field and would silently drop the stressor's preferential rates if
// the resolver ever stressed before inflating instead of after.
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData, FIXTURE_TAX_PARAMS } from "./fixtures";
import { runMonteCarlo } from "../monteCarlo/run";
import { createReturnEngine } from "../monteCarlo/returns";
import { resolveThresholdParams } from "@/lib/solver/threshold-params";
import { STATUTORY_MID_RATE, STATUTORY_TOP_RATE } from "@/lib/tax/rate-stress";
import type { ClientData, ProjectionYear } from "../types";
import type { TaxYearParameters } from "@/lib/tax/types";

const START = 2030;
const POINTS = 0.03;
const STRESS = { points: POINTS, startYear: START };

/** The shared engine fixture carries EMPTY trust schedules, which makes any
 *  trust assertion `[] === []`. This override gives the trust tests a real
 *  1041 schedule to bite on — four ordinary tiers (so projection.ts's
 *  `trustIncomeBrackets.length >= 4` NIIT derivation is actually reached) and
 *  three preferential tiers including the structural 0% band. */
const TRUST_ROWS: TaxYearParameters[] = [{
  ...FIXTURE_TAX_PARAMS[0],
  trustIncomeBrackets: [
    { from: 0, to: 3300, rate: 0.10 },
    { from: 3300, to: 12000, rate: 0.24 },
    { from: 12000, to: 16300, rate: 0.35 },
    { from: 16300, to: null, rate: 0.37 },
  ],
  trustCapGainsBrackets: [
    { from: 0, to: 3350, rate: 0 },
    { from: 3350, to: 16300, rate: 0.15 },
    { from: 16300, to: null, rate: 0.20 },
  ],
}];

function tree(
  overrides?: Partial<ClientData["planSettings"]>,
  rows: TaxYearParameters[] = FIXTURE_TAX_PARAMS,
): ClientData {
  return buildClientData({
    taxYearRows: rows,
    planSettings: {
      ...basePlanSettings,
      taxEngineMode: "bracket",
      planStartYear: 2026,
      planEndYear: 2040,
      ...overrides,
    },
  });
}

// runProjection returns ProjectionYear[] DIRECTLY — not an object with a
// `.years` property.
function yearOf(p: ProjectionYear[], year: number): ProjectionYear {
  const y = p.find((r) => r.year === year);
  if (!y) throw new Error(`no projection year ${year}`);
  return y;
}

/** The resolved TaxYearParameters the engine actually taxed that year with. */
function bracketsAt(p: ProjectionYear[], year: number): TaxYearParameters {
  return yearOf(p, year).taxResult!.diag.bracketsUsed;
}

function fedTaxAt(p: ProjectionYear[], year: number): number {
  return yearOf(p, year).taxResult!.flow.totalFederalTax;
}

const plain = runProjection(tree());
const stressed = runProjection(tree({ taxRateStress: STRESS }));

describe("tax rates rise — through runProjection", () => {
  it("has a non-zero federal tax to move (guards every test below from vacuity)", () => {
    expect(yearOf(plain, START).taxResult!.flow.regularFederalIncomeTax).toBeGreaterThan(0);
  });

  it("leaves years before the start year identical", () => {
    for (const year of [2026, 2028, START - 1]) {
      // Without this the assertion below would pass on 0 === 0.
      expect(fedTaxAt(plain, year)).toBeGreaterThan(0);
      expect(fedTaxAt(stressed, year)).toBeCloseTo(fedTaxAt(plain, year), 6);
    }
  });

  it("raises federal tax from the start year forward", () => {
    // Stops at 2037: both salaries have ended by 2038 and the household owes no
    // federal tax at all after that, so later years cannot discriminate.
    for (const year of [START, START + 1, 2035, 2037]) {
      expect(fedTaxAt(plain, year)).toBeGreaterThan(0);
      expect(fedTaxAt(stressed, year)).toBeGreaterThan(fedTaxAt(plain, year));
    }
  });

  it("raises every ordinary rate the engine used by exactly the dial", () => {
    const used = bracketsAt(stressed, START).incomeBrackets.married_joint;
    const base = bracketsAt(plain, START).incomeBrackets.married_joint;
    expect(used.length).toBeGreaterThan(0);
    expect(used.length).toBe(base.length);
    used.forEach((tier, i) => {
      expect(tier.rate).toBeCloseTo(base[i].rate + POINTS, 10);
    });
  });

  it("leaves the rates the engine used BEFORE the start year untouched", () => {
    expect(bracketsAt(stressed, START - 1).incomeBrackets.married_joint.map((t) => t.rate))
      .toEqual(bracketsAt(plain, START - 1).incomeBrackets.married_joint.map((t) => t.rate));
  });

  it("raises the PREFERENTIAL rates the engine used, on an inflated year", () => {
    // The half a regression hides in. `inflateParams` rebuilds capGainsBrackets
    // emitting only zeroPctTop/fifteenPctTop, so a resolver that stressed before
    // inflating would leave these undefined — and the ordinary-rate tests above
    // would still be green.
    const used = bracketsAt(stressed, START).capGainsBrackets.married_joint;
    const base = bracketsAt(plain, START).capGainsBrackets.married_joint;
    expect(base.midRate).toBeUndefined();   // unstressed = statutory fallback
    expect(base.topRate).toBeUndefined();
    expect(used.midRate).toBeCloseTo(STATUTORY_MID_RATE + POINTS, 10);
    expect(used.topRate).toBeCloseTo(STATUTORY_TOP_RATE + POINTS, 10);
  });

  it("does not move any ordinary bracket threshold", () => {
    // Same year, stressed vs plain. NOT year-over-year: `inflateParams` moves
    // every threshold with inflation each year, so a year-over-year comparison
    // would fail for a reason that has nothing to do with the stressor.
    const used = bracketsAt(stressed, START).incomeBrackets.married_joint;
    const base = bracketsAt(plain, START).incomeBrackets.married_joint;
    expect(used.map((t) => [t.from, t.to])).toEqual(base.map((t) => [t.from, t.to]));

    const usedCg = bracketsAt(stressed, START).capGainsBrackets.married_joint;
    const baseCg = bracketsAt(plain, START).capGainsBrackets.married_joint;
    expect(usedCg.zeroPctTop).toBe(baseCg.zeroPctTop);
    expect(usedCg.fifteenPctTop).toBe(baseCg.fifteenPctTop);
  });

  it("is inert in flat tax mode", () => {
    const flat = runProjection(tree({ taxEngineMode: "flat", taxRateStress: STRESS }));
    const flatPlain = runProjection(tree({ taxEngineMode: "flat" }));
    expect(fedTaxAt(flatPlain, START)).toBeGreaterThan(0);
    expect(fedTaxAt(flat, START)).toBeCloseTo(fedTaxAt(flatPlain, START), 6);
  });
});

describe("the trust schedule rises without its thresholds moving", () => {
  // Runs on TRUST_ROWS, not the shared fixture: the shared fixture's trust
  // schedules are empty, which would make every assertion here `[] === []` AND
  // would keep projection.ts's `trustIncomeBrackets[3].from` NIIT derivation
  // from running at all.
  const trustStressed = runProjection(tree({ taxRateStress: STRESS }, TRUST_ROWS));
  const trustPlain = runProjection(tree(undefined, TRUST_ROWS));

  it("does not move the trust NIIT threshold", () => {
    const used = bracketsAt(trustStressed, START);
    const before = bracketsAt(trustStressed, START - 1);
    const base = bracketsAt(trustPlain, START);

    // Vacuity guard: projection.ts derives the trust NIIT floor from
    // trustIncomeBrackets[3].from and falls back to niitThreshold.single below
    // four tiers, so an empty/short schedule proves nothing.
    expect(used.trustIncomeBrackets.length).toBeGreaterThanOrEqual(4);

    expect(used.trustIncomeBrackets.map((t) => t.from))
      .toEqual(before.trustIncomeBrackets.map((t) => t.from));
    expect(used.trustIncomeBrackets.map((t) => t.from))
      .toEqual(base.trustIncomeBrackets.map((t) => t.from));
    expect(used.trustCapGainsBrackets.map((t) => [t.from, t.to]))
      .toEqual(base.trustCapGainsBrackets.map((t) => [t.from, t.to]));

    // The derived figure itself — the 37% floor.
    expect(used.trustIncomeBrackets[3].from).toBe(16300);
  });

  it("raises the trust rates, leaving the structural 0% band at zero", () => {
    // Without this the threshold test above would pass on a schedule the
    // stressor never touched.
    const used = bracketsAt(trustStressed, START);
    const base = bracketsAt(trustPlain, START);

    expect(used.trustIncomeBrackets.length).toBeGreaterThanOrEqual(4);
    used.trustIncomeBrackets.forEach((tier, i) => {
      expect(tier.rate).toBeCloseTo(base.trustIncomeBrackets[i].rate + POINTS, 10);
    });

    const cg = used.trustCapGainsBrackets;
    expect(cg.length).toBe(3);
    expect(cg[0].rate).toBe(0);   // "no tax at the bottom" is structural, not a rate
    expect(cg[1].rate).toBeCloseTo(0.15 + POINTS, 10);
    expect(cg[2].rate).toBeCloseTo(0.20 + POINTS, 10);
  });
});

describe("the Thresholds panel and the engine cannot drift", () => {
  // THE point of buildTaxResolver. Fails if only one of the two call sites was
  // wired — which is exactly what a hand-wrapped resolver invites.
  it("resolves the same brackets the engine used, stressed", () => {
    const panel = resolveThresholdParams(tree({ taxRateStress: STRESS }), START)!;
    const engine = bracketsAt(stressed, START);
    expect(panel.incomeBrackets.married_joint.map((t) => t.rate))
      .toEqual(engine.incomeBrackets.married_joint.map((t) => t.rate));

    // Ordinary rates alone are not enough: on an inflated year the preferential
    // rates are `undefined` on BOTH sides unless the stressor reached them, and
    // undefined compares equal to undefined. Pin that they are present and
    // raised first, then compare panel to engine.
    const panelCg = panel.capGainsBrackets.married_joint;
    const engineCg = engine.capGainsBrackets.married_joint;
    expect(panelCg.midRate).toBeCloseTo(STATUTORY_MID_RATE + POINTS, 10);
    expect(panelCg.topRate).toBeCloseTo(STATUTORY_TOP_RATE + POINTS, 10);
    expect(panelCg.midRate).toBeCloseTo(engineCg.midRate!, 10);
    expect(panelCg.topRate).toBeCloseTo(engineCg.topRate!, 10);
  });

  it("resolves the same brackets the engine used, unstressed", () => {
    const panel = resolveThresholdParams(tree(), START)!;
    const engine = bracketsAt(plain, START);
    expect(panel.incomeBrackets.married_joint.map((t) => t.rate))
      .toEqual(engine.incomeBrackets.married_joint.map((t) => t.rate));
    expect(panel.incomeBrackets.married_joint.map((t) => [t.from, t.to]))
      .toEqual(engine.incomeBrackets.married_joint.map((t) => [t.from, t.to]));
  });
});

describe("Monte Carlo trials see the stressor", () => {
  // Trials re-run runProjection, so the resolver change reaches them with no
  // MC-specific wiring. An EMPTY return engine makes every trial reproduce the
  // deterministic projection, so this is an exact comparison rather than a
  // statistical one — no seed sensitivity, no flake.
  const emptyEngine = () => createReturnEngine({ indices: [], correlation: [], seed: 42 });
  const liquidEnding = (years: ProjectionYear[]): number => {
    const last = years[years.length - 1].portfolioAssets;
    return last.taxableTotal + last.cashTotal + last.retirementTotal;
  };

  it("lowers ending liquid assets when the stressor is on", async () => {
    const plainMc = await runMonteCarlo({
      data: tree(),
      returnEngine: emptyEngine(),
      accountMixes: new Map(),
      trials: 3,
      requiredMinimumAssetLevel: 0,
    });
    const stressedMc = await runMonteCarlo({
      data: tree({ taxRateStress: STRESS }),
      returnEngine: emptyEngine(),
      accountMixes: new Map(),
      trials: 3,
      requiredMinimumAssetLevel: 0,
    });
    expect(plainMc.endingLiquidAssets[0]).toBeGreaterThan(0);   // vacuity guard
    expect(stressedMc.endingLiquidAssets[0])
      .toBeLessThan(plainMc.endingLiquidAssets[0]);

    // …and the trials landed on the STRESSED deterministic answer, not merely
    // on some lower number. If the trial path dropped taxRateStress this would
    // equal the plain projection instead.
    expect(stressedMc.endingLiquidAssets[0]).toBeCloseTo(liquidEnding(stressed), 6);
    expect(plainMc.endingLiquidAssets[0]).toBeCloseTo(liquidEnding(plain), 6);
  });
});
