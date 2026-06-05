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
      grantYear: 2025,
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
          vestYear: RSU_VEST_YEAR,
          shares: RSU_SHARES,
          sharesExercised: 0,
          sharesSold: 0,
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
      grantYear: 2025,
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
          vestYear: ISO_EXERCISE_YEAR,
          shares: ISO_SHARES,
          sharesExercised: 0,
          sharesSold: 0,
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
    expect(yExercise.taxResult!.flow.amtAdditional).toBeGreaterThan(0);
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
    const y2026 = byYear.get(2026)!;
    const expectedUnacquired2026 =
      RSU_SHARES * fmv(2026) + ISO_SHARES * Math.max(0, fmv(2026) - ISO_STRIKE);
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
