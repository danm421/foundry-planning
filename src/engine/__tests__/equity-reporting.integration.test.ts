/**
 * Integration coverage for the equity-compensation REPORTING surfaces.
 *
 * Drives the full `runProjection` over a ClientData carrying ONE RSU
 * `stock_options` plan whose four tranches vest 2027–2030 and are held
 * then sold in 2033. This file grows across the equity-reporting plan
 * (Tasks 1–8); Task 1 establishes the shared fixture and a regression guard
 * proving the per-plan equity-capture refactor preserves the scalar
 * `taxDetail.earnedIncome` channel.
 *
 * Runs in BRACKET tax mode (taxEngineMode: "bracket" + a loaded
 * TaxYearParameters row) to match the production tax path.
 *
 * Fixture note: unlike `equity-e2e.integration.test.ts`, this fixture carries
 * NO salary income, so the RSU vest FMV is the SOLE earned-income signal each
 * year — letting the regression guard assert `earnedIncome` exactly rather
 * than via a baseline delta.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  Account,
  ClientData,
  ClientInfo,
  PlanSettings,
  FamilyMember,
} from "../types";
import type { StockOptionPlan } from "../equity/types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT } from "../ownership";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";

// ── Constants ──────────────────────────────────────────────────────────────

const PLAN_START = 2026;
const PRICE = 420; // FMV/share at planStartYear
const GROWTH = 0.07; // per-share appreciation: FMV(y) = 420 × 1.07^(y-2026)

const SHARES_PER_TRANCHE = 25;
const RSU_SELL_YEAR = 2033;

const SO_ACCOUNT_ID = "so-equity";

/** FMV per share in `year`. */
const f = (y: number) => PRICE * (1 + GROWTH) ** (y - PLAN_START);

// Exported for bySource key assertions in later tasks (per-plan keys are
// derived from the base stock_options account id).
export const SO_PLAN_ACCOUNT_ID = SO_ACCOUNT_ID;

// ── Fixture scaffolding (single filer keeps the tax math clean) ──────────────

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
  planEndYear: 2035,
  taxEngineMode: "bracket",
  taxInflationRate: 0,
};

const TAX_ROW: TaxYearParameters = TAX_YEAR_2026;

// Household default checking — equity cash (sale proceeds, sell-to-cover
// withholding) routes here.
const CHECKING: Account = {
  id: "checking",
  name: "Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 250_000,
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

// Single RSU plan: 4 tranches vesting 2027–2030 (25 shares each → 100 total),
// held then sold in 2033. Sell-to-cover with 22% withholding at vest.
const EQUITY_PLAN: StockOptionPlan = {
  accountId: SO_ACCOUNT_ID,
  ticker: "ACME",
  pricePerShare: PRICE,
  growthRate: GROWTH,
  destinationAccountId: null,
  autoCreateDestination: true,
  sellToCover: true,
  withholdingRate: 0.22,
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
    {
      id: "g-rsu",
      grantNumber: "RSU-1",
      grantType: "rsu",
      grantYear: 2025,
      sharesGranted: SHARES_PER_TRANCHE * 4,
      has83bElection: false,
      fmvAtGrant: null,
      strikePrice: null,
      strikeDiscountPct: null,
      expirationYear: null,
      strategy: { sellTiming: "hold_then_sell_year", sellYear: RSU_SELL_YEAR },
      tranches: [2027, 2028, 2029, 2030].map((vestYear) => ({
        id: `t-rsu-${vestYear}`,
        vestYear,
        shares: SHARES_PER_TRANCHE,
        sharesExercised: 0,
        sharesSold: 0,
        strategy: null,
      })),
      plannedEvents: [],
    },
  ],
};

function buildData(over?: Partial<ClientData>): ClientData {
  return {
    client: CLIENT,
    accounts: [CHECKING, SO_ACCOUNT],
    incomes: [],
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("equity compensation — reporting surfaces", () => {
  it("per-plan equity capture: vest year ordinaryIncome equals sum of tranche FMV", () => {
    const years = runProjection(buildData({ stockOptionPlans: [EQUITY_PLAN] }));
    const byYear = new Map(years.map((y) => [y.year, y]));
    // 2027 vest = 25 shares * FMV(2027)
    const expected = SHARES_PER_TRANCHE * f(2027);
    // earnedIncome scalar still correct (regression guard for the refactor)
    expect(byYear.get(2027)!.taxDetail!.earnedIncome).toBeCloseTo(expected, 0);
  });

  it("flat mode: equity vest income is included in taxes (no longer undertaxed)", () => {
    const flat = (over?: Partial<ClientData>) =>
      buildData({
        ...over,
        planSettings: { ...PLAN_SETTINGS, taxEngineMode: "flat" },
      });
    const base = runProjection(flat({ stockOptionPlans: [] }));
    const withEq = runProjection(flat({ stockOptionPlans: [EQUITY_PLAN] }));
    const tax = (ys: typeof base) =>
      ys.find((y) => y.year === 2027)!.taxResult!.flow.totalTax;
    // Flat mode previously ignored equity; tax in the vest year must now rise.
    expect(tax(withEq)).toBeGreaterThan(tax(base));
  });

  it("writes itemized equity bySource entries on the tax detail", () => {
    const byYear = new Map(runProjection(buildData({ stockOptionPlans: [EQUITY_PLAN] })).map((y) => [y.year, y]));
    const vest = byYear.get(2027)!.taxDetail!.bySource[`equity-vest:${SO_PLAN_ACCOUNT_ID}`];
    expect(vest).toMatchObject({ type: "earned_income" });
    expect(vest.amount).toBeGreaterThan(0);
    const sale = byYear.get(2033)!.taxDetail!.bySource[`equity-ltcg:${SO_PLAN_ACCOUNT_ID}`];
    expect(sale).toMatchObject({ type: "capital_gains" });
    expect(sale.amount).toBeGreaterThan(0);
  });

  it("equity bySource sums equal the scalar taxDetail buckets", () => {
    const y = runProjection(buildData({ stockOptionPlans: [EQUITY_PLAN] })).find((x) => x.year === 2027)!;
    const vestSum = Object.entries(y.taxDetail!.bySource)
      .filter(([k]) => k.startsWith("equity-vest:"))
      .reduce((s, [, v]) => s + v.amount, 0);
    expect(vestSum).toBeCloseTo(y.taxDetail!.earnedIncome, 2);
  });
});
