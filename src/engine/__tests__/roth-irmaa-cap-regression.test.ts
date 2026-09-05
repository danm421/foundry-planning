/**
 * IRMAA cap regression guard — an explicitly NULL cap is indistinguishable from
 * an ABSENT one.
 *
 * ⚠️ READ THIS BEFORE CITING THIS FILE. Both runs execute THIS branch, so a
 * pass proves exactly one thing: on a household where the cap demonstrably
 * COULD bite, `irmaaCapTier: null` projects identically to a conversion with no
 * `irmaaCapTier` key at all. That is worth pinning — every saved plan, API
 * payload and frozen scenario snapshot written before this feature omits the
 * field entirely, and the two spellings enter the engine at two separate places
 * (`resolveIrmaaCeiling`'s first line, projection.ts:4953, and the phase-5b vs
 * phase-12 routing test at :5169). Either could drift apart on its own.
 *
 * It is NOT a proof that this branch is byte-compatible with the pre-branch
 * engine, and it must not be cited as one. This branch deliberately ADDED
 * fields that now appear on every plan with a bracket fill (`requested`,
 * `limitedBy`, and new `taxDetail.bySource` keys); a pre-branch snapshot does
 * not carry them, so a diff against one would light up everywhere and read as a
 * regression that is not one. That is why the comparison is two runs on this
 * branch rather than a stored baseline.
 *
 * ⚠️ WHY THE FIXTURE IS BUILT HERE AND NOT REUSED.
 * The cap only exists in BRACKET tax mode with somebody enrolled in the premium
 * year. `projection.medicare.test.ts` is Medicare-rich but runs FLAT, where the
 * cap is inert by design; `projection-roth-fill-bracket.test.ts` is bracket-mode
 * but carries no Medicare parameters at all. On either of those a null-cap guard
 * would pass for the wrong reason forever — an inert cap is byte-identical to no
 * cap BY CONSTRUCTION. So this fixture mirrors `roth-irmaa-cap.test.ts` (the one
 * bracket-mode, Medicare-covered household in the suite) and then makes it
 * richer: RMDs already running, a supplemental draw against a taxable account,
 * and two conversions that route down DIFFERENT arms of the code the feature
 * touched — a `fill_up_bracket` through the phase-12 joint solve and a
 * `fixed_amount` through phase 5b.
 *
 * ⚠️ HOW TO CHECK THIS GUARD STILL HAS TEETH. Set `irmaaCapTier: 0` on the
 * second run. The 2028 MFJ tier-0 ceiling is ~$224.9K against a 24% bracket top
 * of ~$383.9K, so the conversions must collapse and the equality must FAIL. If
 * it passes while mutated, the fixture stopped making the cap bite (mode,
 * enrollment, or premium-year parameters) — fix the fixture, do not weaken the
 * assertion.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ClientData, FamilyMember, MedicareCoverage, RothConversion } from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";

const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const SPOUSE_FM_ID = "00000000-0000-0000-0000-000000000002";

// CMS 2025 tiers, copied from `roth-irmaa-cap.test.ts` (which sourced them from
// `data/medicare-irmaa-2024-2026.json`). TAX_YEAR_2026 carries no Medicare
// fields, so the four the cap needs are spread on here.
const IRMAA_TIERS_SINGLE_2025 = [
  { tier: 1, magiLowerBound: 106000, magiUpperBound: 133000, partBSurcharge: 888.0,  partDSurcharge: 164.4 },
  { tier: 2, magiLowerBound: 133000, magiUpperBound: 167000, partBSurcharge: 2220.0, partDSurcharge: 425.4 },
  { tier: 3, magiLowerBound: 167000, magiUpperBound: 200000, partBSurcharge: 3552.0, partDSurcharge: 686.4 },
  { tier: 4, magiLowerBound: 200000, magiUpperBound: 500000, partBSurcharge: 4884.0, partDSurcharge: 947.4 },
  { tier: 5, magiLowerBound: 500000, magiUpperBound: null,   partBSurcharge: 5326.8, partDSurcharge: 1034.4 },
];

const IRMAA_TIERS_MFJ_2025 = [
  { tier: 1, magiLowerBound: 212000, magiUpperBound: 266000, partBSurcharge: 888.0,  partDSurcharge: 164.4 },
  { tier: 2, magiLowerBound: 266000, magiUpperBound: 334000, partBSurcharge: 2220.0, partDSurcharge: 425.4 },
  { tier: 3, magiLowerBound: 334000, magiUpperBound: 400000, partBSurcharge: 3552.0, partDSurcharge: 686.4 },
  { tier: 4, magiLowerBound: 400000, magiUpperBound: 750000, partBSurcharge: 4884.0, partDSurcharge: 947.4 },
  { tier: 5, magiLowerBound: 750000, magiUpperBound: null,   partBSurcharge: 5326.8, partDSurcharge: 1034.4 },
];

const TAX_YEAR_2026_WITH_MEDICARE: TaxYearParameters = {
  ...TAX_YEAR_2026,
  standardPartBPremium: 2220.0,
  partDNationalBase: 441.36,
  irmaaBracketsMfj: IRMAA_TIERS_MFJ_2025,
  irmaaBracketsSingle: IRMAA_TIERS_SINGLE_2025,
};

const PLAN_START_YEAR = 2026;
const PLAN_END_YEAR = 2030;

function coverage(owner: "client" | "spouse"): MedicareCoverage {
  return {
    owner,
    enrollmentYear: null, // → the engine enrolls the year the owner turns 65
    coverageType: "original",
    medigapMonthlyAt65: 170,
    partDPlanMonthlyAt65: 46,
    priorYearMagi: 200_000, // cold-start lookback for the first two years
  };
}

/** A retired MFJ household, deliberately built so that every code path the
 *  IRMAA cap touched is live:
 *
 *  - BRACKET tax mode with a Medicare-bearing tax year row, so a cap COULD
 *    resolve (in flat mode, or with no Medicare parameters, it never can and
 *    this guard would be vacuous).
 *  - Both spouses well past 65, so somebody is enrolled in every premium year.
 *  - Client born 1952 → RMD start age 73, reached in 2025, so the $3M IRA is
 *    already distributing on day one of the plan.
 *  - Expenses above income, so a supplemental draw runs against the taxable
 *    brokerage and realizes capital gains — the `suppOrdinary` / `suppCapGains`
 *    inputs the cap's sizer takes.
 *  - Two conversions that route differently: `rc-fill` (fill_up_bracket) goes
 *    to the phase-12 joint solve, `rc-fixed` (fixed_amount) to phase 5b.
 *
 *  A FACTORY, not a shared constant: each run gets its own object graph so the
 *  second projection can never inherit state from the first.
 */
function baseFixture(): ClientData {
  return {
    client: {
      firstName: "Null",
      lastName: "Cap",
      dateOfBirth: "1952-01-01", // 74 in 2026 — enrolled, and past RMD age
      spouseDob: "1954-01-01", // 72 in 2026 — enrolled, RMDs begin 2027
      filingStatus: "married_joint",
      retirementAge: 65,
      planEndAge: 95,
      spouseRetirementAge: 65,
      lifeExpectancy: 95, // no death inside the plan window
      spouseLifeExpectancy: 95,
    },
    accounts: [
      {
        id: "acc-checking",
        name: "Checking",
        category: "cash",
        subType: "checking",
        titlingType: "jtwros",
        value: 150_000,
        basis: 150_000,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 0.5 },
          { kind: "family_member", familyMemberId: SPOUSE_FM_ID, percent: 0.5 },
        ],
      },
      {
        // Funds the supplemental draw. Embedded gain is 40% of value, so every
        // dollar drawn realizes capital gains and moves AGI.
        id: "acc-brokerage",
        name: "Joint Brokerage",
        category: "taxable",
        subType: "brokerage",
        titlingType: "jtwros",
        value: 1_500_000,
        basis: 900_000,
        growthRate: 0.05,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 0.5 },
          { kind: "family_member", familyMemberId: SPOUSE_FM_ID, percent: 0.5 },
        ],
      },
      {
        id: "acc-ira",
        name: "Trad IRA",
        category: "retirement",
        subType: "traditional_ira",
        titlingType: "jtwros",
        value: 3_000_000,
        basis: 0,
        growthRate: 0.05,
        rmdEnabled: true,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
      {
        id: "acc-roth",
        name: "Roth IRA",
        category: "retirement",
        subType: "roth_ira",
        titlingType: "jtwros",
        value: 100_000,
        basis: 100_000,
        growthRate: 0.05,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
    ],
    incomes: [
      {
        id: "inc-pension",
        type: "deferred",
        name: "Pension",
        annualAmount: 45_000,
        startYear: PLAN_START_YEAR,
        endYear: PLAN_END_YEAR,
        growthRate: 0.02,
        owner: "client",
        taxType: "ordinary_income",
      },
    ],
    expenses: [
      {
        id: "exp-living",
        type: "living",
        name: "Living",
        annualAmount: 180_000,
        startYear: PLAN_START_YEAR,
        endYear: PLAN_END_YEAR,
        growthRate: 0.025,
        cashAccountId: "acc-checking",
      },
    ],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [
      {
        accountId: "acc-brokerage",
        priorityOrder: 1,
        startYear: PLAN_START_YEAR,
        endYear: PLAN_END_YEAR,
      },
    ],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0.025,
      planStartYear: PLAN_START_YEAR,
      planEndYear: PLAN_END_YEAR,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    entities: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    giftEvents: [],
    wills: [],
    // ⚠️ NEITHER conversion carries an `irmaaCapTier` key at all. That absence
    // is the control half of this guard — do not add one here.
    rothConversions: [
      {
        id: "rc-fill",
        name: "Fill the 24% bracket",
        destinationAccountId: "acc-roth",
        sourceAccountIds: ["acc-ira"],
        conversionType: "fill_up_bracket",
        fillUpBracket: 0.24,
        // Required by the type and ignored by this strategy — the amount is
        // solved, not stated.
        fixedAmount: 0,
        startYear: PLAN_START_YEAR,
        endYear: PLAN_END_YEAR,
        indexingRate: 0,
      },
      {
        id: "rc-fixed",
        name: "Fixed annual conversion",
        destinationAccountId: "acc-roth",
        sourceAccountIds: ["acc-ira"],
        conversionType: "fixed_amount",
        fixedAmount: 100_000,
        startYear: PLAN_START_YEAR,
        endYear: PLAN_END_YEAR,
        indexingRate: 0.02,
      },
    ] satisfies RothConversion[],
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Null",
        lastName: "Cap",
        relationship: "other",
        role: "client",
        dateOfBirth: "1952-01-01",
      } as FamilyMember,
      {
        id: SPOUSE_FM_ID,
        firstName: "Partner",
        lastName: "Cap",
        relationship: "other",
        role: "spouse",
        dateOfBirth: "1954-01-01",
      } as FamilyMember,
    ],
    externalBeneficiaries: [],
    medicareCoverage: [coverage("client"), coverage("spouse")],
    medicarePremiumInflationEnabled: true,
    medicarePremiumInflationRate: 0.03,
    taxYearRows: [TAX_YEAR_2026_WITH_MEDICARE],
  } as ClientData;
}

describe("IRMAA cap regression", () => {
  it("exercises the paths the cap feature touched", () => {
    // Anti-vacuity. Deep equality between two runs of a household the cap can
    // never reach would pass forever while proving nothing, so pin the four
    // properties that make the comparison meaningful.
    const years = runProjection(baseFixture());
    expect(years.map((y) => y.year)).toEqual([2026, 2027, 2028, 2029, 2030]);

    for (const y of years) {
      // 1. BRACKET mode. ⚠️ `expect(y.taxResult).toBeDefined()` does NOT test
      //    this — projection.ts assigns `taxResult` unconditionally and
      //    `calculateTaxYearFlat` returns a fully-populated one too. Assert
      //    something flat mode cannot produce instead. `belowLineDeductions` is
      //    hard-coded to 0 in the flat calculator (engine/tax.ts, the `flow`
      //    block), so a positive value can only be the bracket engine applying
      //    a real standard deduction from the seeded tax-year row — and unlike
      //    a tax figure it does not depend on this fixture's flat rates being
      //    zero. The tax assertion then confirms the household is genuinely
      //    taxed rather than sitting at a degenerate zero.
      expect(
        y.taxResult?.flow.belowLineDeductions ?? 0,
        `${y.year} should apply a real deduction — flat mode always books 0`,
      ).toBeGreaterThan(0);
      expect(
        y.taxResult?.flow.totalFederalTax ?? 0,
        `${y.year} should owe federal tax — flat mode at a 0% rate owes none`,
      ).toBeGreaterThan(0);
      // 2. Medicare-enrolled, including in 2028 (the premium year for the first
      //    conversion) — no enrollment means no ceiling ever resolves.
      expect(y.medicare?.client?.enrolled, `client enrolled in ${y.year}`).toBe(true);
      expect(y.medicare?.spouse?.enrolled, `spouse enrolled in ${y.year}`).toBe(true);
      // 3. RMDs already running against the conversion's source IRA.
      expect(
        y.accountLedgers["acc-ira"]?.rmdAmount ?? 0,
        `${y.year} should take an RMD`,
      ).toBeGreaterThan(0);
    }

    // 4. The supplemental draw against the TAXABLE brokerage — the source of
    //    the `suppOrdinary` / `suppCapGains` inputs the cap's sizer takes.
    //    Pinned BY ACCOUNT, not with `withdrawals.total > 0`: the total also
    //    counts a plain checking sweep, which realizes no gain and exercises
    //    none of that path.
    //
    //    ⚠️ 2026 is deliberately NOT in this list, and that is a feature. The
    //    $150K opening checking balance plus the RMD and pension cover that
    //    year's spend outright, which is what keeps 2026's cap arithmetic
    //    hand-checkable: the tier-0 target is exactly `ceiling − (pension +
    //    RMD)`, with no capital-gains term to muddy it. From 2027 the brokerage
    //    funds the shortfall and realized gain enters AGI. Asserting the EXACT
    //    set catches the draw both vanishing and appearing where it should not.
    const brokerageDrawYears = years.filter(
      (y) => (y.withdrawals.byAccount["acc-brokerage"] ?? 0) > 0,
    );
    expect(
      brokerageDrawYears.map((y) => y.year),
      "the brokerage must fund the shortfall from 2027 on",
    ).toEqual([2027, 2028, 2029, 2030]);
    for (const y of brokerageDrawYears) {
      expect(
        y.taxResult?.flow.capitalGainsTax ?? 0,
        `${y.year}'s brokerage draw should realize TAXED gain, not just move cash`,
      ).toBeGreaterThan(0);
    }

    // Both conversions actually convert, down both routing arms.
    const y2026 = years.find((y) => y.year === 2026)!;
    const byId = Object.fromEntries((y2026.rothConversions ?? []).map((c) => [c.id, c]));
    expect(byId["rc-fill"]?.gross, "the bracket fill converts").toBeGreaterThan(0);
    expect(byId["rc-fixed"]?.gross, "the fixed amount converts").toBeGreaterThan(0);
  });

  it("produces an identical projection when every cap is null", () => {
    const withoutField = runProjection(baseFixture());

    const capped = baseFixture();
    // Self-contained non-emptiness guard. An empty `rothConversions` would make
    // the `.map` below a no-op and the equality trivially true, and this `it`
    // must not depend on a sibling test that could be skipped or deleted.
    expect(capped.rothConversions!.length, "both conversions must be present").toBe(2);
    const withNullField = runProjection({
      ...capped,
      rothConversions: capped.rothConversions!.map((c) => ({ ...c, irmaaCapTier: null })),
    });

    // The WHOLE year array, not a summary figure — a summary can agree while a
    // component moved. `toStrictEqual`, not `toEqual`: this branch added
    // OPTIONAL fields, and `toEqual` treats `{ limitedBy: undefined }` as equal
    // to a missing key. That is exactly the asymmetry two runs of the same
    // engine could develop, so it must not be forgiven.
    expect(withNullField).toStrictEqual(withoutField);
  });
});
