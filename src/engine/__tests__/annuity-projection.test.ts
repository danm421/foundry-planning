import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";
import type { AnnuityContract } from "../annuity";
import type { Account, ClientData, FamilyMember } from "../types";

const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const ANNUITY_ID = "ann-1";
const CHECKING_ID = "acc-checking";

/** bySource key the projection emits for an annuity contract's income. */
const ANNUITY_KEY = `annuity:${ANNUITY_ID}`;

interface FixtureOverrides {
  /** Residence state — drives the bracket-mode state engine. */
  state?: string;
  /** Owner DOB. Default 1952-03-01 → age 74 in 2026, well past 59.5. */
  dateOfBirth?: string;
  planEndYear?: number;
  /** Living expense. 0 (the default) keeps the withdrawal waterfall idle so a
   *  balance change can only have come from the contract itself. */
  livingExpense?: number;
  checkingValue?: number;
  /** False drops `isDefaultChecking`, which flips the projection onto the
   *  legacy no-checking supplemental path (the second of the two
   *  `supplementalRetirementBreakdown` sites). */
  defaultChecking?: boolean;
}

/**
 * A household whose ONLY income is one annuity contract.
 *
 * Deliberately income-free otherwise: `expect(income.total).toBeGreaterThan(0)`
 * is vacuous against the shared `fixtures.ts` household, which already carries
 * two salaries and Social Security. Here every dollar of `income.total` came
 * from the contract, so the assertions actually discriminate.
 *
 * Bracket mode + `taxYearRows` + `residenceState` mirrors
 * `projection-state-retirement-supplemental.test.ts` — without all three,
 * `taxResult.state` is never populated and the state-exclusion assertions pass
 * vacuously.
 */
function inputWithAnnuity(
  contract: AnnuityContract,
  accountValue: number,
  overrides: FixtureOverrides = {},
): ClientData {
  const {
    state = "IL",
    dateOfBirth = "1952-03-01",
    planEndYear = 2050,
    livingExpense = 0,
    checkingValue = 25_000,
    defaultChecking = true,
  } = overrides;

  const owners = [
    { kind: "family_member" as const, familyMemberId: CLIENT_FM_ID, percent: 1 },
  ];

  const annuityAccount: Account = {
    id: ANNUITY_ID,
    name: "Deferred Annuity",
    category: "annuity",
    subType: "other",
    titlingType: "jtwros",
    value: accountValue,
    basis: accountValue,
    growthRate: 0,
    rmdEnabled: false,
    owners,
    annuity: contract,
  };

  return {
    client: {
      firstName: "Ada",
      lastName: "Guaranty",
      dateOfBirth,
      filingStatus: "single",
      retirementAge: 65,
      // Past the horizon on purpose: a death inside the plan would stop a
      // single-life rider and confound "income continues" with "owner died".
      planEndAge: 105,
    },
    accounts: [
      {
        id: CHECKING_ID,
        name: "Checking",
        category: "cash",
        subType: "checking",
        titlingType: "jtwros",
        value: checkingValue,
        basis: checkingValue,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: defaultChecking,
        owners,
      },
      annuityAccount,
    ],
    incomes: [],
    expenses:
      livingExpense > 0
        ? [
            {
              id: "exp-living",
              type: "living",
              name: "Living Expenses",
              annualAmount: livingExpense,
              startYear: 2026,
              endYear: planEndYear,
              growthRate: 0,
            },
          ]
        : [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [
      { accountId: CHECKING_ID, priorityOrder: 1, startYear: 2026, endYear: planEndYear },
      { accountId: ANNUITY_ID, priorityOrder: 2, startYear: 2026, endYear: planEndYear },
    ],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
      residenceState: state,
    },
    entities: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    giftEvents: [],
    wills: [],
    rothConversions: [],
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Ada",
        lastName: "Guaranty",
        relationship: "other",
        role: "client",
        dateOfBirth,
      } as FamilyMember,
    ],
    externalBeneficiaries: [],
    taxYearRows: [TAX_YEAR_2026],
  } as ClientData;
}

describe("projection — annuity contracts", () => {
  it("a rider annuity produces income in the projection", () => {
    const input = inputWithAnnuity(
      {
        productType: "fixed_indexed",
        incomeMode: "rider",
        incomeStartYear: 2030,
        benefitBase: 200_000,
        payoutPct: 0.05,
        rollupRatchets: false,
        taxTreatment: "non_qualified",
        costBasis: 100_000,
        annualFeePct: 0,
      },
      200_000,
    );
    const years = runProjection(input);
    const y2029 = years.find((y) => y.year === 2029)!;
    const y2030 = years.find((y) => y.year === 2030)!;

    // Before the start year the contract pays nothing. Without this the
    // "income appeared" assertion below cannot tell income from noise.
    expect(y2029.income.total).toBe(0);
    expect(y2029.income.bySource[ANNUITY_KEY]).toBeUndefined();

    // $200k benefit base × 5% payout. Attributed to THIS contract, not just
    // "some income showed up".
    expect(y2030.income.bySource[ANNUITY_KEY]).toBeCloseTo(10_000, 2);
    expect(y2030.income.total).toBeCloseTo(10_000, 2);

    // Basis is $100k against a $200k value, so LIFO makes the whole payment
    // ordinary income (§72(e)(2)(B) — gain first).
    expect(y2030.taxDetail!.bySource[ANNUITY_KEY]).toEqual({
      type: "ordinary_income",
      amount: expect.closeTo(10_000, 2),
    });
  });

  it("THE CROSSOVER: the balance sheet shows $0 while income continues", () => {
    const input = inputWithAnnuity(
      {
        productType: "fixed_indexed",
        incomeMode: "rider",
        incomeStartYear: 2027,
        benefitBase: 100_000,
        payoutPct: 0.10,
        rollupRatchets: false,
        taxTreatment: "non_qualified",
        costBasis: 100_000,
        annualFeePct: 0,
      },
      100_000,
    );
    const years = runProjection(input);

    // VACUITY GUARD. An annuity that never lands in the annuity bucket at all
    // (wrong owners, entity-owned, mis-categorised) reports annuityTotal === 0
    // in every year, and the assertion below would pass against completely
    // broken code. Prove the bucket is populated FIRST, so the later zero is
    // depletion and not mis-bucketing.
    const y2026 = years.find((y) => y.year === 2026)!;
    expect(y2026.portfolioAssets.annuityTotal).toBe(100_000);

    const late = years.filter((y) => y.year >= 2040);
    expect(late.length).toBeGreaterThan(0);
    // Both halves. A test on income alone would pass on a broken balance.
    expect(late.every((y) => y.portfolioAssets.annuityTotal === 0)).toBe(true);
    expect(late.every((y) => y.income.bySource[ANNUITY_KEY] === 10_000)).toBe(true);
    expect(late.every((y) => y.income.total === 10_000)).toBe(true);

    // Past the crossover there is no basis left to return, so the carrier's
    // own-pocket payments are 100% ordinary income.
    const y2045 = years.find((y) => y.year === 2045)!;
    expect(y2045.taxDetail!.bySource[ANNUITY_KEY]).toEqual({
      type: "ordinary_income",
      amount: 10_000,
    });
  });

  it("feeds the state retirement-income exclusion (the bucket that was hard-coded to 0)", () => {
    const input = inputWithAnnuity(
      {
        productType: "fixed_indexed",
        incomeMode: "rider",
        incomeStartYear: 2027,
        benefitBase: 200_000,
        payoutPct: 0.05,
        rollupRatchets: false,
        taxTreatment: "non_qualified",
        costBasis: 0,
        annualFeePct: 0,
      },
      200_000,
    );
    const years = runProjection(input);
    const y = years.find((y) => y.year === 2027)!;

    // `retirementBreakdown` is an INPUT to the tax calculator, never a field on
    // TaxResult — assert the observable it feeds instead.
    const state = y.taxResult!.state!;
    expect(state.state).toBe("IL");
    expect(state.subtractions.retirementIncome).toBeCloseTo(10_000, 2);
  });

  it("an annuitized contract zeroes the balance and keeps paying", () => {
    const input = inputWithAnnuity(
      {
        productType: "spia",
        incomeMode: "annuitized",
        incomeStartYear: 2027,
        annuitizedPayment: 12_000,
        payoutStructure: "period_certain",
        periodCertainYears: 20,
        taxTreatment: "non_qualified",
        costBasis: 100_000,
        annualFeePct: 0,
        rollupRatchets: false,
      },
      150_000,
    );
    const years = runProjection(input);

    // VACUITY GUARD — same trap as the crossover test.
    expect(years.find((y) => y.year === 2026)!.portfolioAssets.annuityTotal).toBe(150_000);

    const y2028 = years.find((y) => y.year === 2028)!;
    expect(y2028.portfolioAssets.annuityTotal).toBe(0);
    expect(y2028.income.bySource[ANNUITY_KEY]).toBeCloseTo(12_000, 2);
    expect(y2028.income.total).toBeCloseTo(12_000, 2);

    // §72(b): part of each annuitized payment is an excluded return of the
    // $100k investment, so the taxable slice is strictly less than the payment.
    const taxable = y2028.taxDetail!.bySource[ANNUITY_KEY]!.amount;
    expect(taxable).toBeGreaterThan(0);
    expect(taxable).toBeLessThan(12_000);
  });

  it("a state that exempts annuity income taxes less than one that does not", () => {
    const contract: AnnuityContract = {
      productType: "fixed_indexed",
      incomeMode: "rider",
      incomeStartYear: 2027,
      // Sized past CA's $306 personal-exemption CREDIT (single, 65+). At $20k of
      // annuity income the credit wipes CA's bill out entirely and the contrast
      // reads as 0 < 0 — a passing test that proves nothing.
      benefitBase: 1_000_000,
      payoutPct: 0.05,
      rollupRatchets: false,
      taxTreatment: "non_qualified",
      costBasis: 0,
      annualFeePct: 0,
    };
    // Illinois exempts qualifying retirement & annuity income; California does not.
    const il = runProjection(inputWithAnnuity(contract, 1_000_000, { state: "IL" }));
    const ca = runProjection(inputWithAnnuity(contract, 1_000_000, { state: "CA" }));
    const stateTax = (ys: ReturnType<typeof runProjection>) =>
      ys.find((y) => y.year === 2027)!.taxResult!.state!.stateTax;

    // Not just "less than": IL must exempt it outright, and CA must actually
    // tax something — otherwise 0 < 0 would read as a pass.
    expect(stateTax(ca)).toBeGreaterThan(0);
    expect(stateTax(il)).toBe(0);
  });

  it("a supplemental draw from an annuity account reaches the state exclusion", () => {
    // A pure deferred contract — no rider, no annuitization. The only way money
    // leaves it is the spending-driven withdrawal waterfall, which is the path
    // `supplementalRetirementBreakdown` covers.
    const input = inputWithAnnuity(
      {
        productType: "myga",
        incomeMode: "none",
        taxTreatment: "non_qualified",
        costBasis: 0, // every dollar drawn is ordinary income
        annualFeePct: 0,
        rollupRatchets: false,
      },
      500_000,
      { state: "IL", livingExpense: 60_000, checkingValue: 5_000, planEndYear: 2028 },
    );
    const years = runProjection(input);
    const y2026 = years.find((y) => y.year === 2026)!;

    // VACUITY GUARD: prove the waterfall actually tapped the annuity. Without
    // this the exclusion assertion passes on a year where nothing was drawn.
    const drawn = y2026.withdrawals.byAccount[ANNUITY_ID] ?? 0;
    expect(drawn).toBeGreaterThan(0);

    const state = y2026.taxResult!.state!;
    expect(state.subtractions.retirementIncome).toBeCloseTo(
      y2026.taxResult!.income.ordinaryIncome,
      0,
    );
    expect(state.subtractions.retirementIncome).toBeGreaterThan(0);
    expect(state.stateTax).toBe(0);
  });

  it("a supplemental annuity draw reaches the exclusion on the no-checking path too", () => {
    const input = inputWithAnnuity(
      {
        productType: "myga",
        incomeMode: "none",
        taxTreatment: "non_qualified",
        costBasis: 0,
        annualFeePct: 0,
        rollupRatchets: false,
      },
      500_000,
      {
        state: "IL",
        livingExpense: 60_000,
        checkingValue: 5_000,
        planEndYear: 2028,
        defaultChecking: false,
      },
    );
    const years = runProjection(input);
    const y2026 = years.find((y) => y.year === 2026)!;

    expect(y2026.withdrawals.byAccount[ANNUITY_ID] ?? 0).toBeGreaterThan(0);
    const state = y2026.taxResult!.state!;
    expect(state.subtractions.retirementIncome).toBeGreaterThan(0);
    expect(state.stateTax).toBe(0);
  });

  it("a supplemental draw is not silently reverted by next year's contract step", () => {
    // The contract carries its own account value across years. If that value is
    // treated as authoritative WITHOUT re-reading the live balance, a draw taken
    // in 2026 is undone when 2027's step writes the stale value back.
    const input = inputWithAnnuity(
      {
        productType: "myga",
        incomeMode: "none",
        taxTreatment: "non_qualified",
        costBasis: 0,
        annualFeePct: 0,
        rollupRatchets: false,
      },
      500_000,
      { state: "IL", livingExpense: 60_000, checkingValue: 5_000, planEndYear: 2028 },
    );
    const years = runProjection(input);
    const y2026 = years.find((y) => y.year === 2026)!;
    const y2027 = years.find((y) => y.year === 2027)!;

    const drawn2026 = y2026.withdrawals.byAccount[ANNUITY_ID] ?? 0;
    const drawn2027 = y2027.withdrawals.byAccount[ANNUITY_ID] ?? 0;
    expect(drawn2026).toBeGreaterThan(0);
    expect(drawn2027).toBeGreaterThan(0);
    expect(y2026.portfolioAssets.annuityTotal).toBeCloseTo(500_000 - drawn2026, 2);
    // The two draws must COMPOUND. `toBeLessThan` is NOT enough here: expenses
    // are flat but checking is only seeded once, so 2027 draws MORE than 2026
    // and the balance falls year-over-year even when 2026's draw was reverted.
    // Only the exact cumulative figure separates the two.
    expect(y2027.portfolioAssets.annuityTotal).toBeCloseTo(
      500_000 - drawn2026 - drawn2027,
      2,
    );
  });

  it("books the §72(q) penalty on a pre-59½ contract distribution", () => {
    const input = inputWithAnnuity(
      {
        productType: "fixed_indexed",
        incomeMode: "rider",
        incomeStartYear: 2026,
        benefitBase: 200_000,
        payoutPct: 0.05,
        rollupRatchets: false,
        taxTreatment: "qualified", // no basis — the whole $10k is penalizable
        annualFeePct: 0,
      },
      200_000,
      { dateOfBirth: "1976-03-01", planEndYear: 2027 }, // age 50 in 2026
    );
    const years = runProjection(input);
    const y2026 = years.find((y) => y.year === 2026)!;

    expect(y2026.income.bySource[ANNUITY_KEY]).toBeCloseTo(10_000, 2);
    // 10% of the taxable slice. Dropping `result.earlyWithdrawalPenalty` on the
    // floor — as the naive wiring does — leaves this at 0.
    expect(y2026.taxResult!.flow.earlyWithdrawalPenalty).toBeCloseTo(1_000, 2);
  });
});
