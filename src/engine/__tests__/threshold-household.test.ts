/**
 * Task 11 — household assembly and MAGI ordering in `projection.ts`.
 *
 * These are the tests that prove the four gates are WIRED, not merely present.
 * Each of the four had a call site in production passing an inert literal (or
 * no value at all); every `describe` below names the literal it would revert to
 * and asserts a figure that changes when it does. A unit test cannot catch any
 * of them, because unit tests supply their own inputs directly.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  Account,
  ClientData,
  ClientInfo,
  Expense,
  FamilyMember,
  Income,
  Liability,
  PlanSettings,
  SavingsRule,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

// ── Seeded tax parameters ───────────────────────────────────────────────────
// ALL 21 threshold/credit columns are still NULL in the live database, so the
// unseeded path is the live path — which is exactly why every fixture here
// supplies its own seeded row rather than leaning on the DB or on the shared
// FIXTURE_TAX_PARAMS (which deliberately leaves them null).
const SEEDED_PARAMS: TaxYearParameters[] = [{
  year: 2026,
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
  // IRC 408A(c)(3) — 2025 bands (Notice 2024-80).
  rothPhaseout: { startMfj: 236000, endMfj: 246000, startSingle: 150000, endSingle: 165000 },
  // IRC 219(g).
  iraDeduct: {
    coveredStartMfj: 129000, coveredEndMfj: 149000,
    coveredStartSingle: 81000, coveredEndSingle: 91000,
    spousalStartMfj: 242000, spousalEndMfj: 252000,
  },
  // IRC 221. Width 30,000 MFJ: every MAGI used below sits on a dyadic fraction
  // of it, so the surviving amount is exactly representable in binary64.
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
}];

// ── Fixture ─────────────────────────────────────────────────────────────────
// Deliberately minimal and zero-growth so `taxableIncome` is exactly the year's
// salary: every account grows at 0%, there are no realizations, no Social
// Security and no capital gains. That makes `magiBase` — and therefore every
// gate below it — an exact figure rather than an approximate one.

const CLIENT: ClientInfo = {
  firstName: "Ada",
  lastName: "Kern",
  dateOfBirth: "1985-03-02",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "married_joint",
  spouseName: "Blaise",
  spouseDob: "1986-07-19",
  spouseRetirementAge: 65,
};

const FMS: FamilyMember[] = [
  { id: LEGACY_FM_CLIENT, role: "client", relationship: "other", firstName: "Ada", lastName: "Kern", dateOfBirth: "1985-03-02" },
  { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other", firstName: "Blaise", lastName: "Kern", dateOfBirth: "1986-07-19" },
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
  id: "acct-checking",
  category: "cash",
  subType: "checking",
  value: 3_000_000,
  basis: 3_000_000,
  isDefaultChecking: true,
});
const ACCT_401K = acct({ id: "acct-401k", category: "retirement", subType: "401k" });
// Spouse-owned, so `resolveWorkplaceCoverage("spouse")` can infer TRUE from a
// rule against it — without one, a `spouseCoveredByWorkplacePlan: "no"` fixture
// asserts nothing, because "auto" would infer false anyway.
const ACCT_401K_SPOUSE = acct({
  id: "acct-401k-spouse",
  category: "retirement",
  subType: "401k",
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
});
const ACCT_IRA = acct({ id: "acct-ira", category: "retirement", subType: "traditional_ira" });
const ACCT_ROTH = acct({ id: "acct-roth", category: "retirement", subType: "roth_ira" });

function salary(annualAmount: number, owner: Income["owner"] = "client"): Income {
  return {
    id: `inc-salary-${owner}`,
    type: "salary",
    name: `${owner} salary`,
    annualAmount,
    startYear: 2026,
    endYear: 2040,
    growthRate: 0,
    owner,
  };
}

function rule(over: Partial<SavingsRule> & Pick<SavingsRule, "id" | "accountId" | "annualAmount">): SavingsRule {
  return {
    isDeductible: true,
    startYear: 2026,
    endYear: 2040,
    ...over,
  };
}

const SETTINGS: PlanSettings = {
  flatFederalRate: 0.22,
  // 0 so the SALT state-tax estimate is 0 and the below-line side stays out of
  // the way of the above-line figures these tests assert.
  flatStateRate: 0,
  inflationRate: 0.02,
  planStartYear: 2026,
  planEndYear: 2026,
  taxEngineMode: "bracket",
};

function build(over: Partial<ClientData> = {}): ClientData {
  return {
    client: CLIENT,
    accounts: [CHECKING, ACCT_401K, ACCT_IRA],
    incomes: [salary(200_000)],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: SETTINGS,
    familyMembers: FMS,
    giftEvents: [],
    taxYearRows: SEEDED_PARAMS,
    ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// GATE 2 — the IRC 219(g) traditional-IRA deductibility gate
// Reverting `iraGate` to "not passed at all" makes both figures 16,000.
// ════════════════════════════════════════════════════════════════════════════

describe("gate: traditional-IRA deduction is phased out on the year's real MAGI", () => {
  // Salary 200,000; a 10,000 401(k) deferral (never MAGI-limited) and a 6,000
  // traditional-IRA contribution.
  //   magiBase = 200,000 - 10,000 = 190,000
  //   magiForIraDeduction = magiBase = 190,000  (IRC 219(g)(3)(A))
  //   coveredSelf is INFERRED true from the active 401(k) rule
  //   190,000 >= the covered-MFJ range's 149,000 ceiling -> IRA deduction 0
  const fixture = build({
    accounts: [CHECKING, ACCT_401K, ACCT_IRA],
    savingsRules: [
      rule({ id: "sav-401k", accountId: "acct-401k", annualAmount: 10_000 }),
      rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 6_000 }),
    ],
  });

  it("deducts the 401(k) deferral and NONE of the IRA contribution", () => {
    const years = runProjection(fixture);
    // Ungated this is 16,000 — the 6,000 IRA contribution deducted in full.
    expect(years[0].deductionBreakdown!.aboveLine.retirementContributions).toBe(10_000);
  });

  it("reports the MAGI it gated on, and that it inferred coverage", () => {
    const years = runProjection(fixture);
    const facts = years[0].thresholdFacts!;
    expect(facts.magiForIraDeduction).toBe(190_000);
    expect(facts.household.coveredSelf).toBe(true);
    expect(facts.household.hasTraditionalIraContribution).toBe(true);
  });

  it("phases the deduction PARTIALLY inside the range, aggregated once", () => {
    // Salary 155,000 with the same 10,000 deferral -> magiBase 145,000.
    // (145,000 - 129,000) / 20,000 = 0.8 exactly, so 20% of the §219(b) LIMIT
    // survives — IRC 219(g)(2)(A) reduces the limit, not the contribution.
    // One contributor, age under 50 -> limit 7,000; 20% = 1,400, and Pub
    // 590-A's $10 round-up leaves it there. The deduction is
    // min(6,000 contributed, 1,400) = 1,400, so above-line = 10,000 + 1,400.
    //
    // Scaling the 6,000 CONTRIBUTION instead gives 1,200 (total 11,200) — the
    // engine's former answer, and the one number on this branch that pinned
    // the wrong formulation.
    //
    // 11,400 rather than 12,800 also confirms the limit basis is ONE person's
    // 7,000: a basis that wrongly added the non-contributing spouse's limit
    // would leave 20% of 14,000 = 2,800 and deduct min(6,000, 2,800).
    const years = runProjection(build({
      incomes: [salary(155_000)],
      savingsRules: [
        rule({ id: "sav-401k", accountId: "acct-401k", annualAmount: 10_000 }),
        rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 6_000 }),
      ],
    }));
    expect(years[0].thresholdFacts!.magiForIraDeduction).toBe(145_000);
    expect(years[0].deductionBreakdown!.aboveLine.retirementContributions).toBe(11_400);
  });

  it("does not gate at all when NOBODY is a covered participant", () => {
    // The same 190,000 MAGI, but the only savings rule is the IRA itself — no
    // workplace plan, so IRC 219(g)(1) never triggers and the full contribution
    // is deductible however high the income.
    const years = runProjection(build({
      savingsRules: [rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 6_000 })],
    }));
    expect(years[0].thresholdFacts!.household.coveredSelf).toBe(false);
    expect(years[0].deductionBreakdown!.aboveLine.retirementContributions).toBe(6_000);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GATE 3 — the IRC 221 student-loan MAGI
// Reverting to the `taxableIncome` proxy makes the deduction 0.
// ════════════════════════════════════════════════════════════════════════════

describe("gate: student-loan interest is phased out on magiForStudentLoan, not taxable income", () => {
  const studentLoan: Liability = {
    id: "liab-student",
    name: "Student Loan",
    balance: 300_000,
    interestRate: 0.065,
    monthlyPayment: 2_500,
    startYear: 2026,
    startMonth: 1,
    termMonths: 240,
    liabilityType: "student",
    isInterestDeductible: false,
    extraPayments: [],
    owners: [],
  };

  // Salary 200,000, a 22,500 401(k) deferral, no IRA:
  //   magiBase = 200,000 - 22,500 = 177,500; iraDeduction 0
  //   magiForStudentLoan = 177,500
  //   (177,500 - 170,000) / 30,000 = 0.25 exactly -> 75% survives
  //   2,500 x 0.75 = 1,875
  // The OLD proxy was `taxableIncome` = 200,000, which is exactly the top of the
  // range -> deduction 0. So this figure is 1,875 iff the real MAGI is wired.
  const fixture = build({
    liabilities: [studentLoan],
    savingsRules: [rule({ id: "sav-401k", accountId: "acct-401k", annualAmount: 22_500 })],
  });

  it("deducts 1,875 where the taxableIncome proxy deducted nothing", () => {
    const years = runProjection(fixture);
    expect(years[0].thresholdFacts!.magiForStudentLoan).toBe(177_500);
    expect(years[0].deductionBreakdown!.aboveLine.studentLoanInterest).toBe(1_875);
  });

  it("accrues far more interest than the $2,500 cap, so the cap is what binds first", () => {
    // Non-vacuous guard: if the year's accrual were under 1,875 the assertion
    // above would pass for the wrong reason. A 300,000 balance at 6.5% accrues
    // roughly 19,000 in year one — the statutory cap is what binds, and then
    // the phase-out cuts the capped figure.
    const years = runProjection(build({
      liabilities: [studentLoan],
      // No workplace rule -> nobody covered, and salary 100,000 is below the
      // 170,000 phase-out start, so the deduction is the uncut 2,500 cap.
      incomes: [salary(100_000)],
    }));
    expect(years[0].deductionBreakdown!.aboveLine.studentLoanInterest).toBe(2_500);
  });

  it("lets the IRA deduction reduce it — IRC 221(b)(2)(C) excludes only §221 itself", () => {
    // ONE fixture, ONE column flipped: salary 192,500 and a 3,750 traditional-IRA
    // contribution, with the workplace-coverage override the only difference.
    // magiBase is 192,500 either way (the IRA deduction is excluded from it by
    // IRC 219(g)(3)(A)); what changes is whether the IRA deduction SURVIVES and
    // therefore reduces the student-loan MAGI.
    //
    // Both MAGIs sit on a dyadic fraction of the 30,000-wide MFJ range, so the
    // surviving dollars are exact rather than nearly-exact:
    //   covered:     magiForStudentLoan 192,500 -> 22,500/30,000 = 0.75
    //                -> 25% survives -> 2,500 x 0.25 = 625
    //   not covered: iraDeduction 3,750 -> 188,750 -> 18,750/30,000 = 0.625
    //                -> 37.5% survives -> 2,500 x 0.375 = 937.50
    const shared = {
      liabilities: [studentLoan],
      incomes: [salary(192_500)],
      savingsRules: [rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 3_750 })],
    };
    const covered = runProjection(build({
      ...shared,
      client: { ...CLIENT, coveredByWorkplacePlan: "yes" },
    }));
    expect(covered[0].thresholdFacts!.magiForIraDeduction).toBe(192_500);
    expect(covered[0].deductionBreakdown!.aboveLine.retirementContributions).toBe(0);
    expect(covered[0].thresholdFacts!.magiForStudentLoan).toBe(192_500);
    expect(covered[0].deductionBreakdown!.aboveLine.studentLoanInterest).toBe(625);

    const notCovered = runProjection(build({
      ...shared,
      client: { ...CLIENT, coveredByWorkplacePlan: "no" },
    }));
    expect(notCovered[0].thresholdFacts!.magiForIraDeduction).toBe(192_500);
    expect(notCovered[0].deductionBreakdown!.aboveLine.retirementContributions).toBe(3_750);
    expect(notCovered[0].thresholdFacts!.magiForStudentLoan).toBe(188_750);
    expect(notCovered[0].deductionBreakdown!.aboveLine.studentLoanInterest).toBe(937.5);
  });

  it("flags the household as having student-loan interest even when fully phased out", () => {
    // Salary 250,000 -> magiForStudentLoan 250,000, past the 200,000 ceiling.
    // The deduction is 0 but the Thresholds report must say "out", which needs
    // the GROSS accrual, not the post-gate deduction.
    const years = runProjection(build({
      incomes: [salary(250_000)],
      liabilities: [studentLoan],
    }));
    expect(years[0].deductionBreakdown!.aboveLine.studentLoanInterest).toBe(0);
    expect(years[0].thresholdFacts!.household.hasStudentLoanInterest).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GATE 1 — the IRC 408A(c)(3) Roth MAGI gate
// Reverting `magiForRoth` to the literal 0 leaves `contributionAdjustments`
// undefined: 0 sits below every range, so the gate emits nothing.
// ════════════════════════════════════════════════════════════════════════════

describe("gate: the Roth phase-out resolves against the year's real MAGI", () => {
  // Salary 300,000, a 20,000 401(k) deferral, a 7,000 Roth IRA contribution.
  //   magiBase = 300,000 - 20,000 = 280,000; no traditional IRA -> iraDeduction 0
  //   magiForRoth = 280,000, above the 246,000 MFJ ceiling
  //   -> the whole 7,000 is re-tagged as a backdoor conversion
  const fixture = build({
    accounts: [CHECKING, ACCT_401K, ACCT_ROTH],
    incomes: [salary(300_000)],
    savingsRules: [
      rule({ id: "sav-401k", accountId: "acct-401k", annualAmount: 20_000 }),
      rule({ id: "sav-roth", accountId: "acct-roth", annualAmount: 7_000 }),
    ],
  });

  it("re-tags the whole disallowed contribution as a backdoor conversion", () => {
    const years = runProjection(fixture);
    expect(years[0].thresholdFacts!.magiForRoth).toBe(280_000);
    expect(years[0].contributionAdjustments!.backdoorByRuleId["sav-roth"]).toBe(7_000);
    expect(
      years[0].contributionAdjustments!.adjustments.filter((a) => a.reason === "roth_magi_backdoor"),
    ).toHaveLength(1);
  });

  it("leaves the CONTRIBUTION itself untouched — the gate re-tags, it never reduces", () => {
    const years = runProjection(fixture);
    // The money still lands in the Roth account; only its tax route differs.
    expect(years[0].savings.byAccount["acct-roth"]).toBe(7_000);
  });

  it("emits nothing for the same household below the range", () => {
    // Salary 240,000 with the same 20,000 deferral -> magiForRoth 220,000,
    // below the 236,000 start. Non-vacuous counterpart to the case above: it is
    // what a `magiForRoth: 0` regression would make EVERY household look like.
    const years = runProjection(build({
      accounts: [CHECKING, ACCT_401K, ACCT_ROTH],
      incomes: [salary(240_000)],
      savingsRules: [
        rule({ id: "sav-401k", accountId: "acct-401k", annualAmount: 20_000 }),
        rule({ id: "sav-roth", accountId: "acct-roth", annualAmount: 7_000 }),
      ],
    }));
    expect(years[0].thresholdFacts!.magiForRoth).toBe(220_000);
    expect(years[0].contributionAdjustments).toBeUndefined();
  });

  it("adds the traditional-IRA deduction back before gating — IRC 408A(c)(3)(B)(i)", () => {
    // The ONLY fixture on which the Roth MAGI and the student-loan MAGI diverge:
    // it needs a traditional-IRA deduction that actually SURVIVES, which needs a
    // household nobody's workplace plan covers.
    //
    // Salary 248,000; 3,500 traditional IRA + 3,500 Roth IRA (7,000 exactly, the
    // age-based IRA cap, so the age pass rescales nothing); coverage overridden
    // to "no" on both sides so IRC 219(g)(1) never triggers.
    //   magiBase = 248,000 (the IRA slice is added back into it by construction)
    //   iraDeduction = 3,500 (uncovered -> fully deductible)
    //   magiForRoth        = 248,000  <- statute: 219(g)(3)(A)(ii) adds it back
    //   magiForStudentLoan = 244,500  <- 221(b)(2)(C)(ii) does NOT
    // 248,000 is past the 246,000 MFJ ceiling -> allowed 0 -> the WHOLE 3,500 is
    // re-tagged as a backdoor conversion.
    //
    // Under the superseded `magiBase - iraDeduction` spec this MAGI was 244,500,
    // inside the band, and this test goes red — MEASURED, by running it against
    // that formula: fraction 8,500/10,000 = 0.85, so the allowance is
    // roundReducedLimit(7,000 x (1 - 0.85)) and the backdoor came out 2,440, not
    // the 3,500 asserted below. (2,440 rather than a tidy 2,450 because
    // 1 - 0.85 = 0.15000000000000002, which rounds UP a ten — R16's float trap
    // in the wild. The figure asserted here is immune to it: past the ceiling
    // the allowance is a hard 0 and no fraction is taken at all.)
    // So this discriminates the statute from the spec it replaced, not merely a
    // wired gate from an inert one.
    const years = runProjection(build({
      client: { ...CLIENT, coveredByWorkplacePlan: "no", spouseCoveredByWorkplacePlan: "no" },
      accounts: [CHECKING, ACCT_IRA, ACCT_ROTH],
      incomes: [salary(248_000)],
      savingsRules: [
        rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 3_500 }),
        rule({ id: "sav-roth", accountId: "acct-roth", annualAmount: 3_500 }),
      ],
    }));
    const f = years[0].thresholdFacts!;
    // Non-vacuity guard: if the deduction did not survive, iraDeduction would be
    // 0 and the two MAGIs would coincide whichever formula were in force.
    expect(years[0].deductionBreakdown!.aboveLine.retirementContributions).toBe(3_500);
    expect(f.magiForRoth).toBe(248_000);
    expect(f.magiForRoth).toBe(f.magiForIraDeduction);
    expect(f.magiForStudentLoan).toBe(244_500);
    // Exact, not `toBeCloseTo`: past the ceiling the allowance is a hard 0, so
    // the pro-rata scale is exactly 0 and no fraction is ever taken (R16).
    expect(years[0].contributionAdjustments!.backdoorByRuleId["sav-roth"]).toBe(3_500);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GATE 4 — the three advisor override columns
// Before this task nothing outside the API routes and the UI read any of them.
// ════════════════════════════════════════════════════════════════════════════

describe("gate: clients.covered_by_workplace_plan overrides the inference", () => {
  const savingsRules = [
    rule({ id: "sav-401k", accountId: "acct-401k", annualAmount: 10_000 }),
    rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 6_000 }),
  ];

  it("'no' un-gates a household the inference would have gated", () => {
    // Identical to the first gate-2 fixture — active 401(k) rule, MAGI 190,000 —
    // except the advisor has said the client is NOT a covered participant.
    const years = runProjection(build({
      client: { ...CLIENT, coveredByWorkplacePlan: "no" },
      savingsRules,
    }));
    expect(years[0].thresholdFacts!.household.coveredSelf).toBe(false);
    // Ungated: the full 6,000 IRA contribution joins the 10,000 deferral.
    expect(years[0].deductionBreakdown!.aboveLine.retirementContributions).toBe(16_000);
  });

  it("'yes' gates a household with no workplace savings rule at all", () => {
    // The mirror image: only an IRA rule, so the inference would say "not
    // covered" and deduct in full. The override says otherwise, and at MAGI
    // 200,000 the deduction disappears.
    const years = runProjection(build({
      client: { ...CLIENT, coveredByWorkplacePlan: "yes" },
      savingsRules: [rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 6_000 })],
    }));
    expect(years[0].thresholdFacts!.household.coveredSelf).toBe(true);
    expect(years[0].deductionBreakdown!.aboveLine.retirementContributions).toBe(0);
  });

  it("forces coveredSpouse false on a filing status with no spouse on the return", () => {
    // A single filer whose spouse column says "yes". IRC 219(g)(1) cannot be
    // triggered by a spouse who is not on the return; a `true` here would be a
    // data bug, so it is forced false rather than passed through.
    const years = runProjection(build({
      client: {
        ...CLIENT,
        filingStatus: "single",
        spouseCoveredByWorkplacePlan: "yes",
        coveredByWorkplacePlan: "no",
      },
      savingsRules: [rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 6_000 })],
    }));
    expect(years[0].thresholdFacts!.household.coveredSpouse).toBe(false);
    // …and the deduction survives, because neither spouse is covered.
    expect(years[0].deductionBreakdown!.aboveLine.retirementContributions).toBe(6_000);
  });

  it("honours a spouse override on a joint return, where it IS on the return", () => {
    const years = runProjection(build({
      client: {
        ...CLIENT,
        coveredByWorkplacePlan: "no",
        spouseCoveredByWorkplacePlan: "yes",
      },
      savingsRules: [rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 6_000 })],
    }));
    expect(years[0].thresholdFacts!.household.coveredSpouse).toBe(true);
    // Non-covered contributor, covered spouse -> the SPOUSAL range applies
    // (242,000-252,000). MAGI 200,000 is below it, so the deduction survives —
    // reading the two flags in the wrong order would apply the covered range
    // and zero this out.
    expect(years[0].deductionBreakdown!.aboveLine.retirementContributions).toBe(6_000);
  });
});

describe("gate: family_members.claimed_as_dependent reaches the credit layer", () => {
  const child = (over: Partial<FamilyMember> = {}): FamilyMember => ({
    id: "fm-child",
    role: "child",
    relationship: "child",
    firstName: "Cy",
    lastName: "Kern",
    dateOfBirth: "2016-05-04", // age 10 in 2026
    ...over,
  });
  const adultChild = (over: Partial<FamilyMember> = {}): FamilyMember => ({
    id: "fm-adult-child",
    role: "child",
    relationship: "child",
    firstName: "Dev",
    lastName: "Kern",
    dateOfBirth: "2001-01-15", // age 25 in 2026 — never a qualifying child
    ...over,
  });

  const householdFor = (members: FamilyMember[]) =>
    runProjection(build({ familyMembers: [...FMS, ...members] }))[0].thresholdFacts!.household;

  it("counts a child under 17 as a qualifying child", () => {
    expect(householdFor([child()]).qualifyingChildren).toBe(1);
  });

  it("'no' removes that child", () => {
    expect(householdFor([child({ claimedAsDependent: "no" })]).qualifyingChildren).toBe(0);
  });

  it("'yes' and 'auto' are INDISTINGUISHABLE for a qualifying child", () => {
    // The plan's predicate is `claimedAsDependent !== "no"`, so a `yes` override
    // is a NO-OP on this branch. Asserted rather than discovered later.
    const auto = householdFor([child({ claimedAsDependent: "auto" })]);
    const yes = householdFor([child({ claimedAsDependent: "yes" })]);
    expect(auto.qualifyingChildren).toBe(1);
    expect(yes.qualifyingChildren).toBe(auto.qualifyingChildren);
    expect(yes.otherDependents).toBe(auto.otherDependents);
  });

  it("'yes' is what makes a NON-qualifying child an Other Dependent", () => {
    // This is the branch where the tri-state column is not half dead: an adult
    // child is invisible to IRC 24(c) but earns the 24(h)(4) $500 credit when
    // the advisor says they are claimed.
    expect(householdFor([adultChild()]).otherDependents).toBe(0);
    const claimed = householdFor([adultChild({ claimedAsDependent: "yes" })]);
    expect(claimed.otherDependents).toBe(1);
    expect(claimed.qualifyingChildren).toBe(0);
  });

  it("does NOT treat a member born after the tax year as a dependent of either kind", () => {
    // `resolveAgeInYear` is `year - birthYear` with no lower bound, so a 2030
    // DOB reads as age -4 in 2026 — which satisfies "under 17". The count alone
    // said 1 and the household collected a full $2,000 of CTC for a child who
    // does not exist yet, so the DOLLARS are asserted here too: a count-only
    // assertion is what let this through the first time.
    const unborn = child({ id: "fm-unborn", dateOfBirth: "2030-06-01" });
    const h = householdFor([unborn]);
    expect(h.qualifyingChildren).toBe(0);
    expect(h.otherDependents).toBe(0);
    expect(
      runProjection(build({ incomes: [salary(60_000)], familyMembers: [...FMS, unborn] }))[0]
        .taxResult!.flow.taxCredits,
    ).toBe(0);

    // An explicit "yes" does not promote them to an Other Dependent either. The
    // column asserts that someone IS claimed, never that they exist, so the
    // guard skips the member outright instead of only failing the child test.
    const unbornClaimed = child({
      id: "fm-unborn", dateOfBirth: "2030-06-01", claimedAsDependent: "yes",
    });
    const claimed = householdFor([unbornClaimed]);
    expect(claimed.qualifyingChildren).toBe(0);
    expect(claimed.otherDependents).toBe(0);
    expect(
      runProjection(build({ incomes: [salary(60_000)], familyMembers: [...FMS, unbornClaimed] }))[0]
        .taxResult!.flow.taxCredits,
    ).toBe(0);
  });

  it("does NOT treat a child with no date of birth as a qualifying child", () => {
    // `resolveAgeInYear` answers 50 for a missing DOB — a product default, not
    // an age. A DOB-less child must be excluded because the DOB is missing, not
    // because 50 happens not to be under 17.
    expect(householdFor([child({ dateOfBirth: null })]).qualifyingChildren).toBe(0);
  });

  it("never counts the client or spouse as a dependent, whatever the column says", () => {
    // IRC 152(b)(1). The override column is per-row and an advisor can set it on
    // the principals' own rows.
    const years = runProjection(build({
      familyMembers: FMS.map((f) => ({ ...f, claimedAsDependent: "yes" as const })),
    }));
    const h = years[0].thresholdFacts!.household;
    expect(h.qualifyingChildren).toBe(0);
    expect(h.otherDependents).toBe(0);
  });

  it("varies all three override columns at once and moves all three outputs", () => {
    // R17: no fixture may leave every override at its "auto" default, or the
    // whole surface is asserted vacuously.
    //
    // The spouse's 401(k) rule is what makes the `"no"` arm mean anything: with
    // it, `"auto"` WOULD infer coveredSpouse true, so the override is genuinely
    // reversing an inference rather than agreeing with it. Verified by flipping
    // the column to "auto" and watching this test go red.
    const years = runProjection(build({
      client: { ...CLIENT, coveredByWorkplacePlan: "yes", spouseCoveredByWorkplacePlan: "no" },
      accounts: [CHECKING, ACCT_401K, ACCT_IRA, ACCT_401K_SPOUSE],
      familyMembers: [
        ...FMS,
        child({ claimedAsDependent: "no" }),
        adultChild({ claimedAsDependent: "yes" }),
      ],
      savingsRules: [
        rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 6_000 }),
        rule({ id: "sav-401k-spouse", accountId: "acct-401k-spouse", annualAmount: 5_000 }),
      ],
    }));
    const h = years[0].thresholdFacts!.household;
    expect(h.coveredSelf).toBe(true);       // from "yes"
    expect(h.coveredSpouse).toBe(false);    // from "no", against a TRUE inference
    expect(h.qualifyingChildren).toBe(0);   // the under-17 child was excluded
    expect(h.otherDependents).toBe(1);      // the adult child was included
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AOTC students and the four-year cap (R9)
// ════════════════════════════════════════════════════════════════════════════

describe("AOTC students: named by an education goal, capped at four claimed years", () => {
  const student: FamilyMember = {
    id: "fm-student",
    role: "child",
    relationship: "child",
    firstName: "Wren",
    lastName: "Kern",
    dateOfBirth: "2007-09-12", // 19 in 2026 — a student, never a qualifying child
  };

  const goal = (over: Partial<Expense> = {}): Expense => ({
    id: "exp-college",
    type: "education",
    name: "College",
    annualAmount: 40_000,
    startYear: 2026,
    endYear: 2032,
    growthRate: 0,
    forFamilyMemberId: "fm-student",
    ...over,
  });

  const sixYearSettings: PlanSettings = { ...SETTINGS, planEndYear: 2031 };

  it("claims the credit for exactly four years and then stops", () => {
    // ⚠️ Salary 100,000 is load-bearing, not decoration. The counter only
    // spends a year in which the credit was actually ALLOWED (IRC
    // 25A(b)(2)(C) — see the phased-out case below), so at the fixture's
    // default 200,000 the MAGI is past the 180,000 MFJ ceiling, no year is
    // ever claimed, and this assertion would be testing nothing at all.
    const years = runProjection(build({
      incomes: [salary(100_000)],
      planSettings: sixYearSettings,
      familyMembers: [...FMS, student],
      expenses: [goal()],
    }));
    const counts = years.map((y) => y.thresholdFacts!.household.aotcStudents);
    // 2026-2029 claimed, 2030-2031 past the IRC 25A(b)(2)(C) limit.
    expect(counts).toEqual([1, 1, 1, 1, 0, 0]);
  });

  it("does NOT spend one of the four on a year the phase-out zeroed", () => {
    // Same six-year goal at an income that denies the credit outright (MAGI
    // 200,000 is past the 180,000 MFJ ceiling). §25A(b)(2)(C) spends a year
    // only where the taxpayer "elected to have this section apply"; a
    // zero-credit year is no election, so the allowance stays intact and the
    // student is still reported in all six years.
    //
    // This is the exact contrast with the test above: same goal, same student,
    // same horizon — only the income differs, and only the income should
    // decide whether the allowance is consumed.
    const years = runProjection(build({
      incomes: [salary(200_000)],
      planSettings: sixYearSettings,
      familyMembers: [...FMS, student],
      expenses: [goal()],
    }));
    expect(years.map((y) => y.thresholdFacts!.household.aotcStudents))
      .toEqual([1, 1, 1, 1, 1, 1]);
    // And nothing was ever paid, which is what makes those six years free.
    expect(years.every((y) => y.taxResult!.flow.refundableCredits === 0)).toBe(true);
  });

  it("stops at four years even when the REPORT's MAGI and the CREDIT's AGI disagree", () => {
    // ⚠️ THE REGRESSION GUARD FOR B2. Self-employment is the wedge: the
    // report's `magiForCredits` never sees the §164(f) deductible half of SE
    // tax (year-tax.ts adds it inside the tax pass), so at 185,000 of SE
    // earnings the two figures land on OPPOSITE sides of the 180,000 MFJ
    // ceiling —
    //   report  MAGI ~= 185,000  -> surviving fraction 0 -> "never elected"
    //   credit  AGI  ~= 171,900  -> surviving fraction ~0.4 -> credit PAID
    // A counter driven off the report figure therefore never advances while
    // the credit keeps paying, and the four-year allowance becomes UNBOUNDED.
    // That is strictly worse than the defect it replaced, which at least
    // burned out after four years.
    //
    // Salary would NOT reproduce this: with wages the two AGIs agree, both
    // land above the ceiling, and nothing is ever paid. The divergence is the
    // whole point of the fixture.
    const years = runProjection(build({
      incomes: [{
        id: "inc-consulting",
        type: "business",
        name: "Consulting",
        annualAmount: 185_000,
        startYear: 2026,
        endYear: 2040,
        growthRate: 0,
        owner: "client",
        isSelfEmployment: true,
      }],
      planSettings: sixYearSettings,
      familyMembers: [...FMS, student],
      expenses: [goal()],
    }));

    const paidYears = years.filter((y) => y.taxResult!.flow.refundableCredits > 0).length;
    // Non-vacuous in both directions: the credit must actually be reachable on
    // this fixture (else "at most four" passes for the wrong reason), AND it
    // must stop. Asserted as ONE toEqual so there is exactly one throw point.
    expect({
      paid: paidYears,
      reported: years.map((y) => y.thresholdFacts!.household.aotcStudents),
    }).toEqual({
      paid: 4,
      reported: [1, 1, 1, 1, 0, 0],
    });
  });

  it("still spends exactly one year when the convergence loop re-runs the tax pass", () => {
    // ⚠️ PINS THE CARDINALITY AT ITS ACTUAL THREAT SITE. `computeTaxForYear`
    // is re-run up to five times per year (Roth fill, bracket filler,
    // SUPPLEMENTAL WITHDRAWALS, legacy pass). The counter must advance once
    // per YEAR, not once per tax pass — otherwise a household that funds its
    // spending by drawing on an IRA burns the four-year allowance in two.
    //
    // The other four-year tests in this describe cannot catch that: their
    // checking account holds 3,000,000, so no supplemental draw is ever
    // planned and the re-run branch is never entered. This fixture starves
    // checking (5,000) and adds an 80,000 living expense against a 100,000
    // salary, which forces the draw. Verified by mutation: injecting a second
    // increment inside the supplemental branch leaves every other test in this
    // file green and reddens only this one.
    //
    // The IRA draw lands AGI near 140,000 — deliberately still under the
    // 160,000 MFJ AOTC phase-out start, so the credit stays fully allowed and
    // this test measures counting, not phase-out.
    const years = runProjection(build({
      accounts: [
        { ...CHECKING, value: 5_000, basis: 5_000 },
        { ...ACCT_IRA, value: 500_000, basis: 0 },
      ],
      incomes: [salary(60_000)],
      planSettings: sixYearSettings,
      familyMembers: [...FMS, student],
      expenses: [goal(), {
        id: "exp-living",
        type: "living",
        name: "Living",
        annualAmount: 100_000,
        startYear: 2026,
        endYear: 2040,
        growthRate: 0,
      }],
      withdrawalStrategy: [
        { accountId: "acct-ira", priorityOrder: 1, startYear: 2026, endYear: 2040 },
      ],
    }));

    expect({
      reported: years.map((y) => y.thresholdFacts!.household.aotcStudents),
      // Non-vacuous guard: without a real supplemental draw this fixture would
      // silently exercise the same single-pass path as every other test here
      // and the mutation below would not be caught. Draws run ~56k-61k/yr.
      everyYearDrew: years.every((y) => y.withdrawals.total > 0),
      // And the draw must not itself phase the credit out, or "stops at four"
      // would pass for the wrong reason. 160,000 is the MFJ AOTC start.
      stayedUnderPhaseout: years.every((y) => y.taxResult!.flow.adjustedGrossIncome < 160_000),
    }).toEqual({
      reported: [1, 1, 1, 1, 0, 0],
      everyYearDrew: true,
      stayedUnderPhaseout: true,
    });
  });

  it("would be wrong in every year after the first if the counter were per-year", () => {
    // The counter is per-projection-CALL state declared outside the year loop.
    // A fresh call must start from zero again — otherwise Monte Carlo's second
    // trial onward silently denies the credit.
    //
    // ⚠️ Salary 100,000 again: at an income where no year is ever claimed the
    // counter never advances, so leaked state would be indistinguishable from
    // clean state and both runs would match trivially.
    const runOnce = () => runProjection(build({
      incomes: [salary(100_000)],
      planSettings: sixYearSettings,
      familyMembers: [...FMS, student],
      expenses: [goal()],
    })).map((y) => y.thresholdFacts!.household.aotcStudents);
    const first = runOnce();
    const second = runOnce();
    expect(second).toEqual(first);
    // Non-vacuous: the counter genuinely runs out inside a single call, so a
    // leak across calls would show up as a second run of all zeros.
    expect(first).toEqual([1, 1, 1, 1, 0, 0]);
  });

  it("skips a goal that names no student rather than attributing it to the client", () => {
    const years = runProjection(build({
      familyMembers: [...FMS, student],
      expenses: [goal({ forFamilyMemberId: null })],
    }));
    expect(years[0].thresholdFacts!.household.aotcStudents).toBe(0);
  });

  it("counts two goals for the same student as ONE claimed year", () => {
    // §25A's four-year limit and its $4,000 expense ceiling are both per
    // STUDENT per year, so two goals must not burn two of the four years.
    // Salary 100,000 so the years are actually claimed — see the note on the
    // four-year test above.
    const years = runProjection(build({
      incomes: [salary(100_000)],
      planSettings: sixYearSettings,
      familyMembers: [...FMS, student],
      expenses: [goal(), goal({ id: "exp-college-2", name: "Room & Board", annualAmount: 15_000 })],
    }));
    expect(years.map((y) => y.thresholdFacts!.household.aotcStudents)).toEqual([1, 1, 1, 1, 0, 0]);
  });

  it("pays an AOTC through the credit layer for a household inside the phase-out", () => {
    // Salary 100,000, MFJ, one student with 40,000 of qualified expenses.
    // MAGI is below the 160,000 MFJ AOTC start, so the full 2,500 is allowed:
    // 40% refundable = 1,000, 60% nonrefundable = 1,500.
    const years = runProjection(build({
      incomes: [salary(100_000)],
      familyMembers: [...FMS, student],
      expenses: [goal()],
    }));
    expect(years[0].taxResult!.flow.refundableCredits).toBe(1_000);
    expect(years[0].taxResult!.flow.taxCredits).toBe(1_500);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Self-employment earnings reach the credit layer, not FICA (R10)
// ════════════════════════════════════════════════════════════════════════════

describe("credit earned income: the projection's SE earnings reach the ACTC", () => {
  const seIncome: Income = {
    id: "inc-consulting",
    type: "business",
    name: "Consulting",
    annualAmount: 40_000,
    startYear: 2026,
    endYear: 2040,
    growthRate: 0,
    owner: "client",
    isSelfEmployment: true,
  };
  const child: FamilyMember = {
    id: "fm-child",
    role: "child",
    relationship: "child",
    firstName: "Cy",
    lastName: "Kern",
    dateOfBirth: "2016-05-04",
  };

  it("carries seEarnings onto the household so the ACTC's 15% formula has a base", () => {
    const years = runProjection(build({
      incomes: [seIncome],
      familyMembers: [...FMS, child, { ...child, id: "fm-child-2", firstName: "Del" }],
    }));
    // Wages are 0, so without the SE figure the ACTC's
    // 0.15 x max(0, earnedIncome - 2,500) term is 0 and no refund is possible.
    expect(years[0].taxResult!.income.earnedIncome).toBe(0);
    expect(years[0].taxResult!.flow.refundableCredits).toBeGreaterThan(0);
  });

  it("still charges no wage-side FICA on that self-employment income", () => {
    const years = runProjection(build({
      incomes: [seIncome],
      familyMembers: [...FMS, child],
    }));
    // SECA is charged in year-tax.ts and rolls into totalFederalTax; the
    // wage-side `fica` line stays 0. Widening `earnedIncome` would double it.
    expect(years[0].taxResult!.flow.fica).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// thresholdFacts persistence (R12) and the MAGI ordering itself (R13)
// ════════════════════════════════════════════════════════════════════════════

describe("thresholdFacts rides on the projection year", () => {
  it("is populated in bracket mode and absent in flat mode", () => {
    const bracket = runProjection(build());
    expect(bracket[0].thresholdFacts).toBeDefined();
    const flat = runProjection(build({
      planSettings: { ...SETTINGS, taxEngineMode: "flat" },
    }));
    expect(flat[0].thresholdFacts).toBeUndefined();
  });

  it("stamps the REQUESTED year, not the source year the resolver inflated from", () => {
    // SEEDED_PARAMS holds 2026 only, so 2027-2028 are inflated forward and
    // `params.year` stays 2026 on every one of them.
    const years = runProjection(build({
      planSettings: { ...SETTINGS, planEndYear: 2028 },
    }));
    expect(years.map((y) => y.thresholdFacts!.year)).toEqual([2026, 2027, 2028]);
    expect(years[2].taxResult!.diag.bracketsUsed.year).toBe(2026);
  });

  it("keeps the four MAGIs in their statutory relationship", () => {
    // Salary 200,000; 10,000 of 401(k); 6,000 of IRA (fully gated away at this
    // MAGI); a student loan whose deduction survives at 0.
    //   magiBase 190,000 = magiForIraDeduction
    //   iraDeduction 0 -> magiForStudentLoan = magiForRoth = 190,000
    //   studentLoan deduction 0 (190,000 < 200,000 -> partial) ... see below
    const years = runProjection(build({
      savingsRules: [
        rule({ id: "sav-401k", accountId: "acct-401k", annualAmount: 10_000 }),
        rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 6_000 }),
      ],
    }));
    const f = years[0].thresholdFacts!;
    expect(f.magiForIraDeduction).toBe(190_000);
    // All four coincide here ONLY because iraDeduction is 0, so this case cannot
    // tell the three formulas apart. The two that DO diverge are pinned where
    // the divergence is observable, each against its own statute:
    //   magiForStudentLoan = magiBase - iraDeduction  (IRC 221(b)(2)(C)(ii)) ->
    //     "lets the IRA deduction reduce it" in the gate-3 block;
    //   magiForRoth        = magiBase                 (IRC 408A(c)(3)(B)(i)) ->
    //     "adds the traditional-IRA deduction back" in the gate-1 block.
    expect(f.magiForStudentLoan).toBe(190_000);
    expect(f.magiForRoth).toBe(190_000);
    // No student-loan interest at all here, so AGI == the student-loan MAGI.
    expect(f.magiForCredits).toBe(190_000);
    expect(f.agi).toBe(f.magiForCredits);
  });

  it("carries the three non-MAGI income measures off the year's tax result", () => {
    const years = runProjection(build({
      savingsRules: [rule({ id: "sav-401k", accountId: "acct-401k", annualAmount: 10_000 })],
    }));
    const f = years[0].thresholdFacts!;
    const flow = years[0].taxResult!.flow;
    // No QBI in this fixture, so taxable-income-before-QBI IS taxable income —
    // asserted against the tax result rather than restated as a literal.
    expect(f.taxableIncomeBeforeQbi).toBe(flow.taxableIncome);
    expect(f.amti).toBe(flow.taxableIncome + 30_000); // standard deduction added back
    expect(f.netInvestmentIncome).toBe(0);
  });

  // ── B3: the reported MAGIs must see the WHOLE year ────────────────────────
  // `magiBase` is fixed early, before Roth conversions, bracket fillers and
  // supplemental withdrawals are added to `taxableIncome`, and taxable Social
  // Security never enters it at all. Every assertion below therefore compares
  // the REPORTED figure against the engine's own AGI on a household whose
  // income arrives after that point.

  it("reports an AGI that includes Roth conversion income", () => {
    // The solver's PRIMARY use case. Before the fix the Alternative and
    // Original columns of the Thresholds report rendered IDENTICALLY for a
    // conversion strategy — the report moved not one cell while the engine
    // taxed the conversion in full.
    const years = runProjection(build({
      incomes: [salary(73_000)],
      accounts: [CHECKING, { ...ACCT_IRA, value: 500_000, basis: 0 }, ACCT_ROTH],
      rothConversions: [{
        id: "rc-1",
        name: "Fill to 22%",
        destinationAccountId: "acct-roth",
        sourceAccountIds: ["acct-ira"],
        conversionType: "fixed_amount",
        fixedAmount: 60_000,
        startYear: 2026,
        indexingRate: 0,
      }],
    }));
    const f = years[0];
    expect({
      converted: Math.round(f.taxResult!.flow.adjustedGrossIncome),
      reportedAgi: Math.round(f.thresholdFacts!.agi),
      reportedCreditsMagi: Math.round(f.thresholdFacts!.magiForCredits),
    }).toEqual({
      converted: 133_000,
      reportedAgi: 133_000,
      reportedCreditsMagi: 133_000,
    });
  });

  it("EXCLUDES that same conversion income from the Roth and IRA-deduction MAGIs", () => {
    // The asymmetry is the statute, and it is why B3 must NOT be fixed by
    // giving all four MAGIs one shared base:
    //   §408A(c)(3)(B)(i) / Pub 590-A Wksht 2-1 — conversion income is BACKED
    //     OUT of the Roth-contribution MAGI (otherwise converting would
    //     disqualify you from contributing, which is not the law).
    //   Pub 590-A Wksht 1-1 — same exclusion for the §219(g) deduction MAGI.
    //   §221 and the credit layer have NO such exclusion.
    const years = runProjection(build({
      incomes: [salary(73_000)],
      accounts: [CHECKING, { ...ACCT_IRA, value: 500_000, basis: 0 }, ACCT_ROTH],
      rothConversions: [{
        id: "rc-1",
        name: "Fill to 22%",
        destinationAccountId: "acct-roth",
        sourceAccountIds: ["acct-ira"],
        conversionType: "fixed_amount",
        fixedAmount: 60_000,
        startYear: 2026,
        indexingRate: 0,
      }],
    }));
    const f = years[0].thresholdFacts!;
    expect({
      roth: Math.round(f.magiForRoth),
      iraDeduction: Math.round(f.magiForIraDeduction),
      // Contrast — these two DO carry it.
      studentLoan: Math.round(f.magiForStudentLoan),
      credits: Math.round(f.magiForCredits),
    }).toEqual({
      roth: 73_000,
      iraDeduction: 73_000,
      studentLoan: 133_000,
      credits: 133_000,
    });
  });

  it("reports an AGI that includes taxable Social Security", () => {
    const years = runProjection(build({
      incomes: [
        salary(73_000),
        {
          id: "inc-ss", type: "social_security", name: "SS",
          annualAmount: 40_000, startYear: 2026, endYear: 2040,
          growthRate: 0, owner: "client",
        },
      ],
    }));
    const f = years[0];
    // Taxable SS is derived inside calculate.ts and was never in `magiBase`,
    // so the report used to print 73,000 flat against a real AGI of 107,000.
    expect(Math.round(f.thresholdFacts!.agi))
      .toBe(Math.round(f.taxResult!.flow.adjustedGrossIncome));
    // Non-vacuous: the SS really is taxable on this fixture.
    expect(f.taxResult!.flow.adjustedGrossIncome).toBeGreaterThan(73_000);
  });

  it("reports an AGI that includes supplemental withdrawals", () => {
    // A retiree funding spending by drawing on an IRA. The draw is planned
    // AFTER magiBase is fixed, so the report used to print an AGI of 0 while
    // the engine taxed hundreds of thousands — which is what made the NIIT row
    // read "Does Not Apply" while `calcNiit` charged the surtax.
    const years = runProjection(build({
      incomes: [],
      accounts: [
        { ...CHECKING, value: 5_000, basis: 5_000 },
        { ...ACCT_IRA, value: 3_000_000, basis: 0 },
      ],
      expenses: [{
        id: "exp-living", type: "living", name: "Living",
        annualAmount: 300_000, startYear: 2026, endYear: 2040, growthRate: 0,
      }],
      withdrawalStrategy: [
        { accountId: "acct-ira", priorityOrder: 1, startYear: 2026, endYear: 2040 },
      ],
    }));
    const f = years[0];
    expect(Math.round(f.thresholdFacts!.agi))
      .toBe(Math.round(f.taxResult!.flow.adjustedGrossIncome));
    expect(f.taxResult!.flow.adjustedGrossIncome).toBeGreaterThan(300_000);
  });

  it("no longer diverges from calculate.ts's AGI on self-employment income", () => {
    // ⚠️ HISTORY — this test previously asserted the OPPOSITE, and was right to
    // at the time: R13 chose to REPORT the divergence rather than reconcile it,
    // because `magiBase` is built from the projection's `taxableIncome`, which
    // carries neither taxable Social Security nor the §164(f) deductible half
    // of SE tax that year-tax.ts adds above the line.
    //
    // B3 closed it. The reported MAGIs are now rebuilt from the settled AGI
    // after the tax pass, so both terms are inside them by construction and
    // there is nothing left to reconcile. The assertion is INVERTED rather
    // than deleted: "the two agree even on SE income" is the regression guard
    // for the fix, and dropping the case would leave the §164(f) leg
    // uncovered entirely.
    const clean = runProjection(build({
      savingsRules: [rule({ id: "sav-401k", accountId: "acct-401k", annualAmount: 10_000 })],
    }))[0];
    expect(clean.thresholdFacts!.magiForCredits).toBe(clean.taxResult!.flow.adjustedGrossIncome);

    const se = runProjection(build({
      incomes: [{
        id: "inc-consulting", type: "business", name: "Consulting",
        annualAmount: 40_000, startYear: 2026, endYear: 2040, growthRate: 0,
        owner: "client", isSelfEmployment: true,
      }],
    }))[0];
    expect({
      magi: se.thresholdFacts!.magiForCredits,
      // Non-vacuous: the §164(f) half really is in play here, so the two
      // figures genuinely COULD disagree — they used to, by this amount.
      secaHalfIsReal: se.taxResult!.flow.adjustedGrossIncome < 40_000,
    }).toEqual({
      magi: se.taxResult!.flow.adjustedGrossIncome,
      secaHalfIsReal: true,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The unseeded path IS the live path (R14), and the split, not just the total
// ════════════════════════════════════════════════════════════════════════════

describe("unseeded credit columns yield zero credits, never NaN", () => {
  // Every one of the 21 new columns is still NULL in the live database, so this
  // is what production actually runs today. `perChild`/`refundableMax`/
  // `odcPerDependent` null means the credit AMOUNT is zero — the opposite of the
  // deduction gates, where an unseeded phase-out range means "don't gate".
  const UNSEEDED: TaxYearParameters[] = [{
    ...SEEDED_PARAMS[0],
    ctc: { perChild: null, refundableMax: null, odcPerDependent: null },
    saversCredit: { mfj: [], single: [], hoh: [] },
  }];
  const child: FamilyMember = {
    id: "fm-child", role: "child", relationship: "child",
    firstName: "Cy", lastName: "Kern", dateOfBirth: "2016-05-04",
  };

  it("still counts the children but pays nothing for them", () => {
    const years = runProjection(build({
      incomes: [salary(60_000)],
      familyMembers: [...FMS, child],
      taxYearRows: UNSEEDED,
    }));
    expect(years[0].thresholdFacts!.household.qualifyingChildren).toBe(1);
    expect(years[0].taxResult!.flow.taxCredits).toBe(0);
    expect(years[0].taxResult!.flow.refundableCredits).toBe(0);
    expect(Number.isNaN(years[0].expenses.taxes)).toBe(false);
  });

  it("pays the credit once the same household's columns ARE seeded", () => {
    // The non-vacuous counterpart: without it the assertions above would pass on
    // a fixture that simply has no credit-eligible members.
    const years = runProjection(build({
      incomes: [salary(60_000)],
      familyMembers: [...FMS, child],
    }));
    expect(years[0].taxResult!.flow.taxCredits).toBe(2_000);
  });
});

describe("unseeded DEDUCTION columns do NOT gate — the mirror image of the credit columns", () => {
  // The deduction gates invert the rule the block above pins. An unseeded
  // CREDIT column is the credit AMOUNT, so null pays nothing. An unseeded
  // DEDUCTION column is a phase-out BOUND, and a missing bound cannot mean
  // "phase out from zero" — so the gates return the full amount ungated.
  //
  // This is the combination production actually runs: all 5 `tax_year_parameters`
  // rows still hold NULL in all 21 new columns, so the unseeded arm below is the
  // live path and the seeded arm is the aspiration. It is also the combination
  // that fails in the OPPOSITE direction from the credits — an unseeded
  // deduction gate over-deducts where an unseeded credit under-pays — which is
  // why one pair cannot stand in for the other.
  //
  // ONE exception, deliberate and pinned separately below: `studentLoan.
  // maxDeduction` falls back to IRC 221(b)(1)'s $2,500. That figure is fixed by
  // statute and never indexed, so a null there can only mean "not seeded",
  // never "awaiting this year's indexed value" — and treating it as "no cap"
  // would deduct the household's ENTIRE student-loan interest.
  const UNSEEDED_DEDUCTIONS: TaxYearParameters[] = [{
    ...SEEDED_PARAMS[0],
    rothPhaseout: { startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    iraDeduct: {
      coveredStartMfj: null, coveredEndMfj: null,
      coveredStartSingle: null, coveredEndSingle: null,
      spousalStartMfj: null, spousalEndMfj: null,
    },
    studentLoan: {
      maxDeduction: null, startMfj: null, endMfj: null, startSingle: null, endSingle: null,
    },
  }];

  const studentLoan: Liability = {
    id: "liab-student", name: "Student Loan",
    balance: 150_000, interestRate: 0.065, monthlyPayment: 1_300,
    startYear: 2026, startMonth: 1, termMonths: 240,
    liabilityType: "student", isInterestDeductible: false,
    extraPayments: [], owners: [],
  };
  // Spouse-owned so the Roth sits in its OWN per-person IRA bucket: 7,000 there
  // and 6,000 in the client's, both at or under `iraTradLimit`, so the age-cap
  // pass scales nothing and the only adjustment either arm can produce is the
  // Roth MAGI gate's.
  const ACCT_ROTH_SPOUSE = acct({
    id: "acct-roth-spouse", category: "retirement", subType: "roth_ira",
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
  });

  // Salary 300,000 with a 20,000 deferral -> magiBase 280,000, which is past the
  // FAR end of all three seeded bands (Roth 246,000; covered-IRA 149,000;
  // student loan 200,000). Every gate therefore bites to its maximum when the
  // columns are seeded, and the two arms below disagree about every figure.
  const shared = {
    accounts: [CHECKING, ACCT_401K, ACCT_IRA, ACCT_ROTH_SPOUSE],
    incomes: [salary(300_000)],
    liabilities: [studentLoan],
    savingsRules: [
      rule({ id: "sav-401k", accountId: "acct-401k", annualAmount: 20_000 }),
      rule({ id: "sav-ira", accountId: "acct-ira", annualAmount: 6_000 }),
      rule({ id: "sav-roth", accountId: "acct-roth-spouse", annualAmount: 7_000 }),
    ],
  };

  it("returns the FULL amount from all three gates, and caps student-loan interest at §221(b)(1)'s 2,500", () => {
    const years = runProjection(build({ ...shared, taxYearRows: UNSEEDED_DEDUCTIONS }));
    const y = years[0];
    // Non-vacuity: the household IS in every gate's scope, so a `false` here
    // would make the three assertions below pass for the wrong reason.
    expect(y.thresholdFacts!.household.coveredSelf).toBe(true);
    expect(y.thresholdFacts!.household.hasTraditionalIraContribution).toBe(true);
    expect(y.thresholdFacts!.household.hasRothContribution).toBe(true);

    // 1. IRC 219(g) — the whole 6,000 IRA contribution joins the 20,000 deferral.
    expect(y.deductionBreakdown!.aboveLine.retirementContributions).toBe(26_000);
    // 2. IRC 408A(c)(3) — nothing is re-tagged, so the block is absent entirely.
    expect(y.contributionAdjustments).toBeUndefined();
    // 3. IRC 221 — the RANGE is unseeded so no phase-out applies, but the CAP
    //    falls back to the statute. Exactly 2,500 and not the year's ~9,700 of
    //    accrued interest: that is the one narrowing of the "don't gate" rule,
    //    and asserting the round figure is what proves the fallback fired
    //    rather than the accrual passing through uncapped.
    expect(y.deductionBreakdown!.aboveLine.studentLoanInterest).toBe(2_500);

    // The surviving IRA deduction feeds forward: 280,000 - 6,000.
    expect(y.thresholdFacts!.magiForStudentLoan).toBe(274_000);
    expect(Number.isNaN(y.expenses.taxes)).toBe(false);
  });

  it("gates all three away once the same household's columns ARE seeded", () => {
    // The discriminating counterpart, as with the credit pair above: without it
    // every figure asserted there would also pass on a household no gate could
    // reach. One column set changes; the fixture is byte-identical otherwise.
    const years = runProjection(build(shared));
    const y = years[0];
    expect(y.deductionBreakdown!.aboveLine.retirementContributions).toBe(20_000);
    expect(y.contributionAdjustments!.backdoorByRuleId["sav-roth"]).toBe(7_000);
    expect(y.deductionBreakdown!.aboveLine.studentLoanInterest).toBe(0);
    // No IRA deduction survives, so nothing is subtracted here.
    expect(y.thresholdFacts!.magiForStudentLoan).toBe(280_000);
  });
});

describe("the three dependent/student counts come from three DIFFERENT members", () => {
  it("reports a distinct qualifying child, other dependent and AOTC student", () => {
    // R17: a fixture where one member could satisfy all three buckets would
    // assert nothing about the split. These are three separate people.
    const years = runProjection(build({
      incomes: [salary(100_000)],
      familyMembers: [
        ...FMS,
        { id: "fm-young", role: "child", relationship: "child", firstName: "Cy", lastName: "K", dateOfBirth: "2016-05-04" },
        { id: "fm-parent", role: "other", relationship: "parent", firstName: "Ma", lastName: "K", dateOfBirth: "1948-02-02", claimedAsDependent: "yes" },
        { id: "fm-student", role: "child", relationship: "child", firstName: "Wren", lastName: "K", dateOfBirth: "2007-09-12" },
      ],
      expenses: [{
        id: "exp-college", type: "education", name: "College", annualAmount: 40_000,
        startYear: 2026, endYear: 2032, growthRate: 0, forFamilyMemberId: "fm-student",
      }],
    }));
    const h = years[0].thresholdFacts!.household;
    expect(h.qualifyingChildren).toBe(1); // fm-young
    expect(h.otherDependents).toBe(1);    // fm-parent, via the "yes" override
    expect(h.aotcStudents).toBe(1);       // fm-student, via the education goal
    // The over-17 student is NOT double-counted as a dependent of either kind.
    const credits = years[0].taxResult!.flow;
    // CTC 2,000 + ODC 500 + AOTC nonrefundable 1,500 = 4,000 of nonrefundable,
    // plus the AOTC's 1,000 refundable slice.
    expect(credits.taxCredits).toBe(4_000);
    expect(credits.refundableCredits).toBe(1_000);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R18 — refundable credits legitimately drive the tax expense NEGATIVE
// ════════════════════════════════════════════════════════════════════════════

describe("a refundable credit larger than the liability posts as a NEGATIVE tax expense", () => {
  // MFJ, $30,000 of wages, three children, no state tax.
  //   AGI 30,000; standard deduction 30,000 -> taxableIncome 0
  //   subpart-A tax before credits 0, so nothing absorbs the CTC
  //   ACTC = min(3 x 2,000 = 6,000, 3 x 1,700 = 5,100,
  //              0.15 x (30,000 - 2,500) = 4,125) = 4,125
  //   totalFederalTax = max(0, 0 - 0) + 0 + 0 - 4,125 = -4,125
  //   FICA = 30,000 x (0.062 + 0.0145) = 2,295
  //   totalTax = -4,125 + 0 + 2,295 = -1,830
  const kid = (n: number): FamilyMember => ({
    id: `fm-kid-${n}`, role: "child", relationship: "child",
    firstName: `Kid${n}`, lastName: "Kern", dateOfBirth: `201${n}-04-04`,
  });
  const years = runProjection(build({
    incomes: [salary(30_000)],
    familyMembers: [...FMS, kid(4), kid(6), kid(8)],
  }));

  it("reports a negative federal tax", () => {
    expect(years[0].taxResult!.flow.refundableCredits).toBe(4_125);
    expect(years[0].taxResult!.flow.totalFederalTax).toBe(-4_125);
  });

  it("carries that sign all the way into the cash-flow Taxes line", () => {
    // NOT clamped. The controller's trace of every downstream consumer of
    // `expenses.taxes` found the cash-flow engine handles the sign correctly;
    // flooring it here would destroy the refundable credit the layer exists for.
    expect(years[0].expenses.taxes).toBe(-1_830);
  });

  it("adds the refund to household cash rather than subtracting it", () => {
    // The sign has to be right in the cash routing, not just in the report: the
    // refund is money IN. Against the same household without the children the
    // tax expense is positive, and the checking balance is lower by the swing.
    const withoutKids = runProjection(build({ incomes: [salary(30_000)] }));
    expect(withoutKids[0].expenses.taxes).toBeGreaterThan(0);
    expect(years[0].portfolioAssets.cash["acct-checking"]).toBeGreaterThan(
      withoutKids[0].portfolioAssets.cash["acct-checking"],
    );
  });
});
