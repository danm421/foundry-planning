/**
 * End-to-end projection integration for the equity-compensation feature.
 *
 * Drives the FULL `runProjection` over a ClientData carrying ONE
 * `stock_options` plan with two grants whose events all land inside the
 * projection window:
 *
 *   - RSU grant — vests 2027 (books W-2 / earned income that year) and is
 *     held-then-sold in 2030 (books a long-term capital gain).
 *   - ISO grant — exercises at-vest in 2028 (books the bargain element as an
 *     AMT preference, not regular ordinary income → nonzero AMT that year).
 *
 * Asserts the four equity tax/asset channels AND that net worth never
 * double-counts: the base stock_options account's portfolio contribution
 * (`portfolioAssets.stockOptions`) drains as shares move into the auto-created
 * destination taxable account (`portfolioAssets.taxable`) — the value is never
 * present in both buckets at once.
 *
 * Runs in BRACKET tax mode (taxEngineMode: "bracket" + a loaded
 * TaxYearParameters row) because AMT (`taxResult.flow.amtAdditional`) is only
 * computed by the bracket engine; the flat-rate path always returns 0.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  Account,
  ClientData,
  ClientInfo,
  Income,
  PlanSettings,
  FamilyMember,
} from "../types";
import type { StockOptionPlan } from "../equity/types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT } from "../ownership";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";

// ── Constants ──────────────────────────────────────────────────────────────

const PLAN_START = 2026;
const PRICE = 100; // FMV/share at planStartYear
const GROWTH = 0.1; // per-share appreciation: FMV(y) = 100 × 1.1^(y-2026)

const RSU_VEST_YEAR = 2027; // FMV = 110
const RSU_SELL_YEAR = 2030; // FMV = 146.41 → LTCG on 1,000 shares (held ≥2yr)
const ISO_EXERCISE_YEAR = 2028; // FMV = 121, strike 10 → $555k AMT preference

const RSU_SHARES = 1_000;
const ISO_SHARES = 5_000;
const ISO_STRIKE = 10;
const ISO_SELL_YEAR = 2031; // >2y from the 2025 grant and >1y from exercise → qualifying
/** Additional AMT in the exercise year when the shares are HELD, hand-derived
 *  from TAX_YEAR_2026 so a rate, exemption or phase-out regression cannot hide
 *  behind a "greater than zero" assertion:
 *
 *    taxable income  65,000 (80,000 salary − 15,000 standard deduction)
 *    AMTI            65,000 + 15,000 std add-back + 555,000 spread = 635,000
 *    phase-out       (635,000 − 618,700) × 50%  =  8,150  ← inside the ramp
 *    exemption       88,100 − 8,150             = 79,950
 *    taxable AMTI    635,000 − 79,950           = 555,050
 *    TMT             239,100 × 26% + 315,950 × 28% = 62,166 + 88,466 = 150,632
 *    regular tax     9,353
 *    additional AMT  150,632 − 9,353            = 141,279
 *
 *  The client sits INSIDE the exemption phase-out band, so this figure also
 *  pins the ramp end-to-end and not merely the 26/28 split. */
const AMT_ON_EXERCISE_AND_HOLD = 141_279;

const SO_ACCOUNT_ID = "so-equity";
const DEST_ID = `equity-dest-${SO_ACCOUNT_ID}`; // auto-created destination

const fmv = (year: number) => PRICE * (1 + GROWTH) ** (year - PLAN_START);

// ── Fixture scaffolding (single filer keeps the AMT math clean) ──────────────

const CLIENT: ClientInfo = {
  firstName: "Equity",
  lastName: "Holder",
  dateOfBirth: "1980-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "single",
};

const FM_CLIENT: FamilyMember = {
  id: LEGACY_FM_CLIENT,
  role: "client",
  relationship: "other",
  firstName: "Equity",
  lastName: "Holder",
  dateOfBirth: "1980-01-01",
};

const PLAN_SETTINGS: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0,
  planStartYear: PLAN_START,
  planEndYear: 2032,
  taxEngineMode: "bracket",
  taxInflationRate: 0,
};

const TAX_ROW: TaxYearParameters = TAX_YEAR_2026;

// Household default checking — equity cash (sale proceeds, strike outflow) routes here.
const CHECKING: Account = {
  id: "checking",
  name: "Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 250_000, // covers the ISO strike cash outflow (5,000 × $10 = $50k)
  basis: 250_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

// Base stock_options account — its portfolio value is the not-yet-acquired
// grant value (remainingGrantValue), recomputed each year by the engine.
const SO_ACCOUNT: Account = {
  id: SO_ACCOUNT_ID,
  name: "ACME Equity",
  category: "stock_options",
  subType: "stock_options",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: GROWTH,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

// Modest salary so the projection has ordinary cash flow; the RSU vest delta
// against the baseline is the load-bearing earned-income signal.
const SALARY: Income = {
  id: "inc-salary",
  type: "salary",
  name: "Salary",
  annualAmount: 80_000,
  startYear: PLAN_START,
  endYear: 2032,
  growthRate: 0,
  owner: "client",
};

const EQUITY_PLAN: StockOptionPlan = {
  accountId: SO_ACCOUNT_ID,
  ticker: "ACME",
  pricePerShare: PRICE,
  growthRate: GROWTH,
  destinationAccountId: null,
  autoCreateDestination: true,
  sellToCover: false,
  withholdingRate: 0,
  // Account-level default: hold. Each grant overrides with its own strategy.
  strategy: {
    exerciseTiming: "at_vest",
    exerciseYear: null,
    sellTiming: "hold",
    sellYear: null,
    sellPercentPerYear: null,
    sellStartYear: null,
  },
  owner: "client",
  grants: [
    // RSU: vests 2027 (ordinary income), held then sold 2030 (LTCG).
    {
      id: "g-rsu",
      grantNumber: "RSU-1",
      grantType: "rsu",
      grantDate: "2025-01-15",
      sharesGranted: RSU_SHARES,
      has83bElection: false,
      fmvAtGrant: null,
      strikePrice: null,
      strikeDiscountPct: null,
      expirationYear: null,
      strategy: { sellTiming: "hold_then_sell_year", sellYear: RSU_SELL_YEAR },
      tranches: [
        {
          id: "t-rsu",
          vestDate: `${RSU_VEST_YEAR}-01-15`,
          shares: RSU_SHARES,
          sharesExercised: 0,
          sharesSold: 0,
          acquiredOn: null,
          priceAtAcquisition: null,
          strategy: null,
        },
      ],
      plannedEvents: [],
    },
    // ISO: exercises at-vest 2028 (AMT preference), then holds.
    {
      id: "g-iso",
      grantNumber: "ISO-1",
      grantType: "iso",
      grantDate: "2025-01-15",
      sharesGranted: ISO_SHARES,
      has83bElection: false,
      fmvAtGrant: null,
      strikePrice: ISO_STRIKE,
      strikeDiscountPct: null,
      expirationYear: 2035,
      strategy: { exerciseTiming: "at_vest", sellTiming: "hold" },
      tranches: [
        {
          id: "t-iso",
          vestDate: `${ISO_EXERCISE_YEAR}-01-15`,
          shares: ISO_SHARES,
          sharesExercised: 0,
          sharesSold: 0,
          acquiredOn: null,
          priceAtAcquisition: null,
          strategy: null,
        },
      ],
      plannedEvents: [],
    },
  ],
};

function buildData(over?: Partial<ClientData>): ClientData {
  return {
    client: CLIENT,
    accounts: [CHECKING, SO_ACCOUNT],
    incomes: [SALARY],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: PLAN_SETTINGS,
    familyMembers: [FM_CLIENT],
    giftEvents: [],
    taxYearRows: [TAX_ROW],
    ...over,
  };
}

// ── The end-to-end test ──────────────────────────────────────────────────────

describe("equity compensation — end-to-end projection", () => {
  it("books RSU income, ISO AMT, sale cap-gain, and a destination balance with no net-worth double-count", () => {
    // Baseline run WITHOUT the equity plan — sharpens (a) and (e).
    const baseline = runProjection(buildData({ stockOptionPlans: [] }));
    const baseByYear = new Map(baseline.map((y) => [y.year, y]));

    const years = runProjection(buildData({ stockOptionPlans: [EQUITY_PLAN] }));
    const byYear = new Map(years.map((y) => [y.year, y]));

    const yVest = byYear.get(RSU_VEST_YEAR)!;
    const yExercise = byYear.get(ISO_EXERCISE_YEAR)!;
    const ySale = byYear.get(RSU_SELL_YEAR)!;
    expect(yVest).toBeDefined();
    expect(yExercise).toBeDefined();
    expect(ySale).toBeDefined();

    // ── (a) RSU vest year shows W-2 / earned income ─────────────────────────
    // The equity module routes RSU FMV-at-vest into taxDetail.earnedIncome.
    const expectedRsuIncome = RSU_SHARES * fmv(RSU_VEST_YEAR); // 1,000 × 110 = 110,000
    const baseVest = baseByYear.get(RSU_VEST_YEAR)!;
    const earnedDelta = yVest.taxDetail!.earnedIncome - baseVest.taxDetail!.earnedIncome;
    // Equity adds exactly the RSU FMV-at-vest on top of the salary baseline.
    expect(earnedDelta).toBeCloseTo(expectedRsuIncome, 2);
    expect(yVest.taxDetail!.earnedIncome).toBeGreaterThan(baseVest.taxDetail!.earnedIncome);

    // ── (b) ISO exercise year shows nonzero AMT ─────────────────────────────
    // ISO bargain element ($555k) flows into AMTI as a preference item, with no
    // regular ordinary income, so tentative AMT exceeds regular tax.
    const expectedIsoSpread = ISO_SHARES * (fmv(ISO_EXERCISE_YEAR) - ISO_STRIKE); // 5,000 × 111 = 555,000
    expect(expectedIsoSpread).toBeGreaterThan(0);
    expect(yExercise.taxResult).toBeDefined();
    // Pinned, not just "greater than zero". A bare positivity check survives a
    // wrong rate, a wrong exemption and a wrong phase-out alike — it only ever
    // proved the preference reached the tax layer at all.
    expect(yExercise.taxResult!.flow.amtAdditional).toBeCloseTo(AMT_ON_EXERCISE_AND_HOLD, 0);
    // The ISO exercise itself contributes NO regular earned income that year
    // (bargain element is AMT-only) — so earned income matches the baseline.
    expect(yExercise.taxDetail!.earnedIncome).toBeCloseTo(
      baseByYear.get(ISO_EXERCISE_YEAR)!.taxDetail!.earnedIncome,
      2,
    );

    // ── (c) sale year books a capital gain ──────────────────────────────────
    // 1,000 RSU shares held since 2027 → LTCG = proceeds − basis.
    const expectedGain = RSU_SHARES * (fmv(RSU_SELL_YEAR) - fmv(RSU_VEST_YEAR));
    // 1,000 × (146.41 − 110) = 36,410
    expect(ySale.taxDetail!.capitalGains).toBeGreaterThan(0);
    expect(ySale.taxDetail!.capitalGains).toBeCloseTo(expectedGain, 0);

    // ── (d) destination taxable account balance is nonzero after acquisition ─
    // After the ISO exercise (2028) both the RSU lot (held) and the ISO lot
    // (held) live in the auto-created destination taxable account.
    const destAfterExercise = yExercise.portfolioAssets.taxable[DEST_ID];
    expect(destAfterExercise).toBeGreaterThan(0);
    // Sanity: in the RSU vest year the destination already holds the RSU lot.
    expect(yVest.portfolioAssets.taxable[DEST_ID]).toBeGreaterThan(0);

    // ── (e) net worth has NO double-count ───────────────────────────────────
    // The base stock_options account contribution is the not-yet-acquired grant
    // value. It must STRICTLY DROP as shares vest/exercise into the destination,
    // and the same value must never appear in both buckets.

    // Year 2026 (pre-vest): all 6,000 shares are still unacquired. RSU at FMV,
    // ISO at intrinsic (FMV − strike). Destination is empty.
    //
    // Priced at the year-END share price — fmv(2027), not fmv(2026) — because
    // this is a BALANCE, and the growth loop above stamps every other account
    // grown through year-end. Pricing it at the year-start FMV made the shares
    // pick up a full year of growth the moment they moved into the destination
    // account (which the growth loop does grow), stepping net worth up with no
    // economic event.
    const y2026 = byYear.get(2026)!;
    const expectedUnacquired2026 =
      RSU_SHARES * fmv(2027) + ISO_SHARES * Math.max(0, fmv(2027) - ISO_STRIKE);
    expect(y2026.portfolioAssets.stockOptions[SO_ACCOUNT_ID]).toBeCloseTo(
      expectedUnacquired2026,
      0,
    );
    expect(y2026.portfolioAssets.taxable[DEST_ID] ?? 0).toBe(0);

    // The base stock_options contribution strictly drops as shares move out:
    // 2026 (all unacquired) > 2027 (RSU acquired) > 2028 (ISO acquired) = 0.
    const so2026 = y2026.portfolioAssets.stockOptions[SO_ACCOUNT_ID] ?? 0;
    const so2027 = yVest.portfolioAssets.stockOptions[SO_ACCOUNT_ID] ?? 0;
    const so2028 = yExercise.portfolioAssets.stockOptions[SO_ACCOUNT_ID] ?? 0;
    expect(so2027).toBeLessThan(so2026); // RSU moved out
    expect(so2028).toBeLessThan(so2027); // ISO moved out
    expect(so2028).toBeCloseTo(0, 6); // everything acquired → base is empty

    // No overlap: in every year, the base account value lives in the
    // stockOptions bucket and the destination value lives in the taxable
    // bucket — the same id never appears in both.
    for (const y of years) {
      expect(y.portfolioAssets.taxable[SO_ACCOUNT_ID]).toBeUndefined();
      expect(y.portfolioAssets.stockOptions[DEST_ID]).toBeUndefined();
    }

    // The aggregate proof: after both grants are acquired (2028), the equity
    // value lives in `taxable` (destination), NOT in `stockOptions` (base).
    // Total portfolio is not inflated by counting acquired shares twice — the
    // destination's appreciation over the baseline reflects real new wealth
    // (RSU income + ISO shares acquired by paying strike), not a double-count.
    expect(yExercise.portfolioAssets.stockOptionsTotal).toBeCloseTo(0, 6);
    expect(yExercise.portfolioAssets.taxable[DEST_ID]).toBeGreaterThan(0);
  });
});

describe("equity compensation — disqualifying ISO income is not payroll wages", () => {
  // IRC §3121(a)(22) excludes remuneration on a disposition of ISO stock from
  // FICA "wages". It stays fully taxable Form W-2 box 1 income, so it must show
  // up in the earned-income base and NOT in Social Security / Medicare.
  //
  // One ISO grant, exercised at vest in 2028 and sold the same year (cashless
  // exercise-and-sell). 5,000 shares, FMV 121, strike 10 → the whole $555,000
  // bargain element is a disqualifying disposition.
  const DISQUALIFYING_ISO: StockOptionPlan = {
    ...EQUITY_PLAN,
    grants: [
      {
        ...EQUITY_PLAN.grants[1], // the ISO grant
        strategy: { exerciseTiming: "at_vest", sellTiming: "immediately" },
      },
    ],
  };

  const baseline = runProjection(buildData({ stockOptionPlans: [] }));
  const withIso = runProjection(buildData({ stockOptionPlans: [DISQUALIFYING_ISO] }));
  const yBase = baseline.find((y) => y.year === ISO_EXERCISE_YEAR)!;
  const yIso = withIso.find((y) => y.year === ISO_EXERCISE_YEAR)!;

  const expectedOi = ISO_SHARES * (fmv(ISO_EXERCISE_YEAR) - ISO_STRIKE); // 555,000

  it("books the whole bargain element as earned income", () => {
    expect(yIso.taxDetail!.earnedIncome - yBase.taxDetail!.earnedIncome).toBeCloseTo(expectedOi, 2);
    expect(yIso.taxDetail!.ficaExemptEarnedIncome).toBeCloseTo(expectedOi, 2);
  });

  it("charges no payroll tax on it — FICA matches the no-equity baseline", () => {
    expect(yIso.taxResult!.flow.fica).toBeCloseTo(yBase.taxResult!.flow.fica, 2);
    expect(yIso.taxResult!.flow.additionalMedicare)
      .toBeCloseTo(yBase.taxResult!.flow.additionalMedicare, 2);
  });

  it("still taxes it as income — the bracket tax rises", () => {
    expect(yIso.taxResult!.flow.regularFederalIncomeTax)
      .toBeGreaterThan(yBase.taxResult!.flow.regularFederalIncomeTax);
  });
});

/** The no-equity control both blocks below measure against. One projection,
 *  shared — the two pre-existing describes each run their own. */
const NO_EQUITY = runProjection(buildData({ stockOptionPlans: [] }));

describe("equity compensation — a cashless exercise-and-sell owes NO alternative minimum tax", () => {
  // IRC §56(b)(3): where the disposition falls in the same tax year as the
  // exercise, the AMT amount equals the regular-tax amount and Form 6251 line 2i
  // is zero. The app used to book the bargain element BOTH as a preference (at
  // exercise) and as wages (at the sale), so the same $555,000 sat inside AMT
  // income twice and the plan charged six figures of tax that does not exist.
  //
  // This is the end-to-end proof: the whole projection, the real tax engine, and
  // the same fixture the audit measured the phantom charge on.
  const SAME_YEAR_SELL: StockOptionPlan = {
    ...EQUITY_PLAN,
    grants: [
      {
        ...EQUITY_PLAN.grants[1], // the ISO grant
        strategy: { exerciseTiming: "at_vest", sellTiming: "immediately" },
      },
    ],
  };

  const sameYear = runProjection(buildData({ stockOptionPlans: [SAME_YEAR_SELL] }));
  const yBase = NO_EQUITY.find((y) => y.year === ISO_EXERCISE_YEAR)!;
  const ySell = sameYear.find((y) => y.year === ISO_EXERCISE_YEAR)!;

  it("charges the same AMT as a plan with no equity at all — none", () => {
    expect(yBase.taxResult!.flow.amtAdditional).toBe(0); // non-vacuous: the baseline owes none
    expect(ySell.taxResult!.flow.amtAdditional).toBe(0);
  });

  it("still taxes the bargain element in full, as ordinary income", () => {
    const expectedOi = ISO_SHARES * (fmv(ISO_EXERCISE_YEAR) - ISO_STRIKE); // 555,000
    expect(ySell.taxDetail!.earnedIncome - yBase.taxDetail!.earnedIncome).toBeCloseTo(expectedOi, 2);
    expect(ySell.taxResult!.flow.regularFederalIncomeTax)
      .toBeGreaterThan(yBase.taxResult!.flow.regularFederalIncomeTax);
  });
});

describe("equity compensation — selling an exercised lot in a LATER year", () => {
  // No end-to-end fixture ever sold an option lot after exercising it: the plan
  // exercised in 2028 and held forever. That left the whole sale path — and in
  // particular the year-gating on the §56(b)(3) reversal — untested through the
  // real projection.
  //
  // Exercise at vest in 2028, sell in 2031: more than two years from the 2025
  // grant and more than one from the exercise, so the disposition QUALIFIES and
  // the entire gain over the strike is long-term.
  const EXERCISE_THEN_SELL: StockOptionPlan = {
    ...EQUITY_PLAN,
    grants: [
      {
        ...EQUITY_PLAN.grants[1], // the ISO grant
        strategy: { exerciseTiming: "at_vest", sellTiming: "hold_then_sell_year", sellYear: ISO_SELL_YEAR },
      },
    ],
  };
  const sold = runProjection(buildData({ stockOptionPlans: [EXERCISE_THEN_SELL] }));
  const at = (ys: ReturnType<typeof runProjection>, year: number) => ys.find((y) => y.year === year)!;

  it("charges the exercise-year AMT in full — a sale three years out changes nothing in 2028", () => {
    // The same literal the hold-forever plan is pinned to in the first describe:
    // scheduling a later sale must not move the exercise year by a dollar.
    expect(at(sold, ISO_EXERCISE_YEAR).taxResult!.flow.amtAdditional)
      .toBeCloseTo(AMT_ON_EXERCISE_AND_HOLD, 0);
  });

  it("books the sale as a long-term capital gain over the STRIKE basis", () => {
    // Qualifying disposition: no wages, and the basis is what the client paid to
    // exercise — the strike — not the price at exercise.
    const ySale = at(sold, ISO_SELL_YEAR);
    const baseSale = at(NO_EQUITY, ISO_SELL_YEAR);
    expect(ySale.taxDetail!.earnedIncome).toBeCloseTo(baseSale.taxDetail!.earnedIncome, 2);
    const expectedGain = ISO_SHARES * (fmv(ISO_SELL_YEAR) - ISO_STRIKE);
    expect(ySale.taxDetail!.capitalGains - baseSale.taxDetail!.capitalGains)
      .toBeCloseTo(expectedGain, 2);
  });

  it("does not claw back the 2028 preference in the sale year", () => {
    // ⚠️ The regression guard for the §56(b)(3) fix. Reversing the preference
    // whenever an ISO lot is sold — rather than only when the sale lands in the
    // exercise year — would push a NEGATIVE preference into 2031's AMT income
    // and hand the client a deduction the law does not give until the dual-basis
    // adjustment at sale exists (audit F3, deliberately not in this phase).
    const ySale = at(sold, ISO_SELL_YEAR);
    const baseSale = at(NO_EQUITY, ISO_SELL_YEAR);
    expect(ySale.taxResult!.flow.amtAdditional)
      .toBeGreaterThanOrEqual(baseSale.taxResult!.flow.amtAdditional);
    expect(ySale.taxResult!.flow.taxableIncome).toBeGreaterThan(baseSale.taxResult!.flow.taxableIncome);
  });
});
