/**
 * End-to-end verification of the life-insurance custom-schedule feature against
 * the shape of a real carrier (Singer) whole-life illustration.
 *
 * Unlike the focused integration tests, this exercises ALL THREE scheduled
 * modes on a single policy at once, through the REAL synthesis path
 * (`withSynthesizedPremiums` + `withSynthesizedPolicyIncome`) and a full
 * `runProjection`, then reads back:
 *
 *   1. Premium expense — driven by the schedule's `premiumAmount` column
 *      (87,216 every year 2026–2055, zero outside the schedule).
 *   2. Cash value — resolved from the schedule's `cashValue` column, not basic
 *      growth (free-form mode).
 *   3. Income — a non-zero scheduled income row credits cash TAX-FREE: it lands
 *      in `income.bySource`, is classified `tax_exempt`, never enters any taxable
 *      bucket (earned / ordinary / dividends / cap-gains / qbi), and leaves the
 *      year's tax unchanged versus a control run with the income removed.
 *   4. Death benefit — death in 2056 pays the SCHEDULED death benefit
 *      (1,843,913, not the 5,000,000 face) and it arrives income-tax-free.
 *
 * The illustration shape: premium 87,216 each year 2026–2055; death benefit
 * 5,000,000 dropping to 1,843,913 in 2056; cash value column present; income 0
 * throughout — but per the plan we ASSERT the income mechanism by adding one
 * non-zero income year (50,000 in 2050) and checking it lands tax-free.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { withSynthesizedPremiums } from "@/lib/insurance-policies/premium-expense";
import { withSynthesizedPolicyIncome } from "@/lib/insurance-policies/policy-income";
import type {
  Account,
  ClientData,
  ClientInfo,
  LifeInsurancePolicy,
  LifeInsuranceCashValueScheduleRow,
  PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT } from "../ownership";

// ── Singer illustration constants ──────────────────────────────────────────
const PREMIUM = 87_216;
const FACE_VALUE = 5_000_000;
const DEATH_BENEFIT_2056 = 1_843_913;
const INCOME_YEAR = 2050;
const INCOME_AMOUNT = 50_000;
const SCHEDULE_START = 2026;
const SCHEDULE_LAST_FULL = 2055; // last year at the full 5M death benefit
const DEATH_YEAR = 2056; // client born 1980, lifeExpectancy 76 → 2056

// Hand-built cash-value column (monotonic, plausible). The exact figures don't
// matter — what matters is that the projection reports the SCHEDULE value, not
// a growth model, for an in-force year.
const CASH_VALUE_BY_YEAR: Record<number, number> = {
  2026: 50_000,
  2040: 1_000_000,
  2055: 2_200_000,
};

function buildSchedule(): LifeInsuranceCashValueScheduleRow[] {
  const rows: LifeInsuranceCashValueScheduleRow[] = [];
  for (let year = SCHEDULE_START; year <= SCHEDULE_LAST_FULL; year++) {
    const row: LifeInsuranceCashValueScheduleRow = {
      year,
      premiumAmount: PREMIUM,
      deathBenefit: FACE_VALUE,
    };
    if (CASH_VALUE_BY_YEAR[year] != null) row.cashValue = CASH_VALUE_BY_YEAR[year];
    if (year === INCOME_YEAR) row.income = INCOME_AMOUNT;
    rows.push(row);
  }
  // 2056: death-benefit drop, no premium (paid-up), schedule's terminal cash value.
  rows.push({ year: DEATH_YEAR, deathBenefit: DEATH_BENEFIT_2056, cashValue: 2_300_000 });
  return rows;
}

const CLIENT: ClientInfo = {
  firstName: "Singer",
  lastName: "Insured",
  dateOfBirth: "1980-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "single",
  lifeExpectancy: 76, // 1980 + 76 = 2056 → final death year
};

// Non-zero flat rates so a TAXABLE income would visibly raise tax. The scheduled
// policy income is tax-exempt, so it must NOT move the tax needle.
const PLAN: PlanSettings = {
  flatFederalRate: 0.3,
  flatStateRate: 0.05,
  inflationRate: 0,
  planStartYear: SCHEDULE_START,
  planEndYear: DEATH_YEAR,
};

function buildPolicyAccount(): Account {
  const policy: LifeInsurancePolicy = {
    faceValue: FACE_VALUE,
    costBasis: 0,
    premiumAmount: 0, // scalar path is bypassed — schedule drives premium
    premiumYears: null,
    policyType: "whole",
    termIssueYear: null,
    termLengthYears: null,
    endsAtInsuredRetirement: false,
    // Free-form cash-value mode makes the schedule authoritative for cash value.
    cashValueGrowthMode: "free_form",
    premiumScheduleMode: "scheduled",
    deathBenefitScheduleMode: "scheduled",
    incomeScheduleMode: "scheduled",
    postPayoutGrowthRate: 0.04,
    cashValueSchedule: buildSchedule(),
  };
  return {
    id: "singer-wl",
    name: "Singer Whole Life",
    category: "life_insurance",
    subType: "whole",
    titlingType: "jtwros",
    insuredPerson: "client",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    lifeInsurance: policy,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    beneficiaries: [
      {
        id: "bene-1",
        tier: "primary",
        percentage: 1,
        familyMemberId: LEGACY_FM_CLIENT,
        sortOrder: 0,
      },
    ],
  };
}

function buildClientData(over: Partial<ClientData> = {}): ClientData {
  // Household checking to receive the tax-free income credit.
  const checking: Account = {
    id: "checking",
    name: "Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value: 100_000,
    basis: 100_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };
  const base: ClientData = {
    client: CLIENT,
    accounts: [checking, buildPolicyAccount()],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: PLAN,
    giftEvents: [],
    ...over,
  };
  // Run the REAL synthesis path: derive premium expenses + policy income from
  // the policy, exactly as the loader does before projecting.
  return withSynthesizedPolicyIncome(withSynthesizedPremiums(base));
}

describe("life insurance custom schedule — end-to-end projection (Singer)", () => {
  const data = buildClientData();
  const years = runProjection(data);
  const byYear = new Map(years.map((y) => [y.year, y]));
  const PREMIUM_EXPENSE_ID = "premium-singer-wl";
  const INCOME_ID = "policy-income-singer-wl";

  it("synthesizes the scheduled premium: 87,216 every year 2026–2055, zero in 2056", () => {
    // Provenance check on the synthesized expense itself (real synthesis path).
    const premiumExpense = data.expenses.find((e) => e.id === PREMIUM_EXPENSE_ID);
    expect(premiumExpense).toBeDefined();
    expect(premiumExpense!.source).toBe("policy");
    expect(premiumExpense!.sourcePolicyAccountId).toBe("singer-wl");
    expect(premiumExpense!.scheduleOverrides?.[2026]).toBe(PREMIUM);
    expect(premiumExpense!.scheduleOverrides?.[2055]).toBe(PREMIUM);
    expect(premiumExpense!.scheduleOverrides?.[2056]).toBeUndefined();

    // Projection-level effect: premium billed each scheduled year, zero after.
    let total = 0;
    for (let yr = SCHEDULE_START; yr <= SCHEDULE_LAST_FULL; yr++) {
      const amt = byYear.get(yr)!.expenses.bySource[PREMIUM_EXPENSE_ID];
      expect(amt).toBeCloseTo(PREMIUM, 6);
      total += amt!;
    }
    expect(total).toBeCloseTo(PREMIUM * (SCHEDULE_LAST_FULL - SCHEDULE_START + 1), 4);

    // 2056 — schedule has no premiumAmount → no premium billed.
    expect(byYear.get(DEATH_YEAR)!.expenses.bySource[PREMIUM_EXPENSE_ID] ?? 0).toBe(0);
  });

  it("reports the SCHEDULED cash value (not basic growth) for an in-force year", () => {
    // 2040 is an explicit cash-value point in the schedule (1,000,000). The
    // free-form override (projection.ts) makes the schedule authoritative — a
    // basic-growth model on value=0 / growthRate=0 would report 0.
    expect(byYear.get(2040)!.portfolioAssets.lifeInsurance["singer-wl"]).toBeCloseTo(
      CASH_VALUE_BY_YEAR[2040],
      4,
    );
    // 2026 — first schedule point.
    expect(byYear.get(2026)!.portfolioAssets.lifeInsurance["singer-wl"]).toBeCloseTo(
      CASH_VALUE_BY_YEAR[2026],
      4,
    );
  });

  it("credits scheduled income to cash TAX-FREE — tax-exempt bucket, never the taxable base", () => {
    // Synthesized income provenance + tax classification.
    const income = data.incomes.find((i) => i.id === INCOME_ID);
    expect(income).toBeDefined();
    expect(income!.taxType).toBe("tax_exempt");
    expect(income!.source).toBe("policy");
    expect(income!.scheduleOverrides?.[INCOME_YEAR]).toBe(INCOME_AMOUNT);

    const incomeYr = byYear.get(INCOME_YEAR)!;
    // It shows as a cash inflow for the year (income.other / bySource), driven
    // by the schedule's `income` column via scheduleOverrides.
    expect(incomeYr.income.bySource[INCOME_ID]).toBeCloseTo(INCOME_AMOUNT, 4);

    // It is classified tax-exempt and NEVER lands in a taxable bucket. (The
    // taxDetail loop classifies by taxType correctly; note the taxDetail amount
    // for scheduleOverrides rows is a separate pre-existing reporting gap — it
    // reads annualAmount, which is 0 here. The load-bearing tax-free proof is
    // the control comparison below, which is unaffected by that gap.)
    const td = incomeYr.taxDetail!;
    expect(td.bySource[INCOME_ID]?.type).toBe("tax_exempt");
    expect(td.earnedIncome).toBe(0);
    expect(td.ordinaryIncome).toBe(0);
    expect(td.dividends).toBe(0);
    expect(td.capitalGains).toBe(0);
    expect(td.stCapitalGains).toBe(0);
    expect(td.qbi).toBe(0);

    // Mechanism proof: with flat 30%/5% rates, a TAXABLE 50k would add ~17.5k of
    // tax. Compare against a control run where the income is removed entirely.
    // The scheduled tax-exempt income must NOT change the year's tax.
    const controlData = buildClientData({
      // strip the policy's income column so no income is synthesized
      accounts: [
        ...data.accounts.filter((a) => a.category !== "life_insurance"),
        (() => {
          const acct = buildPolicyAccount();
          acct.lifeInsurance!.incomeScheduleMode = "off";
          return acct;
        })(),
      ],
    });
    const controlYears = runProjection(controlData);
    const controlYr = controlYears.find((y) => y.year === INCOME_YEAR)!;
    // expenses.taxes ties out to taxResult.flow.totalTax (see projection-tax-tieout).
    const taxWith = incomeYr.expenses.taxes;
    const taxWithout = controlYr.expenses.taxes;
    expect(taxWith).toBeCloseTo(taxWithout, 4);
    // And the control genuinely had no income that year (sanity on the control).
    expect(controlYr.income.bySource[INCOME_ID] ?? 0).toBe(0);
  });

  it("pays the SCHEDULED death benefit (1,843,913) income-tax-free at death in 2056", () => {
    const deathYr = byYear.get(DEATH_YEAR)!;
    // The payout is folded into income.bySource under the proceeds key.
    const proceedsKey = "life-insurance-proceeds:singer-wl";
    expect(deathYr.income.bySource[proceedsKey]).toBeCloseTo(DEATH_BENEFIT_2056, 4);
    // It is the SCHEDULED 1,843,913, NOT the 5,000,000 face value.
    expect(deathYr.income.bySource[proceedsKey]).not.toBeCloseTo(FACE_VALUE, 0);

    // Income-tax-free (§101(a)): the proceeds are folded into income totals but
    // never into taxDetail — they carry no taxable entry and never appear in any
    // taxable bucket.
    const td = deathYr.taxDetail!;
    expect(td.bySource[proceedsKey]).toBeUndefined();
    // The scheduled 1.84M payout dwarfs every taxable bucket — if any of it were
    // taxable these would be in the millions. They are not.
    expect(td.earnedIncome).toBe(0);
    expect(td.ordinaryIncome).toBe(0);
    expect(td.capitalGains).toBe(0);

    // The death event fired in the scheduled year (single-filer final death 2056).
    expect(deathYr.estateTax).toBeDefined();
    expect(deathYr.estateTax!.deathOrder).toBe(2);
  });
});
