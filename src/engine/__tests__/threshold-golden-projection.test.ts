/**
 * Task 14a — the GOLDEN phase-out projection.
 *
 * `threshold-household.test.ts` proves each gate is WIRED, one fixture per
 * gate, one year per fixture. This file proves the whole chain MOVES: one
 * household, one `runProjection` call, seven years, and every one of the five
 * items the plan names observed on BOTH sides of a state change with the flip
 * year named.
 *
 * Two design decisions make the crossings attributable rather than merely
 * present:
 *
 *  1. **The statutory bands are pinned FLAT across the horizon.** A tax row is
 *     supplied for every year of the plan, all with identical bounds, so
 *     `resolver.getYear` takes the exact-match branch and never inflates. A
 *     status that changes therefore changed because the HOUSEHOLD moved, never
 *     because indexation slid a band underneath it. (Seed 2026 alone and every
 *     out-year's bands drift by `taxInflationRate`, which would make every
 *     figure below approximate and every crossing ambiguous.)
 *  2. **Nothing grows.** Every account is at 0%, there are no realizations, no
 *     Social Security and no capital gains, so `taxableIncome` is exactly the
 *     year's salary and every MAGI below it is an exact figure derived from the
 *     statute rather than read back off the engine.
 *
 * THE HOUSEHOLD (the plan brief's, verbatim): MFJ, $450,000 of income, two
 * children under 17, one college-age student with an active education goal, one
 * student loan, both a Roth and a traditional IRA savings rule, one covered
 * spouse.
 *
 * THE INCOME PATH (mine — the brief specifies no horizon). The client's earned
 * income stops after 2027; the SPOUSE keeps working, and keeps the 401(k)
 * deferral that makes them the covered participant, for the whole horizon. That
 * is what makes the IRA-deduction crossing MAGI-driven: if the spouse's plan
 * stopped too, `coveredSpouse` would go false and the deduction would survive
 * because IRC 219(g)(1) never triggered, not because the MAGI fell. Every year
 * asserts `coveredSelf === false && coveredSpouse === true` for exactly that
 * reason.
 *
 *   year   client sal   spouse sal   household     magiBase
 *   2026     247,500      202,500      450,000      430,000
 *   2027     247,500      202,500      450,000      430,000
 *   2028+          0      202,500      202,500      182,500
 *
 * FOUR CROSSINGS, each on its own year boundary so none is confounded:
 *   2027→2028  the income step        — Roth, IRA deduction, student loan, CTC
 *   2028→2029  the elder child turns 17 — qualifying children 2 → 1
 *   2029→2030  the AOTC 4-year counter exhausts — credit paid → 0
 *   2030→2031  the younger child turns 17 — qualifying children 1 → 0
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { statusFor } from "../../lib/tax/thresholds";
import type { ThresholdItemId, ThresholdStatus } from "../../lib/tax/thresholds";
import type {
  Account,
  ClientData,
  ClientInfo,
  Expense,
  FamilyMember,
  Income,
  Liability,
  PlanSettings,
  ProjectionYear,
  SavingsRule,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

const PLAN_START = 2026;
const PLAN_END = 2032;
const HORIZON = [2026, 2027, 2028, 2029, 2030, 2031, 2032];

// ── Statutory bands, held FLAT for every year of the horizon ────────────────
// 2025 values (Notice 2024-80) for the indexed bands; the unindexed ones
// (IRC 24(b), 25A, 221(b)(1)) live in `STATUTORY_FIXED` and are not repeated.
function paramsForYear(year: number): TaxYearParameters {
  return {
    year,
    incomeBrackets: {
      married_joint: [
        { from: 0, to: 24800, rate: 0.10 },
        { from: 24800, to: 100800, rate: 0.12 },
        { from: 100800, to: null, rate: 0.22 },
      ],
      single: [{ from: 0, to: null, rate: 0.10 }],
      head_of_household: [{ from: 0, to: null, rate: 0.10 }],
      married_separate: [{ from: 0, to: null, rate: 0.10 }],
    },
    capGainsBrackets: {
      married_joint: { zeroPctTop: 94050, fifteenPctTop: 583750 },
      single: { zeroPctTop: 47025, fifteenPctTop: 518900 },
      head_of_household: { zeroPctTop: 63000, fifteenPctTop: 551350 },
      married_separate: { zeroPctTop: 47025, fifteenPctTop: 291850 },
    },
    trustIncomeBrackets: [],
    trustCapGainsBrackets: [],
    stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 21900, married_separate: 15000 },
    amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
    amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
    amtPhaseoutStart: { mfj: 1237450, singleHoh: 618700, mfs: 618725 },
    ssTaxRate: 0.062,
    ssWageBase: 176100,
    medicareTaxRate: 0.0145,
    addlMedicareRate: 0.009,
    addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    niitRate: 0.038,
    niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    qbi: {
      thresholdMfj: 383900,
      thresholdSingleHohMfs: 191950,
      phaseInRangeMfj: 100000,
      phaseInRangeOther: 50000,
    },
    rothPhaseout: { startMfj: 236000, endMfj: 246000, startSingle: 150000, endSingle: 165000 },
    iraDeduct: {
      coveredStartMfj: 129000, coveredEndMfj: 149000,
      coveredStartSingle: 81000, coveredEndSingle: 91000,
      spousalStartMfj: 242000, spousalEndMfj: 252000,
    },
    studentLoan: { maxDeduction: 2500, startMfj: 170000, endMfj: 200000, startSingle: 85000, endSingle: 100000 },
    ctc: { perChild: 2000, refundableMax: 1700, odcPerDependent: 500 },
    saversCredit: {
      mfj: [{ rate: 0.5, agiCeiling: 48000 }, { rate: 0.2, agiCeiling: 52000 }, { rate: 0.1, agiCeiling: 80000 }],
      single: [{ rate: 0.5, agiCeiling: 24000 }, { rate: 0.2, agiCeiling: 26000 }, { rate: 0.1, agiCeiling: 40000 }],
      hoh: [{ rate: 0.5, agiCeiling: 36000 }, { rate: 0.2, agiCeiling: 39000 }, { rate: 0.1, agiCeiling: 60000 }],
    },
    contribLimits: {
      ira401kElective: 23500,
      ira401kCatchup50: 7500,
      ira401kCatchup6063: 11250,
      iraTradLimit: 7000,
      iraCatchup50: 1000,
      simpleLimitRegular: 17000,
      simpleCatchup50: 4000,
      hsaLimitSelf: 4400,
      hsaLimitFamily: 8750,
      hsaCatchup55: 1000,
    },
  };
}

const TAX_ROWS: TaxYearParameters[] = HORIZON.map(paramsForYear);

// ── The household ──────────────────────────────────────────────────────────

const CLIENT: ClientInfo = {
  firstName: "Ada",
  lastName: "Kern",
  dateOfBirth: "1985-03-02",   // 41 in 2026; never 50 inside the horizon, so
  retirementAge: 65,           // the IRA catch-up never widens the cap
  planEndAge: 90,
  filingStatus: "married_joint",
  spouseName: "Blaise",
  spouseDob: "1986-07-19",     // 40 in 2026
  spouseRetirementAge: 65,
};

// `resolveAgeInYear` is `year - Number(dob.slice(0,4))`, so the birth MONTH is
// irrelevant and each age below is exact.
const CHILD_ELDER: FamilyMember = {
  id: "fm-child-elder", role: "child", relationship: "child",
  firstName: "Cy", lastName: "Kern", dateOfBirth: "2012-04-18",  // 14 in 2026, 17 in 2029
};
const CHILD_YOUNGER: FamilyMember = {
  id: "fm-child-younger", role: "child", relationship: "child",
  firstName: "Del", lastName: "Kern", dateOfBirth: "2014-11-02", // 12 in 2026, 17 in 2031
};
// IRC 25A(g)(3) lets the PARENT claim the AOTC only for a student they claim as
// a dependent, so the student carries the override that the qualifying-child
// branch cannot infer for an over-17 child — which also makes them the
// household's one Other Dependent for the whole horizon.
const STUDENT: FamilyMember = {
  id: "fm-student", role: "child", relationship: "child",
  firstName: "Wren", lastName: "Kern", dateOfBirth: "2008-09-12", // 18 in 2026
  claimedAsDependent: "yes",
};

const FAMILY: FamilyMember[] = [
  { id: LEGACY_FM_CLIENT, role: "client", relationship: "other", firstName: "Ada", lastName: "Kern", dateOfBirth: "1985-03-02" },
  { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other", firstName: "Blaise", lastName: "Kern", dateOfBirth: "1986-07-19" },
  CHILD_ELDER,
  CHILD_YOUNGER,
  STUDENT,
];

function acct(over: Partial<Account> & Pick<Account, "id" | "category">): Account {
  return {
    name: over.id,
    subType: undefined,
    titlingType: "jtwros",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    ...over,
  } as Account;
}

const CHECKING = acct({
  id: "acct-checking", category: "cash", subType: "checking",
  value: 3_000_000, basis: 3_000_000, isDefaultChecking: true,
});
// The ONE workplace plan in the household, and it is the SPOUSE's. That is what
// "one covered spouse" means here: `resolveWorkplaceCoverage` infers
// coveredSpouse true and coveredSelf false with no override column touched, so
// IRC 219(g)(7)'s SPOUSAL range (242,000-252,000) governs, not the covered one.
const ACCT_401K_SPOUSE = acct({
  id: "acct-401k-spouse", category: "retirement", subType: "401k",
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
});
const ACCT_IRA = acct({ id: "acct-ira", category: "retirement", subType: "traditional_ira" });
const ACCT_ROTH = acct({ id: "acct-roth", category: "retirement", subType: "roth_ira" });

// Client 247,500 + spouse 202,500 = the brief's 450,000, and the client's stops
// after 2027.
const CLIENT_SALARY: Income = {
  id: "inc-salary-client", type: "salary", name: "Ada salary",
  annualAmount: 247_500, startYear: 2026, endYear: 2027, growthRate: 0, owner: "client",
};
const SPOUSE_SALARY: Income = {
  id: "inc-salary-spouse", type: "salary", name: "Blaise salary",
  annualAmount: 202_500, startYear: 2026, endYear: PLAN_END, growthRate: 0, owner: "spouse",
};

// 150,000 at 6.5% over 20 years accrues far more interest than IRC 221(b)(1)'s
// $2,500 ceiling in every year of the horizon — see the non-vacuity note on the
// student-loan block below for why the exact 1,875 assertion IS that guard.
const STUDENT_LOAN: Liability = {
  id: "liab-student", name: "Student Loan",
  balance: 150_000, interestRate: 0.065, monthlyPayment: 1_300,
  startYear: 2026, startMonth: 1, termMonths: 240,
  liabilityType: "student", isInterestDeductible: false,
  extraPayments: [], owners: [],
};

const EDUCATION_GOAL: Expense = {
  id: "exp-college", type: "education", name: "College",
  annualAmount: 40_000, startYear: 2026, endYear: 2031, growthRate: 0,
  forFamilyMemberId: STUDENT.id,
};

function rule(over: Partial<SavingsRule> & Pick<SavingsRule, "id" | "accountId" | "annualAmount">): SavingsRule {
  return { isDeductible: true, startYear: PLAN_START, endYear: PLAN_END, ...over };
}

// Client IRA bucket = 5,000 + 2,000 = 7,000, exactly `iraTradLimit`, so the
// age-cap pass scales nothing and every adjustment below is the Roth gate's.
const SAVINGS: SavingsRule[] = [
  rule({ id: "sav-401k-spouse", accountId: "acct-401k-spouse", annualAmount: 20_000 }),
  rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 5_000 }),
  rule({ id: "sav-roth", accountId: "acct-roth", annualAmount: 2_000 }),
];

const SETTINGS: PlanSettings = {
  flatFederalRate: 0.22,
  flatStateRate: 0,           // keeps SALT (and the whole below-line side) at 0
  inflationRate: 0.02,
  planStartYear: PLAN_START,
  planEndYear: PLAN_END,
  taxEngineMode: "bracket",
};

const GOLDEN: ClientData = {
  client: CLIENT,
  accounts: [CHECKING, ACCT_401K_SPOUSE, ACCT_IRA, ACCT_ROTH],
  incomes: [CLIENT_SALARY, SPOUSE_SALARY],
  expenses: [EDUCATION_GOAL],
  liabilities: [STUDENT_LOAN],
  savingsRules: SAVINGS,
  withdrawalStrategy: [],
  planSettings: SETTINGS,
  familyMembers: FAMILY,
  giftEvents: [],
  taxYearRows: TAX_ROWS,
};

// ── One projection, read seven ways ─────────────────────────────────────────

const YEARS: ProjectionYear[] = runProjection(GOLDEN);

const facts = (y: ProjectionYear) => y.thresholdFacts!;
const per = <T,>(read: (y: ProjectionYear) => T): T[] => YEARS.map(read);

/** `thresholdFacts` omits `params` (the report layer re-attaches it); the row
 *  put back here is the same object `resolver.getYear` handed the engine,
 *  because every horizon year has an exact-match row. */
const statuses = (item: ThresholdItemId): ThresholdStatus[] =>
  YEARS.map((y) => statusFor(item, { ...facts(y), params: paramsForYear(y.year) }));

// ════════════════════════════════════════════════════════════════════════════
// The fixture's own premises. Every one of these is load-bearing for a
// crossing below; if one silently stops holding, the crossing it supports
// starts passing for the wrong reason.
// ════════════════════════════════════════════════════════════════════════════

describe("golden fixture premises", () => {
  it("runs 2026-2032 in bracket mode with thresholdFacts on every year", () => {
    expect(per((y) => y.year)).toEqual(HORIZON);
    expect(per((y) => facts(y).year)).toEqual(HORIZON);
  });

  it("holds the statutory bands FLAT — no year's Roth band is inflated forward", () => {
    // The exact-match branch of `createTaxResolver`. Without a row per year the
    // resolver inflates from the latest seeded one and every band below drifts.
    expect(per((y) => y.taxResult!.diag.bracketsUsed.year)).toEqual(HORIZON);
  });

  it("keeps exactly ONE covered spouse, by inference, in every year", () => {
    // The IRA-deduction crossing is only MAGI-driven while this holds. Flip
    // `coveredSpouse` false and the deduction survives because IRC 219(g)(1)
    // never fired — a green test asserting nothing.
    expect(per((y) => facts(y).household.coveredSelf)).toEqual(HORIZON.map(() => false));
    expect(per((y) => facts(y).household.coveredSpouse)).toEqual(HORIZON.map(() => true));
  });

  it("keeps a Roth rule, a traditional-IRA rule and student-loan interest live throughout", () => {
    const all = HORIZON.map(() => true);
    expect(per((y) => facts(y).household.hasRothContribution)).toEqual(all);
    expect(per((y) => facts(y).household.hasTraditionalIraContribution)).toEqual(all);
    expect(per((y) => facts(y).household.hasStudentLoanInterest)).toEqual(all);
  });

  it("contributes the same dollars every year — only the TAX treatment moves", () => {
    // The Roth gate re-tags, it never reduces (IRC 408A: a disallowed direct
    // contribution still arrives, via conversion). If the contribution itself
    // moved across the crossing, the backdoor assertions below would be
    // measuring the wrong thing.
    expect(per((y) => y.savings.byAccount["acct-roth"])).toEqual(HORIZON.map(() => 2_000));
    expect(per((y) => y.savings.byAccount["acct-ira"])).toEqual(HORIZON.map(() => 5_000));
  });

  it("earns the brief's $450,000 through 2027 and $202,500 after", () => {
    expect(per((y) => y.income.salaries)).toEqual([
      450_000, 450_000, 202_500, 202_500, 202_500, 202_500, 202_500,
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The MAGI ladder — the input to all five crossings.
//
//   magiBase = salary - the spouse's 20,000 deferral (the only above-line
//              deduction that is neither the IRA one nor the student-loan one)
//     2026-27: 450,000 - 20,000 = 430,000
//     2028-32: 202,500 - 20,000 = 182,500
// ════════════════════════════════════════════════════════════════════════════

describe("the MAGI ladder across the crossing", () => {
  it("reports magiForIraDeduction = magiBase (IRC 219(g)(3)(A))", () => {
    expect(per((y) => facts(y).magiForIraDeduction)).toEqual([
      430_000, 430_000, 182_500, 182_500, 182_500, 182_500, 182_500,
    ]);
  });

  it("subtracts the surviving IRA deduction from the student-loan MAGI (IRC 221(b)(2)(C)(ii))", () => {
    // 2026-27 the IRA deduction is 0, so the two coincide; from 2028 it is
    // 5,000 and they diverge by exactly that.
    expect(per((y) => facts(y).magiForStudentLoan)).toEqual([
      430_000, 430_000, 177_500, 177_500, 177_500, 177_500, 177_500,
    ]);
  });

  it("adds the IRA deduction BACK for the Roth MAGI (IRC 408A(c)(3)(B)(i))", () => {
    // The asymmetry with the line above IS the statute, and 2028-2032 is where
    // it is observable: 182,500 vs 177,500. Collapsing the two reintroduces the
    // defect ruled on 2026-07-28.
    expect(per((y) => facts(y).magiForRoth)).toEqual([
      430_000, 430_000, 182_500, 182_500, 182_500, 182_500, 182_500,
    ]);
    expect(facts(YEARS[2]).magiForRoth - facts(YEARS[2]).magiForStudentLoan).toBe(5_000);
    // …and the Roth MAGI tracks the IRA one, which §408A borrows wholesale.
    expect(per((y) => facts(y).magiForRoth)).toEqual(per((y) => facts(y).magiForIraDeduction));
  });

  it("nets the surviving student-loan deduction out of the credit MAGI", () => {
    // 177,500 - 1,875 = 175,625 from 2028.
    expect(per((y) => facts(y).magiForCredits)).toEqual([
      430_000, 430_000, 175_625, 175_625, 175_625, 175_625, 175_625,
    ]);
  });

  it("reports the same figure as the report's `agi`", () => {
    // Pinned to LITERALS, and in its own `it`, for two separate reasons.
    //
    //  - `projection.ts` assigns `agi: thresholdInputs.magiForCredits`, so
    //    `expect(agi).toEqual(magiForCredits)` would be true BY CONSTRUCTION:
    //    an identity between two reads of one variable, which no change to the
    //    MAGI derivation could ever falsify. The literals make this an
    //    assertion about the VALUE instead.
    //  - Separated from the `magiForCredits` test above so a failure there
    //    cannot short-circuit this one. Two assertions in one `it` are not two
    //    covered assertions: the second never executes once the first throws.
    expect(per((y) => facts(y).agi)).toEqual([
      430_000, 430_000, 175_625, 175_625, 175_625, 175_625, 175_625,
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CROSSING 1 of 5 — Roth IRA contribution. Flip year: 2028.
// Band 236,000-246,000 on magiForRoth. 430,000 is past it; 182,500 is below it.
// ════════════════════════════════════════════════════════════════════════════

describe("crossing: the Roth contribution is re-tagged as a backdoor through 2027 and allowed from 2028", () => {
  it("re-tags the whole 2,000 in 2026-2027 and NOTHING from 2028", () => {
    expect(per((y) => y.contributionAdjustments?.backdoorByRuleId["sav-roth"])).toEqual([
      2_000, 2_000, undefined, undefined, undefined, undefined, undefined,
    ]);
  });

  it("stops emitting a contribution adjustment at all in the flip year", () => {
    // Below the band there is nothing to re-tag and nothing to cap, so the
    // whole block is absent — the shape the Thresholds report reads as "full".
    expect(per((y) => y.contributionAdjustments === undefined)).toEqual([
      false, false, true, true, true, true, true,
    ]);
    expect(
      YEARS[1].contributionAdjustments!.adjustments.filter((a) => a.reason === "roth_magi_backdoor"),
    ).toHaveLength(1);
  });

  it("renders out → full at 2028", () => {
    expect(statuses("rothIra")).toEqual([
      "out", "out", "full", "full", "full", "full", "full",
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CROSSING 2 of 5 — traditional-IRA deductibility. Flip year: 2028.
// The SPOUSAL band 242,000-252,000 governs (covered spouse, non-covered
// contributor). 430,000 is past it; 182,500 is below it.
// ════════════════════════════════════════════════════════════════════════════

describe("crossing: the traditional-IRA deduction is 0 through 2027 and fully deductible from 2028", () => {
  it("deducts the spouse's deferral alone until the flip year, then the IRA too", () => {
    // 20,000 = the 401(k) deferral only; 25,000 = it plus the whole 5,000 IRA
    // contribution. The contribution itself never changed (see the premises).
    expect(per((y) => y.deductionBreakdown!.aboveLine.retirementContributions)).toEqual([
      20_000, 20_000, 25_000, 25_000, 25_000, 25_000, 25_000,
    ]);
  });

  it("renders the SPOUSAL row out → full and leaves the covered row not-applicable", () => {
    // `iraDeductCovered` applies only when the CONTRIBUTOR is covered. Pinning
    // it "na" is what proves the crossing above ran through IRC 219(g)(7)'s
    // spousal band and not the much lower covered band, which 182,500 would
    // also be past — the two ranges disagree about this household, and only
    // the spousal one is right.
    expect(statuses("iraDeductSpousal")).toEqual([
      "out", "out", "full", "full", "full", "full", "full",
    ]);
    expect(statuses("iraDeductCovered")).toEqual(HORIZON.map(() => "na"));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CROSSING 3 of 5 — student-loan interest. Flip year: 2028.
// Band 170,000-200,000 on magiForStudentLoan. 430,000 is past it; 177,500 sits
// a quarter of the way in, so 75% of the $2,500 cap survives.
// ════════════════════════════════════════════════════════════════════════════

describe("crossing: student-loan interest goes out → PARTIAL at 2028", () => {
  it("deducts nothing through 2027 and exactly 1,875 after", () => {
    // NON-VACUITY: 1,875 is 2,500 x 0.75 — the STATUTORY CAP times the
    // surviving fraction. Were the year's accrued interest below the cap the
    // figure would be accrual x 0.75 and could not equal 1,875, so asserting
    // the exact number in every tail year IS the "the cap binds first" guard.
    expect(per((y) => y.deductionBreakdown!.aboveLine.studentLoanInterest)).toEqual([
      0, 0, 1_875, 1_875, 1_875, 1_875, 1_875,
    ]);
  });

  it("renders out → partial at 2028 — the one item that lands mid-band", () => {
    expect(statuses("studentLoanInterest")).toEqual([
      "out", "out", "partial", "partial", "partial", "partial", "partial",
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CROSSING 4 of 5 — the Child Tax Credit. TWO independent flips.
//   2028: the MAGI falls below the 400,000 MFJ threshold  → partial → full
//   2029 and 2031: each child turns 17                    → 2 → 1 → 0
// ════════════════════════════════════════════════════════════════════════════

describe("crossing: the CTC is partially phased through 2027, whole from 2028, then the children age out", () => {
  it("counts the qualifying children down as they turn 17, and the student as the one ODC", () => {
    expect(per((y) => facts(y).household.qualifyingChildren)).toEqual([2, 2, 2, 1, 1, 0, 0]);
    expect(per((y) => facts(y).household.otherDependents)).toEqual(HORIZON.map(() => 1));
  });

  it("reduces the credit by exactly $50 per $1,000 over 400,000 in 2026-2027", () => {
    // IRC 24(b): gross 2 x 2,000 + 1 x 500 = 4,500; MAGI 430,000 is 30,000 over
    // the MFJ threshold -> reduction 30 x 50 = 1,500. IRC 24(h)(4) applies the
    // one reduction to the COMBINED amount, and `computeCredits` consumes the
    // ODC slice first: ODC 500 -> 0, CTC 4,000 -> 3,000. The household's whole
    // nonrefundable total for those years is that 3,000, because the AOTC is
    // fully phased out and the Saver's Credit is far past its top tier.
    expect(YEARS[0].taxResult!.flow.taxCredits).toBe(3_000);
    expect(YEARS[1].taxResult!.flow.taxCredits).toBe(3_000);
  });

  it("renders partial → full at 2028 and stays applicable on the ODC alone", () => {
    // 2031-2032 have no qualifying child left but still one Other Dependent, so
    // the row is "full", not "na" — `rangeFor("ctc")` re-derives the band width
    // from the household's own gross credit (here 500 -> a 10,000-wide band).
    expect(statuses("ctc")).toEqual([
      "partial", "partial", "full", "full", "full", "full", "full",
    ]);
  });

  it("walks the credit down as the children age out, with nothing else moving", () => {
    //          2028                    2029                2030     2031/32
    //   2 QC + 1 ODC + AOTC     1 QC + 1 ODC + AOTC   1 QC + 1 ODC   1 ODC
    //   4,000 + 500 + 328.125   2,000 + 500 + 328.125  2,000 + 500     500
    expect(per((y) => y.taxResult!.flow.taxCredits)).toEqual([
      3_000, 3_000, 4_828.125, 2_828.125, 2_500, 500, 500,
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CROSSING 5 of 5 — the AOTC. Flip year: 2028, where the MAGI band is crossed
// (430,000 is past the 180,000 MFJ ceiling; 175,625 sits inside it). THAT is
// this item's statutory crossing and the one R4 is satisfied by.
//
// ⚠️ The credit ALSO goes to zero at 2030, but that second transition is NOT a
// statutory one — it is the engine defect documented at the foot of this block.
// Under a §25A-correct counter the credit would keep paying through 2031 and
// there would be no 2030 flip at all. The assertions below pin CURRENT
// behaviour, correctly and deliberately; they are not a statement about what
// the statute requires. Read the divergence note before trusting the shape.
// ════════════════════════════════════════════════════════════════════════════

describe("crossing: the AOTC is phased out through 2027, PAID in 2028-2029, and zero from 2030", () => {
  it("stops counting the student after four goal-years — the ENGINE's counter, not the statute's", () => {
    // Goal runs 2026-2031. The engine burns a year per active goal-year
    // regardless of whether a credit was allowed, so it stops after 2029.
    // ⚠️ The two trailing zeros are the DEFECT documented below, not §25A:
    // 2026-2027 paid nothing yet consumed half the allowance.
    expect(per((y) => facts(y).household.aotcStudents)).toEqual([1, 1, 1, 1, 0, 0, 0]);
  });

  it("pays 218.75 refundable + 328.125 nonrefundable in 2028-2029 and nothing either side", () => {
    // MAGI 175,625 inside the 160,000-180,000 MFJ band -> surviving fraction
    // (180,000 - 175,625) / 20,000 = 0.21875. One student, 40,000 of qualified
    // expenses -> the 2,500 cap binds -> 2,500 x 0.21875 = 546.875, split 40/60
    // by IRC 25A(i)(5) into 218.75 refundable and 328.125 nonrefundable.
    // Every figure is a dyadic fraction, so these are exact, not approximate.
    //
    // ⚠️ The 2028 flip (0 -> 218.75) is the statutory MAGI crossing. The 2030
    // flip (218.75 -> 0) is the ENGINE DEFECT documented below — §25A would
    // keep paying 218.75 through 2031. Both values are pinned as current
    // behaviour; only the first is a statement about the statute.
    expect(per((y) => y.taxResult!.flow.refundableCredits)).toEqual([
      0, 0, 218.75, 218.75, 0, 0, 0,
    ]);
  });

  it("renders out → partial at 2028, then na from 2030 once the counter is spent", () => {
    // "na" rather than "out" from 2030: the household still HAS a student in
    // college, but the engine's counter no longer offers them the credit, which
    // is a different statement from "their income disqualified them".
    // ⚠️ Those three "na"s are the DEFECT documented below, not the statute —
    // and they are the reason it is invisible on the report, which reads them
    // as "no AOTC student here" rather than "allowance already spent".
    expect(statuses("aotc")).toEqual([
      "out", "out", "partial", "partial", "na", "na", "na",
    ]);
  });

  /**
   * ⚠️ KNOWN DIVERGENCE FROM IRC 25A(b)(2)(C) — reported to the controller,
   * deliberately NOT fixed here (Task 14 is not a fix task) and deliberately
   * NOT asserted the other way round, which would launder it into a green tick.
   *
   * `projection.ts:4064-4069` burns one of the student's four years whenever an
   * education goal is active, WITHOUT regard to whether any credit was actually
   * allowed. This household's 2026 and 2027 credits are 0 — the MAGI is 250,000
   * past the ceiling — yet those two years consume half the allowance, so by
   * the time the income falls only 2028 and 2029 remain.
   *
   * §25A(b)(2)(C) denies the credit only where "the taxpayer elected to have
   * this section apply ... for any 4 PRIOR taxable years". A year in which the
   * phase-out reduced the credit to zero is not a year the taxpayer elected
   * anything — no Form 8863 is filed for it — so 2030 and 2031 should still be
   * claimable, at the same 546.875 the engine pays in 2028.
   *
   * `it.fails` rather than a comment so this self-destructs: the moment the
   * counter learns to skip zero-credit years, this test starts FAILING (vitest
   * reports "expected test to fail") and whoever fixes it is told to delete it.
   */
  it.fails("§25A(b)(2)(C): a year whose credit phased out to zero should not burn one of the four", () => {
    expect(YEARS[4].taxResult!.flow.refundableCredits).toBe(218.75);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The items the brief does NOT ask to cross, pinned so a crossing that appears
// in one of them is noticed rather than absorbed.
// ════════════════════════════════════════════════════════════════════════════

describe("the non-crossing rows hold their steady state", () => {
  it("keeps QBI and NIIT not-applicable — this household has neither", () => {
    // Zero growth means zero interest, dividends and gains, so `hasInvestment
    // Income` is false and NIIT is "na" rather than "full". Asserted so that a
    // fixture change which quietly introduces investment income (and with it a
    // 3.8% surtax on every figure above) cannot pass unnoticed.
    expect(per((y) => facts(y).netInvestmentIncome)).toEqual(HORIZON.map(() => 0));
    expect(statuses("niit")).toEqual(HORIZON.map(() => "na"));
    expect(statuses("qbi")).toEqual(HORIZON.map(() => "na"));
  });

  it("keeps the AMT exemption unphased and the charitable limit at 60% of AGI", () => {
    expect(statuses("amtExemption")).toEqual(HORIZON.map(() => "full"));
    expect(statuses("charitableLimit")).toEqual(HORIZON.map(() => "full"));
  });

  it("reports the Saver's Credit out in 2026 and NOT APPLICABLE after — SECURE 2.0 §103", () => {
    // The one row whose state changes for a reason that is neither the income
    // nor the household: the credit is replaced by the Saver's Match after
    // 2026, and `statusFor` reads the REQUESTED year, not `params.year`.
    expect(statuses("saversCredit")).toEqual([
      "out", "na", "na", "na", "na", "na", "na",
    ]);
  });
});
