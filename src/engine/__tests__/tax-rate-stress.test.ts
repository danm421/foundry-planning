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
import { basePlanSettings, buildClientData, FIXTURE_TAX_PARAMS, sampleAccounts } from "./fixtures";
import { runMonteCarlo } from "../monteCarlo/run";
import { createReturnEngine } from "../monteCarlo/returns";
import { resolveThresholdParams } from "@/lib/solver/threshold-params";
import { STATUTORY_MID_RATE, STATUTORY_TOP_RATE } from "@/lib/tax/constants";
import type { Account, ClientData, EntitySummary, ProjectionYear } from "../types";
import type { TaxYearParameters } from "@/lib/tax/types";
import type { TrustTaxBreakdown } from "../trust-tax/types";

const START = 2030;
const POINTS = 0.03;
const STRESS = { points: POINTS, startYear: START };

/** The shared engine fixture carries EMPTY trust schedules, which makes any
 *  trust assertion `[] === []`. This override gives the trust tests a real
 *  1041 schedule to bite on — four ordinary tiers (the count projection.ts's
 *  `trustIncomeBrackets.length >= 4` NIIT derivation needs) and three
 *  preferential tiers including the structural 0% band. */
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

/** The 1041 schedule's fourth tier, which projection.ts turns into the trust's
 *  NIIT floor. Read off the fixture rather than retyped, so a fixture edit
 *  cannot leave the assertions pinned to a number that is no longer there. */
const TRUST_NIIT_FLOOR = TRUST_ROWS[0].trustIncomeBrackets[3].from;

const TRUST_ID = "trust-nongrantor";

/** Irrevocable, non-grantor, not tax-exempt — the exact filter
 *  `buildNonGrantorTrusts` (projection.ts) applies before a plan gets a 1041
 *  pass at all. No distribution policy, so every dollar of trust income is
 *  RETAINED and lands in the trust's own NIIT base. */
const TRUST_ENTITY: EntitySummary = {
  id: TRUST_ID,
  includeInPortfolio: true,
  isGrantor: false,
  entityType: "trust",
  isIrrevocable: true,
  grantor: "client",
  distributionMode: null,
  distributionAmount: null,
  distributionPercent: null,
  incomeBeneficiaries: [],
};

/** Wholly trust-owned. The checking account is where the 1041 tax bill is
 *  debited; the brokerage is what generates the retained income. $1M at 6%
 *  with a 60% ordinary realization profile retains far more than the $16,300
 *  NIIT floor, so the NIIT line is non-zero and can actually move. */
const TRUST_ACCOUNTS: Account[] = [
  {
    id: "trust-checking",
    name: "Trust Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value: 100_000,
    basis: 100_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
    isDefaultChecking: true,
  },
  {
    id: "trust-brokerage",
    name: "Trust Brokerage",
    category: "taxable",
    subType: "brokerage",
    titlingType: "jtwros",
    value: 1_000_000,
    basis: 1_000_000,
    growthRate: 0.06,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
    realization: {
      pctOrdinaryIncome: 0.6,
      pctQualifiedDividends: 0.15,
      pctLtCapitalGains: 0.25,
      pctTaxExempt: 0,
      turnoverPct: 0,
    },
  },
];

/** The trust arm ONLY. The entity and its accounts are deliberately kept off
 *  `tree()` so the other eleven tests in this file keep running on the
 *  untouched shared fixture. */
function trustTree(overrides?: Partial<ClientData["planSettings"]>): ClientData {
  return {
    ...tree(overrides, TRUST_ROWS),
    accounts: [...sampleAccounts, ...TRUST_ACCOUNTS],
    entities: [TRUST_ENTITY],
  };
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

/** The 1041 pass's own answer for the trust. Throws rather than returning
 *  undefined: a missing entry means `if (nonGrantorTrusts.length > 0)` never
 *  opened, and every assertion below it would silently pass on
 *  `undefined === undefined`. */
function trustBreakdown(p: ProjectionYear[], year: number): TrustTaxBreakdown {
  const b = yearOf(p, year).trustTaxByEntity?.get(TRUST_ID);
  if (!b) throw new Error(`no trust tax for ${TRUST_ID} in ${year} — the 1041 pass never ran`);
  return b;
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

  it("raises every ordinary rate the engine used by exactly the dial — ALL four filing statuses", () => {
    // rate-stress.ts loops all four; the household here is married_joint, so
    // the other three would never have been checked by an assertion that read
    // only the status in play. A transform that fell out of its loop early
    // would leave a single or head-of-household plan silently unstressed.
    const usedParams = bracketsAt(stressed, START);
    const baseParams = bracketsAt(plain, START);
    for (const fs of ["married_joint", "single", "head_of_household", "married_separate"] as const) {
      const used = usedParams.incomeBrackets[fs];
      const base = baseParams.incomeBrackets[fs];
      expect(used.length).toBeGreaterThan(0);
      expect(used.length).toBe(base.length);
      used.forEach((tier, i) => {
        expect(tier.rate).toBeCloseTo(base[i].rate + POINTS, 10);
      });
    }
  });

  it("keeps stressing years far past the last seeded row — the dial has no end year", () => {
    // "raises federal tax from the start year forward" stops at 2037 because the
    // household owes no federal tax after that, which makes a TAX comparison
    // useless — but the RATES still resolve.
    // Without this, a transform that quietly stopped applying (an end year, an
    // inflation-horizon cutoff) would go unnoticed beyond 2037.
    const late = bracketsAt(stressed, 2040).incomeBrackets.married_joint;
    const lateBase = bracketsAt(plain, 2040).incomeBrackets.married_joint;
    expect(late.length).toBeGreaterThan(0);
    late.forEach((tier, i) => {
      expect(tier.rate).toBeCloseTo(lateBase[i].rate + POINTS, 10);
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
  // schedules are empty, which would make every assertion here `[] === []`.
  // And on `trustTree`, not `tree`: projection.ts guards the whole 1041 pass —
  // including the `trustIncomeBrackets[3].from` NIIT derivation — behind
  // `if (nonGrantorTrusts.length > 0)`, and the shared fixture supplies no
  // entities at all, so without one the derivation never runs.
  const trustStressed = runProjection(trustTree({ taxRateStress: STRESS }));
  const trustPlain = runProjection(trustTree());

  it("does not move the trust NIIT threshold", () => {
    const used = bracketsAt(trustStressed, START);
    const before = bracketsAt(trustStressed, START - 1);
    const base = bracketsAt(trustPlain, START);

    // Vacuity guard: projection.ts derives the trust NIIT floor from
    // trustIncomeBrackets[3].from and falls back to niitThreshold.single below
    // four tiers, so an empty/short schedule proves nothing. (The test below
    // asserts on the floor the trust pass actually charged.)
    expect(used.trustIncomeBrackets.length).toBeGreaterThanOrEqual(4);

    // ⚠️ This YEAR-OVER-YEAR arm holds only because resolver.ts passes trust
    // brackets through UNINFLATED, under a pre-existing `TODO(Task 4/5)`. When
    // trust inflation lands this will red for a CORRECT reason — the fix then
    // is to DELETE this arm, not to loosen it. The same-year arm below already
    // covers the property this test is actually about.
    expect(used.trustIncomeBrackets.map((t) => t.from))
      .toEqual(before.trustIncomeBrackets.map((t) => t.from));
    expect(used.trustIncomeBrackets.map((t) => t.from))
      .toEqual(base.trustIncomeBrackets.map((t) => t.from));
    expect(used.trustCapGainsBrackets.map((t) => [t.from, t.to]))
      .toEqual(base.trustCapGainsBrackets.map((t) => [t.from, t.to]));

    // The derived figure itself — the 37% floor.
    expect(used.trustIncomeBrackets[3].from).toBe(TRUST_NIIT_FLOOR);
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

  it("charges the trust's NIIT off an unmoved 37% floor, while its ordinary tax rises", () => {
    // The two tests above read the PARAMS. This one reads what the 1041 pass
    // actually did with them: projection.ts turns `trustIncomeBrackets[3].from`
    // into the trust's NIIT floor, and compute-trust-tax.ts charges
    // `niitRate x max(0, retained ordinary + dividends + gains - floor)`.
    // Reachable only because `trustTree` supplies a real non-grantor trust —
    // the whole derivation sits inside `if (nonGrantorTrusts.length > 0)`.
    const used = trustBreakdown(trustStressed, START);
    const base = trustBreakdown(trustPlain, START);

    // Vacuity guards. `trustBreakdown` already throws on a missing entry; these
    // stop the comparisons below from passing on 0 === 0.
    expect(base.niit).toBeGreaterThan(0);
    expect(used.niit).toBeGreaterThan(0);

    // Read the floor the pass actually charged back out of the NIIT line, and
    // pin it to the schedule's fourth tier. A transform that nudged `from`
    // would land here even though every rate assertion stayed green.
    // Each arm divides by ITS OWN niitRate. The stressor cannot reach niitRate
    // today, so one shared rate happened to be correct — but it coupled a
    // plain-arm assertion to the stressed resolution for no reason.
    const usedRate = bracketsAt(trustStressed, START).niitRate;
    const baseRate = bracketsAt(trustPlain, START).niitRate;
    expect(usedRate).toBeGreaterThan(0);
    expect(baseRate).toBeGreaterThan(0);
    const floorCharged = (b: TrustTaxBreakdown, niitRate: number) =>
      b.retainedOrdinary + b.retainedDividends + b.recognizedCapGains - b.niit / niitRate;
    expect(floorCharged(used, usedRate)).toBeCloseTo(TRUST_NIIT_FLOOR, 6);
    expect(floorCharged(base, baseRate)).toBeCloseTo(TRUST_NIIT_FLOOR, 6);

    // Same NIIT base on both sides — START is the FIRST stressed year, so the
    // trust's income for it comes off unstressed balances. (By 2031 the extra
    // 2030 tax has drained trust cash and the bases genuinely diverge.)
    const niitBase = (b: TrustTaxBreakdown) =>
      b.retainedOrdinary + b.retainedDividends + b.recognizedCapGains;
    expect(niitBase(used)).toBeCloseTo(niitBase(base), 6);

    // Same base, same floor, and NIIT is not a bracket rate => identical NIIT.
    expect(used.niit).toBeCloseTo(base.niit, 6);

    // ...while the trust's ORDINARY 1041 tax, which IS bracket-rated, rises.
    expect(base.federalOrdinaryTax).toBeGreaterThan(0);
    expect(used.federalOrdinaryTax).toBeGreaterThan(base.federalOrdinaryTax);
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

    // The stressed arm above compares cap-gains fields too; without the same
    // here, a drift in the UNSTRESSED preferential thresholds (the panel and
    // the engine inflating on different rates, say) would go uncaught.
    const panelCg = panel.capGainsBrackets.married_joint;
    const engineCg = engine.capGainsBrackets.married_joint;
    expect(panelCg.zeroPctTop).toBe(engineCg.zeroPctTop);
    expect(panelCg.fifteenPctTop).toBe(engineCg.fifteenPctTop);
    expect(panelCg.midRate).toBeUndefined();     // both sides statutory-fallback
    expect(engineCg.midRate).toBeUndefined();
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

describe("a fill-up-bracket Roth conversion survives the stressor", () => {
  // The defect this pins is invisible to a grep: projection.ts and
  // roth-conversions.ts identify the bracket a conversion targets by matching
  // `fillUpBracket` against the tier's RATE, and this stressor is the first
  // thing in the app that ever moves a rate. Both sites bail silently on a
  // miss — `continue` and `return 0` — so the conversion just stops happening.
  //
  // The right answer is that NOTHING about the conversion changes: `bumpTiers`
  // copies `from`/`to` verbatim, so the bracket's dollar ceiling is identical
  // stressed or not. Only the tax charged on those dollars rises. That makes
  // "stressed converts the same taxable amount as plain" the assertion.
  //
  // Target 0.12, not 0.22: FIXTURE_TAX_PARAMS' married_joint schedule is
  // [0.10, 0.12, 0.22] and the 0.22 tier is the TOP one, with `to: null` —
  // both call sites also bail on `tier.to == null`, so a 0.22 fixture would
  // convert nothing in EITHER arm and the test would pass while proving
  // nothing.
  // 2039, not START: both salaries have ended by 2038, so this is the first
  // year the household has real headroom under the 12% ceiling. At START the
  // plain arm converts $0 — the vacuity guard below caught exactly that, and a
  // test written at START would have compared 0 to 0 in every arm.
  const CONV_ID = "conv-fill";
  const CONV_YEAR = 2039;

  function fillTree(overrides?: Partial<ClientData["planSettings"]>): ClientData {
    const base = tree(overrides);
    return {
      ...base,
      rothConversions: [{
        id: CONV_ID,
        name: "Fill the 12% bracket",
        destinationAccountId: "acct-roth",
        sourceAccountIds: ["acct-401k"],
        conversionType: "fill_up_bracket",
        fillUpBracket: 0.12,
        fixedAmount: 0,
        startYear: CONV_YEAR,
        endYear: CONV_YEAR,
        indexingRate: 0,
      }],
    };
  }

  /** The taxable dollars the projection actually converted that year. Returns
   *  0 when the conversion never ran — which is exactly the defect's signature,
   *  so it must be a number, not undefined. */
  function convertedAt(p: ProjectionYear[], year: number): number {
    return yearOf(p, year).rothConversions?.find((c) => c.id === CONV_ID)?.taxable ?? 0;
  }

  const fillPlain = runProjection(fillTree());

  it("converts something at all without a stressor (guards both tests below)", () => {
    // Without this, a fixture whose income already overflows the 12% bracket
    // would make every assertion below 0 === 0.
    expect(convertedAt(fillPlain, CONV_YEAR)).toBeGreaterThan(0);
  });

  it("converts the same dollars when the dial moves a rate off the schedule", () => {
    // +3 points: the schedule becomes [0.13, 0.15, 0.25] and NOTHING equals
    // 0.12 any more. Pre-fix the `find` misses, the conversion is skipped
    // entirely, and this reads 0.
    const fillStressed = runProjection(fillTree({ taxRateStress: { points: 0.03, startYear: START } }));
    expect(convertedAt(fillStressed, CONV_YEAR)).toBeCloseTo(convertedAt(fillPlain, CONV_YEAR), 6);
  });

  it("does not retarget onto a different bracket when the dial equals a bracket gap", () => {
    // The nastier half. 0.10 -> 0.12 is a gap of exactly 0.02, so +2 points
    // makes the EX-10% tier carry rate 0.12 and the `find` matches it. Pre-fix
    // the conversion fills the 24,800 ceiling instead of the 100,800 one and
    // returns a smaller, entirely plausible number — no error, no warning.
    const fillStressed = runProjection(fillTree({ taxRateStress: { points: 0.02, startYear: START } }));
    expect(convertedAt(fillStressed, CONV_YEAR)).toBeCloseTo(convertedAt(fillPlain, CONV_YEAR), 6);
  });
});
