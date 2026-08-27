import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";
import type { AnnuityContract } from "../annuity";
import type { Account, ClientData, FamilyMember, Transfer } from "../types";

const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const SPOUSE_FM_ID = "00000000-0000-0000-0000-000000000002";
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
  /** Growth on the annuity account. 0 by default so a balance change can only
   *  have come from the contract or a withdrawal. */
  annuityGrowthRate?: number;
  transfers?: Transfer[];
  extraAccounts?: Account[];
  /** Present ⇒ a married household: filing status flips to married_joint and a
   *  spouse FamilyMember joins. Drives `coAnnuitantAge` on a joint payout. */
  spouseDob?: string;
  planEndAge?: number;
  /** Terminal age. THIS — not `planEndAge` — is what the death helpers read
   *  (`computeFinalDeathYear` returns null without it), so leaving it unset
   *  means no death ever fires. Set it to exercise the isAlive resolution. */
  lifeExpectancy?: number;
  /** Overrides on the annuity account itself (e.g. `rmdEnabled`, `owners`). */
  annuityAccountOverrides?: Partial<Account>;
  /** Entities the plan owns. Needed for the entity-owned routing branch. */
  entities?: ClientData["entities"];
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
    annuityGrowthRate = 0,
    transfers = [],
    extraAccounts = [],
    spouseDob,
    planEndAge = 105,
    annuityAccountOverrides = {},
    entities = [],
    lifeExpectancy,
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
    growthRate: annuityGrowthRate,
    rmdEnabled: false,
    owners,
    annuity: contract,
    ...annuityAccountOverrides,
  };

  return {
    client: {
      firstName: "Ada",
      lastName: "Guaranty",
      dateOfBirth,
      filingStatus: spouseDob ? "married_joint" : "single",
      retirementAge: 65,
      planEndAge,
      // Unset by default, so no death fires anywhere in this suite: a death
      // inside the plan would stop a single-life rider and confound "income
      // continues" with "owner died".
      ...(lifeExpectancy != null ? { lifeExpectancy } : {}),
      ...(spouseDob
        ? { spouseName: "Bo Guaranty", spouseDob, spouseRetirementAge: 65 }
        : {}),
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
      ...extraAccounts,
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
    entities,
    deductions: [],
    transfers,
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
      ...(spouseDob
        ? [
            {
              id: SPOUSE_FM_ID,
              firstName: "Bo",
              lastName: "Guaranty",
              relationship: "other",
              role: "spouse",
              dateOfBirth: spouseDob,
            } as FamilyMember,
          ]
        : []),
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

  it("a RECURRING transfer out of an annuity cannot re-shelter the same basis twice", () => {
    // $200k value against $190k of §72 basis, growing 20%/yr, with $60k moved
    // out to a brokerage each year.
    //
    //   2026: 200k → 240k. Gain 50k. LIFO: 50k ordinary + 10k of basis
    //         returned → basis 190k → 180k, balance 180k.
    //   2027: 180k → 216k. TRUE basis 180k → gain 36k → $36,000 ordinary.
    //         STALE basis 190k → gain 26k → $26,000 ordinary.
    //
    // Reading `contract.costBasis` every year — the original figure, never
    // decremented — under-reports year 2 by $10,000, and by more every year a
    // recurring transfer runs.
    const transfers: Transfer[] = [
      {
        id: "xfer-1",
        name: "Annuity to brokerage",
        sourceAccountId: ANNUITY_ID,
        targetAccountId: "acc-brokerage",
        amount: 60_000,
        mode: "recurring",
        startYear: 2026,
        endYear: 2027,
        growthRate: 0,
        schedules: [],
      },
    ];
    const input = inputWithAnnuity(
      {
        productType: "myga",
        incomeMode: "none",
        taxTreatment: "non_qualified",
        costBasis: 190_000,
        annualFeePct: 0,
        rollupRatchets: false,
      },
      200_000,
      {
        planEndYear: 2027,
        annuityGrowthRate: 0.20,
        checkingValue: 200_000, // deep enough that no gap-fill draw is needed
        transfers,
        extraAccounts: [
          {
            id: "acc-brokerage",
            name: "Brokerage",
            category: "taxable",
            subType: "brokerage",
            titlingType: "jtwros",
            value: 0,
            basis: 0,
            growthRate: 0,
            rmdEnabled: false,
            owners: [
              { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
            ],
          },
        ],
      },
    );
    const years = runProjection(input);
    const y2026 = years.find((y) => y.year === 2026)!;
    const y2027 = years.find((y) => y.year === 2027)!;

    // GUARD: the balance must move only via the transfer, never a gap-fill draw.
    expect(y2026.withdrawals.byAccount[ANNUITY_ID] ?? 0).toBe(0);
    expect(y2027.withdrawals.byAccount[ANNUITY_ID] ?? 0).toBe(0);
    expect(y2026.portfolioAssets.annuityTotal).toBeCloseTo(180_000, 2);
    expect(y2027.portfolioAssets.annuityTotal).toBeCloseTo(156_000, 2);

    const ordinary = (y: (typeof years)[number]) =>
      y.taxDetail!.bySource["transfer:xfer-1"]?.amount ?? 0;

    // Year 1 is identical either way — the bug only shows from year 2.
    expect(ordinary(y2026)).toBeCloseTo(50_000, 2);
    expect(ordinary(y2027)).toBeCloseTo(36_000, 2);
    // Spelled out so a regression reads as what it is, not as an off-by-$10k.
    expect(ordinary(y2027)).toBeGreaterThan(26_000);
  });

  it("a joint-and-survivor payout prices its exclusion off BOTH lives", () => {
    // §72(b): the exclusion ratio is investment ÷ EXPECTED RETURN, and a
    // joint-and-survivor payout's expected return is the LAST-SURVIVOR
    // expectancy. A 36-year-old co-annuitant stretches that far beyond a
    // 76-year-old one, so the same contract must exclude proportionally LESS of
    // each payment and recognise MORE ordinary income.
    //
    // Without `coAnnuitantAge`, `expectedReturnMultiple` falls through to the
    // single-life table on the owner's age alone (annuity/tax.ts:158 gates on
    // `coAnnuitantAge != null`) and BOTH runs return the identical number —
    // which is exactly what this test refuses to accept.
    const jointContract: AnnuityContract = {
      productType: "spia",
      incomeMode: "annuitized",
      incomeStartYear: 2026,
      annuitizedPayment: 12_000,
      payoutStructure: "joint_survivor",
      survivorPct: 1,
      taxTreatment: "non_qualified",
      costBasis: 100_000,
      annualFeePct: 0,
      rollupRatchets: false,
    };
    const run = (dob: string) =>
      runProjection(
        inputWithAnnuity(jointContract, 150_000, {
          spouseDob: dob,
          planEndYear: 2027,
        }),
      ).find((y) => y.year === 2026)!;

    const youngCo = run("1990-03-01"); // co-annuitant age 36
    const oldCo = run("1950-03-01"); // co-annuitant age 76

    const taxable = (y: (typeof youngCo)) =>
      y.taxDetail!.bySource[ANNUITY_KEY]?.amount ?? 0;

    // Both must be a real partial exclusion, not 0 and not the whole payment —
    // otherwise "greater than" could be satisfied by a degenerate split.
    for (const y of [youngCo, oldCo]) {
      expect(taxable(y)).toBeGreaterThan(0);
      expect(taxable(y)).toBeLessThan(12_000);
    }
    // The whole point: the two runs must DIFFER, and in this direction.
    expect(taxable(youngCo)).toBeGreaterThan(taxable(oldCo));
  });

  // The converged plan is applied in TWO separate loops — the `hasChecking`
  // convergence loop and the legacy no-checking branch. Round 1's transfer fix
  // landed on one of two sibling sites and the whole-branch review missed it;
  // this runs the identical proof through both.
  it.each([
    ["the hasChecking convergence loop", true],
    ["the legacy no-checking path", false],
  ] as const)(
    "a spending draw consumes §72 basis, so the crossover payments are taxable — %s",
    (_label, defaultChecking) => {
      // The state-coherence half. A deferred contract is drained to fund living
      // expenses, THEN its rider turns on and pays past a zero account value.
      //
      //   2026-27: $110k/yr of expenses against $20k of cash drains the whole
      //            $200k contract — exactly, with nothing left unfunded (an
      //            unfunded remainder pushes the legacy path's overdraft leg
      //            onto the account and muddies the guard below). Every dollar
      //            drawn is a return of basis (value == basis, so LIFO finds no
      //            gain), so basis and value reach zero together.
      //   2028:    the rider pays $20k out of the CARRIER's pocket. With no
      //            account value and no basis left, `splitLifo`'s excess term
      //            makes every dollar ordinary income.
      //
      // If the draws never decremented `remainingBasis`, 2028 reads a stale
      // $200k of basis, finds no gain, and scores the whole payment as a
      // TAX-FREE return of basis the household already recovered.
      const input = inputWithAnnuity(
        {
          productType: "fixed_indexed",
          incomeMode: "rider",
          incomeStartYear: 2028,
          benefitBase: 200_000,
          payoutPct: 0.10,
          rollupRatchets: false,
          taxTreatment: "non_qualified",
          costBasis: 200_000,
          annualFeePct: 0,
        },
        200_000,
        {
          planEndYear: 2028,
          livingExpense: 110_000,
          checkingValue: 20_000,
          defaultChecking,
        },
      );
      const years = runProjection(input);
      const y2027 = years.find((y) => y.year === 2027)!;
      const y2028 = years.find((y) => y.year === 2028)!;

      // GUARD: the draws really happened and really emptied the contract.
      expect(y2027.withdrawals.byAccount[ANNUITY_ID] ?? 0).toBeGreaterThan(0);
      expect(y2027.portfolioAssets.annuityTotal).toBe(0);

      // The whole payment is ordinary income — the carrier is paying past a
      // contract the household has already recovered every dollar of.
      expect(y2028.taxDetail!.bySource[ANNUITY_KEY]).toEqual({
        type: "ordinary_income",
        amount: 20_000,
      });
      // ...and NOT a tax-free return of basis consumed years ago.
      expect(y2028.taxDetail!.bySource[`annuity_tax_free:${ANNUITY_ID}`]).toBeUndefined();
    },
  );

  it("a spending draw reads the LIVE §72 basis a transfer already consumed", () => {
    // The read half, and proof the two halves compose: the transfer path writes
    // the basis down, the draw path must read what it wrote.
    //
    //   2026: 200k → 240k (20% growth). A $150k transfer out: $50k of gain is
    //         recognised and $100k of basis returned → basis 190k → 90k,
    //         value 90k.
    //   2027: 90k → 108k. TRUE basis 90k ⇒ $18,000 of gain, and a draw larger
    //         than that recognises exactly $18,000.
    //         STALE basis 190k ⇒ no gain at all ⇒ $0, tax-free.
    //
    // $18,000 is fixed by the GAIN, not by the draw size, so the exact
    // converged draw amount cannot move it.
    const input = inputWithAnnuity(
      {
        productType: "myga",
        incomeMode: "none",
        taxTreatment: "non_qualified",
        costBasis: 190_000,
        annualFeePct: 0,
        rollupRatchets: false,
      },
      200_000,
      {
        planEndYear: 2027,
        annuityGrowthRate: 0.20,
        checkingValue: 60_000,
        livingExpense: 45_000,
        transfers: [
          {
            id: "xfer-setup",
            name: "One-time move to brokerage",
            sourceAccountId: ANNUITY_ID,
            targetAccountId: "acc-brokerage",
            amount: 150_000,
            mode: "one_time",
            startYear: 2026,
            growthRate: 0,
            schedules: [],
          },
        ],
        extraAccounts: [
          {
            id: "acc-brokerage",
            name: "Brokerage",
            category: "taxable",
            subType: "brokerage",
            titlingType: "jtwros",
            value: 0,
            basis: 0,
            growthRate: 0,
            rmdEnabled: false,
            owners: [
              { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
            ],
          },
        ],
      },
    );
    const years = runProjection(input);
    const y2026 = years.find((y) => y.year === 2026)!;
    const y2027 = years.find((y) => y.year === 2027)!;

    // GUARDS: 2026 is the transfer alone (checking absorbs the tax), and 2027's
    // draw is comfortably larger than the $18k of gain it must recognise.
    expect(y2026.withdrawals.byAccount[ANNUITY_ID] ?? 0).toBe(0);
    expect(y2026.portfolioAssets.annuityTotal).toBeCloseTo(90_000, 2);
    expect(y2027.withdrawals.byAccount[ANNUITY_ID] ?? 0).toBeGreaterThan(18_000);

    expect(y2027.taxDetail!.bySource[`withdrawal:${ANNUITY_ID}`]).toEqual({
      type: "ordinary_income",
      amount: expect.closeTo(18_000, 2),
    });
  });

  it("an annuity that joins at its activation year still tracks basis across years", () => {
    // Same re-shelter arithmetic as the recurring-transfer test, shifted onto a
    // contract with `activationYear`. It is skipped by the pre-loop seed, so if
    // the activation-year join does not seed its contract state the transfer
    // path writes basis into a map entry that is then DROPPED, and the step
    // re-seeds from the original costBasis every year.
    const input = inputWithAnnuity(
      {
        productType: "myga",
        incomeMode: "none",
        taxTreatment: "non_qualified",
        costBasis: 190_000,
        annualFeePct: 0,
        rollupRatchets: false,
      },
      200_000,
      {
        planEndYear: 2028,
        annuityGrowthRate: 0.20,
        checkingValue: 200_000,
        annuityAccountOverrides: { activationYear: 2027 },
        transfers: [
          {
            id: "xfer-1",
            name: "Annuity to brokerage",
            sourceAccountId: ANNUITY_ID,
            targetAccountId: "acc-brokerage",
            amount: 60_000,
            mode: "recurring",
            startYear: 2027,
            endYear: 2028,
            growthRate: 0,
            schedules: [],
          },
        ],
        extraAccounts: [
          {
            id: "acc-brokerage",
            name: "Brokerage",
            category: "taxable",
            subType: "brokerage",
            titlingType: "jtwros",
            value: 0,
            basis: 0,
            growthRate: 0,
            rmdEnabled: false,
            owners: [
              { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
            ],
          },
        ],
      },
    );
    const years = runProjection(input);
    const y2026 = years.find((y) => y.year === 2026)!;
    const y2027 = years.find((y) => y.year === 2027)!;
    const y2028 = years.find((y) => y.year === 2028)!;

    // GUARD: the contract genuinely does not exist before 2027.
    expect(y2026.portfolioAssets.annuityTotal).toBe(0);
    expect(y2027.portfolioAssets.annuityTotal).toBeCloseTo(180_000, 2);

    const ordinary = (y: (typeof y2027)) =>
      y.taxDetail!.bySource["transfer:xfer-1"]?.amount ?? 0;
    expect(ordinary(y2027)).toBeCloseTo(50_000, 2);
    expect(ordinary(y2028)).toBeCloseTo(36_000, 2);
    expect(ordinary(y2028)).toBeGreaterThan(26_000);
  });

  it("the annual contract fee is charged ON TOP of the projection's own growth", () => {
    // The one behaviour the "accountBalances is authoritative" design changed,
    // and the reason every OTHER test here sets annualFeePct to 0: once the
    // generic growth pass owns market return, the fee is the ONLY thing the
    // contract still applies to the account value.
    //
    //   2026: 200,000 × 1.06 (growth pass) × 0.98 (contract fee) = 207,760
    //   2027: 207,760 × 1.06 × 0.98                              = 215,821.088
    //
    // Handing the contract `acct.growthRate` instead of 0 would grow the
    // balance twice and give 220,480 in 2026; ignoring the fee gives 212,000.
    const input = inputWithAnnuity(
      {
        productType: "myga",
        incomeMode: "none",
        taxTreatment: "non_qualified",
        costBasis: 200_000,
        annualFeePct: 0.02,
        rollupRatchets: false,
      },
      200_000,
      { planEndYear: 2027, annuityGrowthRate: 0.06 },
    );
    const years = runProjection(input);
    const y2026 = years.find((y) => y.year === 2026)!;
    const y2027 = years.find((y) => y.year === 2027)!;

    expect(y2026.portfolioAssets.annuityTotal).toBeCloseTo(207_760, 6);
    expect(y2027.portfolioAssets.annuityTotal).toBeCloseTo(215_821.088, 6);

    // The fee is booked on the account's own ledger, under its own label — a
    // fee year pays no income, so it must not read as a distribution.
    const feeEntry = y2026.accountLedgers[ANNUITY_ID]?.entries.find(
      (e) => e.label === "Annuity contract fee (Deferred Annuity)",
    );
    expect(feeEntry).toBeDefined();
    expect(feeEntry!.amount).toBeCloseTo(-4_240, 6); // 212,000 × 2%
    expect(feeEntry!.basis).toBe(0);
  });

  it("a pure return of basis is booked tax-free, lands in Other Inflows, and hits the ledger", () => {
    // Value == basis, so LIFO finds no gain and every dollar of rider income is
    // a §72 return of basis: the `annuity_tax_free:` key, not the taxable one.
    const input = inputWithAnnuity(
      {
        productType: "fixed_indexed",
        incomeMode: "rider",
        incomeStartYear: 2026,
        benefitBase: 200_000,
        payoutPct: 0.05,
        rollupRatchets: false,
        taxTreatment: "non_qualified",
        costBasis: 200_000,
        annualFeePct: 0,
      },
      200_000,
      { planEndYear: 2026 },
    );
    const y = runProjection(input).find((y) => y.year === 2026)!;

    expect(y.taxDetail!.bySource[`annuity_tax_free:${ANNUITY_ID}`]).toEqual({
      type: "non_taxable",
      amount: 10_000,
    });
    expect(y.taxDetail!.bySource[ANNUITY_KEY]).toBeUndefined();
    // Non-taxable by construction: year-tax derives it as totalIncome − taxableIncome.
    expect(y.taxResult!.income.ordinaryIncome).toBe(0);
    expect(y.taxResult!.flow.totalTax).toBe(0);

    // Gross cash is household income, bucketed as OTHER — the cash-flow surplus
    // has to see it, and it is not salary, SS, or a capital gain.
    expect(y.income.other).toBeCloseTo(10_000, 2);
    expect(y.income.total).toBeCloseTo(10_000, 2);

    // Source ledger: the contract paid out and the balance fell to match.
    const annLedger = y.accountLedgers[ANNUITY_ID];
    expect(annLedger.distributions).toBeCloseTo(10_000, 2);
    expect(annLedger.endingValue).toBeCloseTo(190_000, 2);
    const payout = annLedger.entries.find(
      (e) => e.label === "Annuity distribution from Deferred Annuity",
    );
    expect(payout).toBeDefined();
    expect(payout!.amount).toBeCloseTo(-10_000, 2);
    expect(payout!.basis).toBe(0); // annuity basis lives on the contract, not basisMap

    // Destination ledger: the cash really reached household checking.
    const cashEntry = y.accountLedgers[CHECKING_ID]?.entries.find(
      (e) => e.label === "Annuity income from Deferred Annuity",
    );
    expect(cashEntry).toBeDefined();
    expect(cashEntry!.amount).toBeCloseTo(10_000, 2);
  });

  it("an RMD out of an annuity account reaches the state exclusion", () => {
    // `rmdEnabled` has no category gate, so an RMD-enabled annuity IS
    // constructible. Its RMD is keyed `<id>:rmd`, and an annuity is classified
    // by CATEGORY — its subTypes are product names, so the ira/k401 subType
    // tests can never reach it.
    const input = inputWithAnnuity(
      {
        productType: "qlac",
        incomeMode: "none",
        taxTreatment: "qualified", // pre-tax wrapper: the whole RMD is ordinary
        annualFeePct: 0,
        rollupRatchets: false,
      },
      500_000,
      { planEndYear: 2026, annuityAccountOverrides: { rmdEnabled: true } },
    );
    const y = runProjection(input).find((y) => y.year === 2026)!;

    // GUARD: an RMD was actually taken (age 74, past the age-73 trigger).
    const rmd = y.taxDetail!.bySource[`${ANNUITY_ID}:rmd`];
    expect(rmd?.type).toBe("ordinary_income");
    expect(rmd!.amount).toBeGreaterThan(0);

    // Illinois exempts annuity income; the RMD must land in the annuity bucket.
    const state = y.taxResult!.state!;
    expect(state.subtractions.retirementIncome).toBeCloseTo(rmd!.amount, 2);
    expect(state.stateTax).toBe(0);
  });

  it("an entity-owned contract routes its cash to the ENTITY, not the 1040", () => {
    // §72(u) taxes a non-natural owner at the entity level, which this engine
    // does not model. The contract must still step (so the balance sheet
    // reconciles) but none of it may reach household income or household tax.
    const TRUST_ID = "trust-1";
    const TRUST_CASH = "trust-checking";
    const entityOwners = [
      { kind: "entity" as const, entityId: TRUST_ID, percent: 1 },
    ];
    const input = inputWithAnnuity(
      {
        productType: "fixed_indexed",
        incomeMode: "rider",
        incomeStartYear: 2026,
        benefitBase: 200_000,
        payoutPct: 0.05,
        rollupRatchets: false,
        taxTreatment: "non_qualified",
        costBasis: 0, // every dollar would be ordinary income IF it were the household's
        annualFeePct: 0,
      },
      200_000,
      {
        planEndYear: 2026,
        annuityAccountOverrides: { owners: entityOwners },
        entities: [
          {
            id: TRUST_ID,
            name: "Family Trust",
            includeInPortfolio: false,
            isGrantor: false,
            isIrrevocable: true,
            entityType: "trust",
          },
        ],
        extraAccounts: [
          {
            id: TRUST_CASH,
            name: "Trust Checking",
            category: "cash",
            subType: "checking",
            titlingType: "jtwros",
            value: 0,
            basis: 0,
            growthRate: 0,
            rmdEnabled: false,
            isDefaultChecking: true,
            owners: entityOwners,
          },
        ],
      },
    );
    const y = runProjection(input).find((y) => y.year === 2026)!;

    // Nothing on the household side: no income, no tax row, no exclusion.
    expect(y.income.total).toBe(0);
    expect(y.income.bySource[ANNUITY_KEY]).toBeUndefined();
    expect(y.taxDetail!.bySource[ANNUITY_KEY]).toBeUndefined();
    expect(y.taxDetail!.bySource[`annuity_tax_free:${ANNUITY_ID}`]).toBeUndefined();

    // GUARD: the contract really did pay — otherwise "no household income"
    // would be satisfied by a contract that simply never ran.
    expect(y.accountLedgers[ANNUITY_ID].endingValue).toBeCloseTo(190_000, 2);

    // The cash landed in the TRUST's checking.
    const trustEntry = y.accountLedgers[TRUST_CASH]?.entries.find(
      (e) => e.label === "Annuity income from Deferred Annuity",
    );
    expect(trustEntry).toBeDefined();
    expect(trustEntry!.amount).toBeCloseTo(10_000, 2);
  });

  it("a death stops a single-life rider but NOT a certain term", () => {
    // Two runs of the same contract in the same dying household, differing only
    // in payout structure. Both share every other question — does the account
    // still exist after the final death, is it still in workingAccounts — so
    // any DIFFERENCE between them can only come from the isAlive resolution
    // reaching `stepAnnuityYear`. Nothing else in this suite lets a death
    // happen inside the plan.
    const run = (structure: "single_life" | "period_certain") =>
      runProjection(
        inputWithAnnuity(
          {
            productType: "fixed_indexed",
            incomeMode: "rider",
            incomeStartYear: 2026,
            payoutStructure: structure,
            periodCertainYears: structure === "period_certain" ? 20 : undefined,
            benefitBase: 200_000,
            payoutPct: 0.05,
            rollupRatchets: false,
            taxTreatment: "non_qualified",
            costBasis: 0,
            annualFeePct: 0,
          },
          200_000,
          // Married, and the CLIENT (who owns the contract) dies first in 2028.
          // A single filer's death ends the projection outright — no years are
          // emitted afterwards to observe — so only a first death can show
          // this. The spouse's life expectancy defaults to 95 (born 1975), well
          // past the horizon, so the plan runs on.
          { planEndYear: 2031, lifeExpectancy: 76, spouseDob: "1975-01-01" },
        ),
      );
    const at = (years: ReturnType<typeof runProjection>, yr: number) =>
      years.find((y) => y.year === yr)?.income.bySource[ANNUITY_KEY] ?? 0;

    const singleLife = run("single_life");
    const certain = run("period_certain");

    // Alive years are identical — the structures only diverge at death.
    expect(at(singleLife, 2027)).toBeCloseTo(10_000, 2);
    expect(at(certain, 2027)).toBeCloseTo(10_000, 2);
    // The death year itself is still paid: death events apply below years.push().
    expect(at(singleLife, 2028)).toBeCloseTo(10_000, 2);

    // After death: a life-contingent payout owes nothing more...
    expect(at(singleLife, 2029)).toBe(0);
    expect(at(singleLife, 2030)).toBe(0);
    // ...but a certain term runs on to the beneficiary. Stopping it would drop
    // money the contract still owes.
    expect(at(certain, 2029)).toBeCloseTo(10_000, 2);
    expect(at(certain, 2030)).toBeCloseTo(10_000, 2);
  });
});
