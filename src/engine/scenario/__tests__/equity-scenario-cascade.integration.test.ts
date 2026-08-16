/**
 * G5 / F15 — "what if he leaves the company" has to actually stop the equity.
 *
 * Removing a `stock_options` account in a scenario used to delete it from the
 * scenario's Balance Sheet ONLY: `stockOptionPlans` is loaded from the base case
 * and the overlay never touched it, so the engine kept vesting the shares,
 * booking the ordinary income and paying the tax. The scenario's numbers came
 * out identical to the base plan — wrong in the exact dimension the scenario
 * exists to test.
 *
 * This drives the REAL `applyScenarioChanges` and the REAL `runProjection`, and
 * pins the outcome against a CONTROL tree that never had the equity at all. The
 * control is what makes the assertion distinguishing: "scenario ≠ base" alone
 * would pass on a fix that merely perturbed the numbers.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { applyScenarioChanges } from "../applyChanges";
import type { ScenarioChange } from "../types";
import type {
  Account,
  ClientData,
  ClientInfo,
  Income,
  PlanSettings,
  FamilyMember,
} from "@/engine/types";
import type { StockOptionPlan } from "@/engine/equity/types";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import { TAX_YEAR_2026 } from "@/engine/__tests__/_fixtures/tax-year-2026";

const PLAN_START = 2026;
const VEST_YEAR = 2028;
const PRICE = 50;
const SHARES = 10_000;
const SO_ACCOUNT_ID = "so-acme";
/** 10,000 shares × $50, growth 0 → the whole vest books as ordinary income. */
const EQUITY_INCOME = SHARES * PRICE;
const SALARY_AMOUNT = 80_000;

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
  planEndYear: 2030,
  taxEngineMode: "bracket",
  taxInflationRate: 0,
};

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

const SO_ACCOUNT: Account = {
  id: SO_ACCOUNT_ID,
  name: "Acme Stock Options",
  category: "stock_options",
  subType: "stock_options",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const SALARY: Income = {
  id: "inc-salary",
  type: "salary",
  name: "Salary",
  annualAmount: SALARY_AMOUNT,
  startYear: PLAN_START,
  endYear: 2030,
  growthRate: 0,
  owner: "client",
};

const EQUITY_PLAN: StockOptionPlan = {
  accountId: SO_ACCOUNT_ID,
  ticker: "ACME",
  pricePerShare: PRICE,
  growthRate: 0,
  destinationAccountId: null,
  autoCreateDestination: true,
  sellToCover: false,
  withholdingRate: 0,
  strategy: {
    exerciseTiming: "at_vest",
    exerciseYear: null,
    sellTiming: "immediately",
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
      sharesGranted: SHARES,
      has83bElection: false,
      fmvAtGrant: null,
      strikePrice: null,
      strikeDiscountPct: null,
      expirationYear: null,
      strategy: null,
      tranches: [
        {
          id: "t-rsu",
          vestYear: VEST_YEAR,
          shares: SHARES,
          sharesExercised: 0,
          sharesSold: 0,
          strategy: null,
        },
      ],
      plannedEvents: [],
    },
  ],
};

function buildBase(): ClientData {
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
    taxYearRows: [TAX_YEAR_2026],
    stockOptionPlans: [EQUITY_PLAN],
  };
}

const REMOVE_EQUITY_ACCOUNT: ScenarioChange = {
  id: "chg-remove-so",
  scenarioId: "scn-leaves-acme",
  opType: "remove",
  targetKind: "account",
  targetId: SO_ACCOUNT_ID,
  payload: null,
  toggleGroupId: null,
  orderIndex: 0,
};

const at = (years: ReturnType<typeof runProjection>, year: number) =>
  years.find((y) => y.year === year)!;

describe("scenario cascade — removing a stock_options account (F15)", () => {
  it("stops the vest, the equity income and the tax, matching a plan that never had the equity", () => {
    const base = buildBase();

    // BASE: the equity is live. 2028 books salary + the whole vest.
    const baseYear = at(runProjection(structuredClone(base)), VEST_YEAR);
    expect(baseYear.taxDetail!.earnedIncome).toBeCloseTo(SALARY_AMOUNT + EQUITY_INCOME, 2);

    // CONTROL: what "he left the company" is SUPPOSED to look like — the same
    // tree with no equity account and no plan.
    const control: ClientData = {
      ...structuredClone(base),
      accounts: [CHECKING],
      stockOptionPlans: [],
    };
    const controlYear = at(runProjection(control), VEST_YEAR);
    expect(controlYear.taxDetail!.earnedIncome).toBeCloseTo(SALARY_AMOUNT, 2);

    // SCENARIO: remove the stock_options account through the real overlay.
    const { effectiveTree, warnings } = applyScenarioChanges(
      base,
      [REMOVE_EQUITY_ACCOUNT],
      {},
      [],
    );
    expect(effectiveTree.accounts.map((a) => a.id)).toEqual(["checking"]);
    expect(effectiveTree.stockOptionPlans).toEqual([]);
    expect(warnings.map((w) => w.kind)).toContain("equity_plan_dropped");

    const scenarioYear = at(runProjection(structuredClone(effectiveTree)), VEST_YEAR);

    // The load-bearing assertions: the scenario matches the control, NOT the
    // base. Both directions are asserted — before the fix the scenario matched
    // the base to the dollar ($580,000 of earned income and $213,617.20 of tax
    // on equity the scenario said was forfeited).
    expect(scenarioYear.taxDetail!.earnedIncome).toBeCloseTo(
      controlYear.taxDetail!.earnedIncome,
      2,
    );
    expect(scenarioYear.taxDetail!.earnedIncome).toBeLessThan(
      baseYear.taxDetail!.earnedIncome - EQUITY_INCOME + 1,
    );
    expect(scenarioYear.taxResult!.flow.totalTax).toBeCloseTo(
      controlYear.taxResult!.flow.totalTax,
      2,
    );
    expect(scenarioYear.taxResult!.flow.totalTax).toBeLessThan(
      baseYear.taxResult!.flow.totalTax,
    );
  });

  it("does not auto-create a destination account for equity the scenario removed", () => {
    // The engine mints `equity-dest-<accountId>` on first acquisition. Before
    // the fix that key appeared in the scenario's taxable portfolio bucket —
    // an account derived from one the scenario had just deleted.
    const { effectiveTree } = applyScenarioChanges(
      buildBase(),
      [REMOVE_EQUITY_ACCOUNT],
      {},
      [],
    );
    const scenarioYear = at(runProjection(structuredClone(effectiveTree)), VEST_YEAR);
    expect(
      Object.keys(scenarioYear.portfolioAssets?.taxable ?? {}),
    ).not.toContain(`equity-dest-${SO_ACCOUNT_ID}`);
  });

  it("leaves the equity alone when a DIFFERENT account is removed", () => {
    // Guard against a fix that drops equity plans indiscriminately.
    const base = buildBase();
    const otherAccount: Account = { ...CHECKING, id: "brokerage", category: "taxable", subType: "brokerage", isDefaultChecking: false };
    base.accounts = [CHECKING, SO_ACCOUNT, otherAccount];

    const { effectiveTree } = applyScenarioChanges(
      base,
      [{ ...REMOVE_EQUITY_ACCOUNT, targetId: "brokerage" }],
      {},
      [],
    );
    expect(effectiveTree.stockOptionPlans).toHaveLength(1);

    const scenarioYear = at(runProjection(structuredClone(effectiveTree)), VEST_YEAR);
    expect(scenarioYear.taxDetail!.earnedIncome).toBeCloseTo(
      SALARY_AMOUNT + EQUITY_INCOME,
      2,
    );
  });
});
